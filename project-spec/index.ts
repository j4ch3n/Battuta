import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProjectSpecStore, type Role } from "./store/index.ts";
import { registerGuards } from "./guards.ts";
import { registerReadTools } from "./tools/read.ts";
import { registerSpecTools } from "./tools/spec.ts";
import { registerChecklistTools } from "./tools/checklist.ts";
import { registerReviewTools } from "./tools/review.ts";
import { registerDecisionTools } from "./tools/decision.ts";
import { registerConstitutionTools } from "./tools/constitution.ts";

export default function projectSpec(
  pi: ExtensionAPI,
  options?: { role: Role; projectsRoot?: string },
) {
  const role = options?.role ?? process.env.AGENT_ROLE;
  if (role !== "pm" && role !== "tl") throw new Error("AGENT_ROLE must be pm or tl");
  const store = new ProjectSpecStore(role, options?.projectsRoot);
  registerReadTools(pi, store);
  registerConstitutionTools(pi, store);
  registerGuards(pi, store.root);
  if (role === "pm") {
    registerSpecTools(pi, store);
    registerDecisionTools(pi, store);
  } else {
    registerChecklistTools(pi, store);
    registerReviewTools(pi, store);
  }
}
