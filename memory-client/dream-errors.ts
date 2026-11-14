import { ZodError } from "zod";

export interface DreamDiagnostic {
  stage: string;
  code: string;
  message: string;
  retryable?: boolean;
  paths?: string[];
}

export class DreamDiagnosticError extends Error {
  readonly diagnostic: DreamDiagnostic;
  constructor(diagnostic: DreamDiagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

// Only code-owned messages may cross the model/tool boundary.
const rules = new Set([
  "Duplicate operation id",
  "Repeated dream source",
  "Addition needs a reviewed input",
  "Unknown cleanup target",
  "Repeated mutation target",
  "Unknown dream source",
  "Cross-scope dream claim",
  "Too many dream source citations",
  "Duplicate proposed content",
  "Dreaming cannot fabricate confirmation",
  "Unknown or repeated dream source",
  "Wrong dream knowledge type",
  "New proposals start active until challenge",
  "Invalid dream evidence",
  "Evidence lacks source coverage",
  "Use retain for unchanged content; do not resurrect a rejected interpretation",
  "Duplicate synthesis id",
  "Synthesis needs a reviewed input",
  "Synthesis cannot use retired or deferred evidence",
  "Unknown cleanup evidence",
  "Synthesis must explicitly cite the reviewed replacement content",
  "Every synthesis needs an explicit challenge verdict",
  "Challenge must accept or reject",
  "Replacement cannot depend on retired evidence",
  "Replacement must be distinct from retired sources",
]);
const operational = new Set([
  "Dream already running",
  "Dream evidence exceeds model input budget",
  "Dream inventory exceeds record limit",
  "Dream publication exceeds inventory capacity",
  "Dream inventory has pending embeddings",
  "Dream evidence changed",
  "Cannot retire without acknowledged replacement",
  "Replacement has not been acknowledged",
  "Dream project catalog unavailable",
  "Dream log run conflict",
  "Dream reflection invalid after two attempts",
  "Dream reflection evidence exceeds budget",
]);
const fields = new Set([
  "operations",
  "id",
  "type",
  "summary",
  "ref",
  "refs",
  "content",
  "kind",
  "source_refs",
  "memory_metadata",
  "knowledge_type",
  "confidence",
  "keywords",
  "mentioned_at",
  "expires_at",
  "rationale",
  "evidence",
  "revision",
  "relation",
  "requirement",
  "stage",
  "status",
  "proposals",
  "cleanup_evidence",
  "decisions",
  "verdict",
]);

export function dreamDiagnostic(error: unknown, stage: string): DreamDiagnostic {
  if (error instanceof DreamDiagnosticError) return { ...error.diagnostic, stage };
  if (error instanceof ZodError) {
    const paths = error.issues.slice(0, 10).map((issue) =>
      issue.path
        .slice(0, 8)
        .map((part) =>
          typeof part === "number" ? String(part) : fields.has(String(part)) ? String(part) : "?",
        )
        .join("."),
    );
    const constraints = [
      ...new Set(
        error.issues.slice(0, 10).map((issue) => {
          switch (issue.code) {
            case "too_big":
              return `Use at most ${issue.maximum} ${issue.origin === "array" ? "items" : "characters"}`;
            case "too_small":
              return `Use at least ${issue.minimum} ${issue.origin === "array" ? "items" : "characters"}`;
            case "invalid_format":
              if (issue.format === "datetime")
                return "Use an ISO 8601 timestamp with an explicit timezone";
              if (issue.format === "regex" && issue.pattern?.includes("{1,40}"))
                return "IDs need 1–40 lowercase letters, digits, underscores or hyphens";
              if (issue.format === "regex" && issue.pattern?.includes("{64}"))
                return "Memory refs and revisions need exactly 64 lowercase hexadecimal characters";
              return "Use the declared lowercase identifier format (at most 40 characters)";
            case "invalid_type":
              return `Use the required ${issue.expected} value`;
            case "unrecognized_keys":
              return "Remove fields not declared by the schema";
            case "invalid_union":
              return "Use an allowed operation type and all of its required fields";
            case "invalid_value":
              return "Use one of the allowed schema values";
            case "custom":
              return "Use unique normalized keywords and credential-free text; derived claims need support and rationale, not confirmed confidence";
            default:
              return "Correct the listed fields under the declared schema";
          }
        }),
      ),
    ].slice(0, 5);
    return {
      stage,
      code: ["cleanup", "synthesis", "challenge"].includes(stage)
        ? "invalid_artifact"
        : "invalid_state",
      message: `Structured output violates the schema. ${constraints.join("; ")}.`.slice(0, 1000),
      paths,
      retryable: true,
    };
  }
  if (error instanceof SyntaxError)
    return {
      stage,
      code: "invalid_json",
      message: "Structured output must be valid JSON without prose or code fences.",
      retryable: true,
    };
  if (error instanceof Error && rules.has(error.message))
    return { stage, code: "invalid_artifact", message: error.message, retryable: true };
  if (error instanceof Error && operational.has(error.message))
    return { stage, code: "operation_failed", message: error.message };
  return {
    stage,
    code: "unexpected_error",
    message: `Dream stopped during ${stage}; no safe additional error details are available.`,
  };
}
