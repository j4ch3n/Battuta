import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProjectSpecStore, type Role } from "./store/index.ts";
import { registerGuards } from "./guards.ts";
import { registerReadTools } from "./tools/read.ts";
import { registerSpecTools } from "./tools/spec.ts";
import { registerChecklistTools } from "./tools/checklist.ts";
import { registerReviewTools } from "./tools/review.ts";
import { registerDecisionTools } from "./tools/decision.ts";
import { registerConstitutionTools } from "./tools/constitution.ts";

export default function projectSpec(pi: ExtensionAPI, options?: { role: Role }) {
  const role = options?.role ?? process.env.AGENT_ROLE;
  if (role !== "cos" && role !== "manager") throw new Error("AGENT_ROLE must be cos or manager");
  const store = new ProjectSpecStore(role);
  registerReadTools(pi, store);
  registerConstitutionTools(pi, store);
  registerGuards(pi, store.root);
  if (role === "cos") {
    registerSpecTools(pi, store);
    registerDecisionTools(pi, store);
  } else {
    registerChecklistTools(pi, store);
    registerReviewTools(pi, store);
  }
}
