import assert from "node:assert/strict";
import { abilityProposal, unknownAbilities } from "./abilities.ts";

Deno.test("specialist proposals are sets and empty sets need no capability", () => {
  assert.deepEqual(abilityProposal.parse(["mobile_use", "mobile_use"]), ["mobile_use"]);
  assert.equal(unknownAbilities([]), undefined);
});

Deno.test("empty catalog rejects every proposed name without guessing or substituting", () => {
  for (const name of [
    "mobile_use",
    "mobile_browse",
    "web_search",
    "",
    "__proto__",
    "constructor",
  ]) {
    const result = unknownAbilities([name]);
    assert.equal(result?.code, "unknown_abilities");
    assert.deepEqual(result?.unknown, [name]);
    assert.deepEqual(result?.suggestions, {});
  }
});

Deno.test("specialist proposals reject malformed values at the schema boundary", () => {
  for (const input of [null, "", [null], [1], {}, [false]]) {
    assert.equal(abilityProposal.safeParse(input).success, false);
  }
});
