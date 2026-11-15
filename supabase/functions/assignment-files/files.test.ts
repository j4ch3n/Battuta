import { deepStrictEqual as assertEquals } from "node:assert";
import { createFileOperations } from "./files.ts";
import { fileType } from "./contracts.ts";

Deno.test("classifies MIME metadata", () => {
  for (const [mime, expected] of [
    ["application/pdf", "pdf"],
    ["application/json; charset=utf-8", "text"],
    ["text/csv", "spreadsheet"],
    ["image/png", "image"],
    ["application/zip", "archive"],
    ["application/octet-stream", "other"],
  ])
    assertEquals(fileType(mime), expected);
});

Deno.test("upload retries conflicts without overwriting", async () => {
  const paths: string[] = [];
  const admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    storage: {
      from: () => ({
        upload: (path: string, _file: File, options: { upsert: boolean }) => {
          assertEquals(options.upsert, false);
          paths.push(path);
          return Promise.resolve(
            paths.length === 1
              ? { data: null, error: { statusCode: "409" } }
              : { data: {}, error: null },
          );
        },
      }),
    },
  };
  const operations = createFileOperations(admin as never);
  const result = await operations.upload(
    "a1b2c3d4",
    new File(["hello"], "notes.md", { type: "text/markdown" }),
  );
  assertEquals(paths, ["assignments/a1b2c3d4/notes.md", "assignments/a1b2c3d4/notes_1.md"]);
  assertEquals(result, {
    message: "File uploaded successfully.",
    path: "assignment-files/assignments/a1b2c3d4/notes_1.md",
  });
});

Deno.test("collision suffix follows the last extension, or the whole dotfile", async () => {
  for (const [original, expected] of [
    ["notes", "notes_1"],
    [".hidden", ".hidden_1"],
    ["report.final.pdf", "report.final_1.pdf"],
  ]) {
    const paths: string[] = [];
    const admin = {
      rpc: () => Promise.resolve({ data: true, error: null }),
      storage: {
        from: () => ({
          upload: (path: string) => {
            paths.push(path);
            return Promise.resolve(
              paths.length === 1 ? { error: { statusCode: "409" } } : { error: null },
            );
          },
        }),
      },
    };
    const result = await createFileOperations(admin as never).upload(
      "a1b2c3d4",
      new File(["x"], original, { type: "text/plain" }),
    );
    assertEquals("path" in result && result.path.endsWith(`/${expected}`), true);
  }
});

Deno.test("list reads every page and filters by stored MIME type", async () => {
  const page = Array.from({ length: 1000 }, (_, i) => ({
    id: String(i),
    name: `${String(i).padStart(4, "0")}.txt`,
    metadata: { mimetype: "text/plain" },
  }));
  const admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    storage: {
      from: () => ({
        list: (_prefix: string, options: { offset: number }) =>
          Promise.resolve({
            data: options.offset
              ? [{ id: "pdf", name: "final.pdf", metadata: { mimetype: "application/pdf" } }]
              : page,
            error: null,
          }),
      }),
    },
  };
  const result = await createFileOperations(admin as never).list({
    assignmentId: "a1b2c3d4",
    type: "pdf",
  });
  assertEquals(result, {
    files: {
      pdf: [
        {
          name: "final.pdf",
          path: "assignment-files/assignments/a1b2c3d4/final.pdf",
          mimeType: "application/pdf",
        },
      ],
    },
  });
});

Deno.test("download verifies existence and produces a time-limited link", async () => {
  let lifetime = 0;
  const admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    storage: {
      from: () => ({
        exists: () => Promise.resolve({ data: true, error: null }),
        createSignedUrl: (_path: string, seconds: number) => {
          lifetime = seconds;
          return Promise.resolve({ data: { signedUrl: "https://example.test/link" }, error: null });
        },
      }),
    },
  };
  const result = await createFileOperations(admin as never, () =>
    Date.UTC(2026, 10, 15, 12),
  ).download({ assignmentId: "a1b2c3d4", filename: "file.txt" });
  assertEquals(lifetime, 600);
  assertEquals(result, {
    downloadUrl: "https://example.test/link",
    nextStep: "Download the file using the link; it expires at 2026-11-15 12:10:00 UTC.",
  });
});

