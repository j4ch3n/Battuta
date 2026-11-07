import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PreparedRecall } from "../recall-agent.ts";

const run = vi.hoisted(() => vi.fn());
vi.mock("../recall-agent.ts", async (original) => ({...await original<typeof import("../recall-agent.ts")>(), runRecallAgent:run}));
import extension from "../index.ts";
afterEach(() => {vi.unstubAllEnvs();run.mockReset();});

test.each(["skipped","ready","partial","unavailable"] as const)("main profile is retained when recall is %s, without origin metadata", async status => {
  const dir=await mkdtemp(join(tmpdir(),"recall-hook-"));
  try {
    vi.stubEnv("AGENT_ROLE","cos"); vi.stubEnv("BATTUTA_MEMORY_DATA_DIR",dir); vi.stubEnv("PI_CODING_AGENT_DIR",join(dir,".pi"));
    await mkdir(join(dir,".pi")); await writeFile(join(dir,".pi/settings.json"),JSON.stringify({battutaMemoryCapture:{enabled:false}}));
    await writeFile(join(dir,"ME.md"),"Owner likes concise replies.");
    const hooks=new Map<string, (...args: unknown[]) => unknown>();
    extension({on:(name:string,fn:(...args:unknown[])=>unknown)=>hooks.set(name,fn),appendEntry:()=>{}} as unknown as ExtensionAPI);
    run.mockResolvedValue({status,context:status === "skipped" ? "":"evidence",validationEvidence:[],preparedAt:new Date().toISOString()} satisfies PreparedRecall);
    const ctx={sessionManager:{getSessionId:()=>"s",getBranch:()=>[],buildContextEntries:()=>[]},ui:{setStatus:()=>{}}} as unknown as ExtensionContext;
    const result=await hooks.get("before_agent_start")!({messageType:"user",prompt:"hello"},ctx);
    expect(JSON.stringify(result)).toContain("Owner likes concise replies.");
    expect(JSON.stringify(result)).toContain(`memory-context:${status}`);
    expect(run.mock.calls[0][0]).toEqual({history:[],current:"hello"});
    expect(hooks.has("tool_call")).toBe(false);
  } finally {await rm(dir,{recursive:true,force:true});}
});
