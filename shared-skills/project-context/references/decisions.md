# Record a terminal product decision

Use PM's `finalize_spec` tool when project-management has selected **go** or **no-go** and established the decision rationale. Budget means scope and tradeoffs. Refine an open spec through `update_spec`; refine is not a terminal outcome.

## Invocation

```json
{
  "project": "atlas-api",
  "name": "API Design",
  "decision": "go",
  "rationale": "Pursue the single-project milestone and defer bulk processing. This provides a useful first achievement within the owner's mandate. Implementation and cycle start remain separately authorized."
}
```

This is illustrative input, not an actual decision. Use the exact registered project/name and a rationale grounded in the owner's mandate, evidence, accepted tradeoffs, and remaining conditions. Ask for unresolved rationale before calling the tool; no later rationale write is needed or permitted.

## Effects

In one serialized operation, the tool creates `decision.md` with outcome/rationale, fingerprints the exact bytes of the latest spec, checklist, decision, and review using SHA-256, and records the terminal outcome/version/timestamp/hashes in `specs/index.json`. Hashes live in JSON, not in the decision file itself. Missing optional checklist/review files produce null hashes.

Finalization has no checklist/review presence, quality, completion, or freshness gate. Fingerprints are a snapshot, not proof of a passing review. Missing latest spec bytes or an actual read/write/hash failure returns an error rather than inventing a successful record.

Go and no-go both close spec/checklist/review/decision authoring. There is no reopen, patch, or reversal operation. Read tools remain available. A product go does not authorize implementation, spending, or a cycle start by itself.

Inspect the returned decision and current metadata before reporting success. No decision announcement/acknowledgment mail is required. Send additional context or a bounded request only when the recipient's next action needs it; answer outstanding requests and pause affected active work explicitly.
