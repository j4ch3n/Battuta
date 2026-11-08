import { expect, test } from "vitest";
import { resolveRequestBinding } from "../binding.ts";

test.each([null, "Atlas", "my project", "项目", "missing-project"])(
  "binding preserves attribution without filesystem lookup: %s",
  async (project) => {
    const binding = {
      request_id: "r1",
      conversation_id: "c1",
      session_id: "s1",
      project,
      origin: "owner",
      admitted_at: "2026-11-06T10:00:00Z",
    };
    expect(await resolveRequestBinding(binding)).toEqual(binding);
    await expect(resolveRequestBinding(undefined)).rejects.toThrow();
    await expect(
      resolveRequestBinding({ ...binding, admitted_at: "2026-11-06T10:00:00" }),
    ).rejects.toThrow();
    await expect(resolveRequestBinding({ ...binding, origin: "invented" })).rejects.toThrow();
  },
);
