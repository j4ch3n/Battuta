import { expect, it } from "vitest";
import { cleanupOwned } from "./cleanup.ts";

it("surfaces database and thrown cleanup errors after attempting every owned operation", async () => {
  const visited: number[] = [];
  await expect(
    cleanupOwned([
      () => {
        visited.push(1);
        return Promise.resolve({ error: new Error("delete failed") });
      },
      () => {
        visited.push(2);
        return Promise.reject(new Error("channel failed"));
      },
      () => {
        visited.push(3);
        return Promise.resolve({ error: null });
      },
    ]),
  ).rejects.toMatchObject({ errors: [expect.any(Error), expect.any(Error)] });
  expect(visited).toEqual([1, 2, 3]);
});
