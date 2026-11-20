// A test-only stand-in for claude-proxy.ts that never starts Claude: it greets its worker with the run's token,
// asks one question, waits for the answer and prints a `claude -p` stream-json result line carrying it.
import { connectChannel } from "../delegate-channel.ts";

const { BATTUTA_DELEGATE_SOCKET: socket, BATTUTA_DELEGATE_TOKEN: token } = process.env;
if (!socket || !token)
  throw new Error("stub proxy needs BATTUTA_DELEGATE_SOCKET and BATTUTA_DELEGATE_TOKEN");
const channel = await connectChannel(socket, token);
const answer = new Promise<string>((resolve) =>
  channel.onMessage((message) => {
    if (message.type === "answer") resolve(message.text);
  }),
);
channel.send({ type: "started", sessionId: "stub-session" });
channel.send({
  type: "request",
  id: "q-1",
  kind: "question",
  questions: [{ question: "Which folder?" }],
});
const text = await answer;
channel.send({ type: "closed" });
process.stdout.write(
  `${JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: `answered: ${text}`,
    session_id: "stub-session",
    num_turns: 1,
    total_cost_usd: 0,
    permission_denials: [],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  })}\n`,
);
channel.close();
