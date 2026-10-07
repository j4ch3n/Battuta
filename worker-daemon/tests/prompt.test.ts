import { expect, it } from "vitest";
import { buildPrompt, parseReport } from "../prompt.ts";
import { task, report } from "./fixtures.ts";

const block = `\`\`\`battuta-result\n${JSON.stringify(report)}\n\`\`\``;
it("carries exact instruction and execution boundaries", () => {
  const prompt = buildPrompt(task);
  expect(prompt).toContain(JSON.stringify(task.instruction, null, 2));
  expect(prompt).toMatch(/Do not.*Linear/);
  expect(prompt).toMatch(/native.*question/);
  expect(prompt).toContain("battuta-result");
});
it("validates a single delimited terminal report", () => {
  expect(parseReport(`Done\n${block}`, task.instruction)).toEqual(report);
});
it.each([
  "plain text",
  "```battuta-result\n{bad}\n```",
  `${block}\n${block}`,
  `> ${block}`,
  `\`\`\`text\n${block}\n\`\`\``,
])("rejects missing, quoted, nested, malformed or multiple blocks", (text) => {
  expect(() => parseReport(text, task.instruction)).toThrow();
});
it("rejects invalid criterion coverage", () => {
  expect(() => parseReport(block.replace('"works"', '"other"'), task.instruction)).toThrow();
});
