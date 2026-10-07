import { assertEquals, assertRejects } from "@std/assert";
import { resolvePrincipal } from "./principal.ts";

Deno.test("getUser verifies bearer and only server app_metadata attributes callers", async () => {
  let seen = "";
  const getUser = (token: string) => {
    seen = token;
    return Promise.resolve({
      data: {
        user: {
          id: "user",
          role: "authenticated",
          app_metadata: { battuta: { role: "worker", worker_id: "host", projects: ["Battuta"] } },
          user_metadata: { battuta: { role: "pm" } },
        },
      },
      error: null,
    });
  };
  assertEquals(await resolvePrincipal("Bearer signed", getUser), {
    role: "worker",
    worker_id: "host",
    projects: ["Battuta"],
  });
  assertEquals(seen, "signed");
  for (const header of [null, "", "Basic signed", "Bearer sb_secret_test"])
    await assertRejects(() => resolvePrincipal(header, getUser));
  await assertRejects(() =>
    resolvePrincipal("Bearer bad", () =>
      Promise.resolve({ data: { user: null }, error: { message: "secret" } }),
    ),
  );
  await assertRejects(() =>
    resolvePrincipal("Bearer bad", () => Promise.reject(new Error("secret"))),
  );
  for (const user of [
    {
      id: "u",
      role: "service_role",
      app_metadata: { battuta: { role: "pm", projects: ["Battuta"] } },
    },
    {
      id: "u",
      role: "authenticated",
      user_metadata: { battuta: { role: "pm", projects: ["Battuta"] } },
    },
    { id: "u", role: "authenticated", app_metadata: { battuta: { role: "admin", projects: [] } } },
  ])
    await assertRejects(() =>
      resolvePrincipal("Bearer signed", () => Promise.resolve({ data: { user }, error: null })),
    );
});