Deno.test("download expiry reflects the signed token rather than local clock", async () => {
  const payload = btoa(JSON.stringify({ exp: Date.UTC(2026, 10, 15, 12, 9, 55) / 1000 }));
  const admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    storage: {
      from: () => ({
        exists: () => Promise.resolve({ data: true, error: null }),
        createSignedUrl: () =>
          Promise.resolve({
            data: { signedUrl: `https://example.test/link?token=header.${payload}.signature` },
            error: null,
          }),
      }),
    },
  };
  const result = await createFileOperations(admin as never, () =>
    Date.UTC(2026, 10, 15, 12),
  ).download({ assignmentId: "a1b2c3d4", filename: "file.txt" });
  assertEquals("nextStep" in result && result.nextStep.includes("2026-11-15 12:09:55 UTC"), true);
});

Deno.test("invalid files and missing assignments never reach storage", async () => {
  let uploads = 0;
  const admin = {
    rpc: () => Promise.resolve({ data: false, error: null }),
    storage: {
      from: () => ({
        upload: () => {
          uploads++;
          throw new Error("unexpected upload");
        },
      }),
    },
  };
  const operations = createFileOperations(admin as never);
  for (const [id, file] of [
    ["bad", new File(["x"], "safe.txt", { type: "text/plain" })],
    ["a1b2c3d4", new File(["x"], "../unsafe", { type: "text/plain" })],
    ["a1b2c3d4", new File(["x"], "safe.txt")],
    ["a1b2c3d4", new File(["x"], "safe.txt", { type: "text/plain" })],
  ] as const)
    assertEquals("reason" in (await operations.upload(id, file)), true);
  assertEquals(uploads, 0);
});

Deno.test("unexpected storage failures are not retried or exposed", async () => {
  let uploads = 0;
  const admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    storage: {
      from: () => ({
        upload: () => {
          uploads++;
          return Promise.resolve({ error: { statusCode: "403", message: "sensitive detail" } });
        },
      }),
    },
  };
  const result = await createFileOperations(admin as never).upload(
    "a1b2c3d4",
    new File(["x"], "safe.txt", { type: "text/plain" }),
  );
  assertEquals(uploads, 1);
  assertEquals("reason" in result && result.reason.includes("sensitive detail"), false);
});

Deno.test("Unicode filenames use reversible Storage-safe keys", async () => {
  let stored = "";
  const admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    storage: {
      from: () => ({
        upload: (path: string) => {
          stored = path;
          return Promise.resolve({ data: {}, error: null });
        },
        list: () =>
          Promise.resolve({
            data: [
              { id: "1", name: stored.split("/").pop(), metadata: { mimetype: "text/plain" } },
            ],
            error: null,
          }),
        exists: (path: string) => Promise.resolve({ data: path === stored, error: null }),
        createSignedUrl: () =>
          Promise.resolve({ data: { signedUrl: "https://example.test/file" }, error: null }),
      }),
    },
  };
  const operations = createFileOperations(admin as never);
  await operations.upload("a1b2c3d4", new File(["x"], "测试 file.txt", { type: "text/plain" }));
  assertEquals(/^[\x20-\x7e]+$/.test(stored), true);
  const listed = await operations.list({ assignmentId: "a1b2c3d4" });
  assertEquals("files" in listed && listed.files.text?.[0].name, "测试 file.txt");
  assertEquals(
    "downloadUrl" in
      (await operations.download({ assignmentId: "a1b2c3d4", filename: "测试 file.txt" })),
    true,
  );
});
