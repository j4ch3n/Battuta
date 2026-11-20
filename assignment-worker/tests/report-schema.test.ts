import { expect, test } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import worker from "../index.ts";
import { ExecutionResultSchema } from "../contracts.ts";

// Re-implementation of pi-claude-directsdk's normalizeInputSchema (src/sdk/tools.ts:19,37-55),
// which is what the model actually receives. Kept in the test so the bridge is not imported.
const BANNED_TOP_LEVEL = ["oneOf", "allOf", "anyOf"] as const;
function bridgeNormalize(schema: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(schema as Record<string, unknown>) };
  for (const key of BANNED_TOP_LEVEL) delete out[key];
  if (out["type"] === undefined) out["type"] = "object";
  if (out["type"] === "object" && !(out["properties"] && typeof out["properties"] === "object"))
    out["properties"] = {};
  return out;
}
// What the bridge does before sending: JSON round-trip, then normalize.
const sentToModel = (schema: unknown) => bridgeNormalize(JSON.parse(JSON.stringify(schema)));

async function registeredReportParameters(): Promise<unknown> {
  let parameters: unknown;
  await worker({
    on: () => undefined,
    registerTool: (tool: { name: string; parameters: unknown }) => {
      if (tool.name === "report_execution_result") parameters = tool.parameters;
    },
    registerCommand: () => undefined,
    setActiveTools: () => undefined,
    sendUserMessage: () => undefined,
  } as unknown as ExtensionAPI);
  expect(parameters).toBeDefined();
  return parameters;
}

test("report_execution_result is registered with a flat object schema and no top-level union", async () => {
  const schema = (await registeredReportParameters()) as Record<string, unknown>;
  expect(schema["type"]).toBe("object");
  for (const key of ["anyOf", "oneOf", "allOf"]) expect(schema).not.toHaveProperty(key);
  expect(Object.keys(schema["properties"] as object).sort()).toEqual([
    "blocker",
    "evidence",
    "outcome",
    "summary",
  ]);
  expect(schema["required"]).toEqual(["outcome", "summary", "evidence"]);
  const properties = schema["properties"] as Record<string, { description?: string }>;
  for (const field of ["outcome", "summary", "evidence", "blocker"])
    expect(properties[field]?.description).toEqual(expect.any(String));
});

test("the bridge's normalization keeps every model-facing property", async () => {
  const sent = sentToModel(await registeredReportParameters());
  expect(Object.keys(sent["properties"] as object).sort()).toEqual([
    "blocker",
    "evidence",
    "outcome",
    "summary",
  ]);
  expect(sent).not.toHaveProperty("anyOf");
});

test("the old top-level union would have reached the model with no properties", () => {
  // Negative control: this is the root cause (contracts.ts ExecutionResultSchema).
  expect(sentToModel(ExecutionResultSchema)).toEqual({ type: "object", properties: {} });
});
