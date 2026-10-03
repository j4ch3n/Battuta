import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "vitest";
import { replyRequest, sendRequest, validate, ReplyArguments, SendArguments } from "../schemas.ts";
import { validateCoverage } from "../content.ts";

const root = resolve(import.meta.dirname, "../..");
const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const collections = [
  {
    role: "pm" as const,
    peer: "tl",
    skill: "communicate-with-tl",
    files: [
      "request-assessment.md",
      "clarify-product-scope.md",
      "provide-updated-context.md",
      "request-reassessment.md",
    ],
  },
  {
    role: "tl" as const,
    peer: "pm",
    skill: "communicate-with-pm",
    files: [
      "report-assessment.md",
      "request-product-clarification.md",
      "report-progress-or-result.md",
      "report-new-evidence.md",
    ],
  },
];

function examples(file: string): unknown[] {
  const source = readFileSync(file, "utf8");
  const blocks = [...source.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  assert.ok(blocks.length, `${file} needs a full JSON example`);
  return blocks.map((block) => JSON.parse(block[1]) as unknown);
}

function checkLinks(file: string) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].split("#")[0];
    if (link && !/^[a-z]+:\/\//i.test(link)) {
      assert.ok(existsSync(resolve(dirname(file), link)), `${file}: broken link ${link}`);
    }
  }
}

for (const collection of collections) {
  test(`${collection.role} discovers only its outbound templates and examples satisfy Agent Mail`, () => {
    const skill = resolve(root, `bots/${collection.role}-bot/.pi/skills/${collection.skill}`);
    checkLinks(resolve(skill, "SKILL.md"));
    assert.ok(
      readFileSync(resolve(skill, "SKILL.md"), "utf8").includes("references/templates/index.md"),
    );
    const templates = resolve(skill, "references/templates");
    assert.deepEqual(readdirSync(templates).sort(), ["index.md", ...collection.files].sort());
    const index = readFileSync(resolve(templates, "index.md"), "utf8");
    checkLinks(resolve(templates, "index.md"));
    for (const file of collection.files) {
      assert.ok(index.includes(`(${file})`), `${file} must be discoverable`);
      checkLinks(resolve(templates, file));
      for (const example of examples(resolve(templates, file))) {
        const agent = { role: collection.role, sessionId };
        if (typeof example === "object" && example !== null && "parent" in example) {
          replyRequest(agent, example);
        } else {
          const args = validate(SendArguments, example);
          assert.equal(args.recipient, collection.peer);
          sendRequest(agent, args);
        }
      }
    }
  });
}

test("completed assessment template covers the PM assessment requirements verbatim", () => {
  const request = validate(
    SendArguments,
    examples(
      resolve(
        root,
        "bots/pm-bot/.pi/skills/communicate-with-tl/references/templates/request-assessment.md",
      ),
    )[0],
  );
  const assessment = validate(
    ReplyArguments,
    examples(
      resolve(
        root,
        "bots/tl-bot/.pi/skills/communicate-with-pm/references/templates/report-assessment.md",
      ),
    )[0],
  );
  assert.equal(assessment.content.result?.state, "complete");
  validateCoverage(assessment.content, [request.content]);
});

test("product-decision workflow links reach the shared command reference", () => {
  for (const file of [
    "bots/pm-bot/.pi/skills/project-management/SKILL.md",
    "bots/pm-bot/.pi/skills/project-management/references/product-decisions.md",
    "shared-skills/project-context/SKILL.md",
    "shared-skills/project-context/references/decisions.md",
    "shared-skills/project-context/references/commands.md",
    "shared-skills/project-context/references/spec-tools.md",
    "shared-skills/project-context/references/spec-metadata.md",
  ])
    checkLinks(resolve(root, file));
});
