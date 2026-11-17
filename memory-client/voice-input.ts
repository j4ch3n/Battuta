import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const SPEECH_URL = "http://127.0.0.1:8902/mcp";
const MAX_AUDIO_BYTES = 10_000_000;
const TRANSCRIBE_TIMEOUT_MS = 180_000;
const AUDIO_EXTENSIONS = new Set([".ogg", ".oga", ".opus", ".mp3", ".m4a", ".wav", ".flac"]);
const ATTACHMENTS_HEADER = /^\[attachments(?:\|[^\]]*)?\](?: (.+))?$/;

export async function transcribeTelegramVoice(text: string): Promise<string | undefined> {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => ATTACHMENTS_HEADER.test(line));
  if (start === -1) return undefined;
  const dir = ATTACHMENTS_HEADER.exec(lines[start])?.[1];
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith("- ")) end += 1;
  const itemLines = lines.slice(start + 1, end);
  const paths = itemLines.map((line) => (dir ? join(dir, line.slice(3)) : line.slice(2)));
  if (!paths.some(isAudioPath)) return undefined;
  const transcripts: string[] = [];
  for (const path of paths) if (isAudioPath(path)) transcripts.push(await transcribeFile(path));
  const remaining = itemLines.filter((_, index) => !isAudioPath(paths[index]));
  const attachments = remaining.length > 0 ? [lines[start], ...remaining] : [];
  return [...lines.slice(0, start), ...transcripts, ...attachments, ...lines.slice(end)].join("\n");
}

function isAudioPath(path: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(path).toLowerCase());
}

function note(reason: string): string {
  return `[voice message could not be transcribed: ${reason}]`;
}

async function transcribeFile(path: string): Promise<string> {
  let audio: Buffer;
  try {
    audio = await readFile(path);
  } catch {
    return note("audio file could not be read");
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) return note("audio is larger than 10 MB");
  try {
    return (await callSpeech(audio)) || note("no speech was detected");
  } catch {
    return note("speech service could not transcribe it");
  }
}

async function callSpeech(audio: Buffer): Promise<string> {
  const client = new Client({ name: "battuta-memory-voice", version: "0.1.0" });
  const signal = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS);
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(SPEECH_URL)), { signal });
    const result = await client.callTool(
      { name: "transcribe_audio", arguments: { audio: audio.toString("base64") } },
      undefined,
      { signal },
    );
    if (result.isError) throw new Error("Speech transcription failed");
    return z.object({ transcript: z.string() }).parse(result.structuredContent).transcript.trim();
  } finally {
    await client.close();
  }
}
