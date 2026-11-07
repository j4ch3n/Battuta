import type { MemoryRecord } from "../../records.ts";

export const record = (ref = "a".repeat(64)): MemoryRecord => ({
  ref,
  revision: "f".repeat(64),
  content: "Owner bought an NS2",
  scope: { global: true, projects: [] },
  kind: "event",
  tags: [],
  sources: [{ agent_id: "cos", session_id: "s", entry_id: "e" }],
  active: true,
  memory_metadata: {
    stage: "temporal",
    knowledge_type: "fact",
    confidence: "confirmed",
    status: "active",
    keywords: ["Nintendo"],
    evidence: [],
  },
});
