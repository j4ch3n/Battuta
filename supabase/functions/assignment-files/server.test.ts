import assert from "node:assert/strict";
import { createFileHandler } from "./server.ts";

Deno.test("multipart upload validates fields and returns actual path", async () => {
  const handler = createFileHandler({
    upload: (_id: string, file: File) =>
      Promise.resolve({
        message: "File uploaded successfully.",
        path: `assignment-files/${file.name}`,
      }),
  } as never);
  const form = new FormData();
  form.append("assignmentId", "a1b2c3d4");
  form.append("file", new File(["x"], "hello.txt", { type: "text/plain" }));
  const result = await handler(
    new Request("http://localhost/assignment-files/upload", { method: "POST", body: form }),
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).path, "assignment-files/hello.txt");
  form.append("assignmentId", "a1b2c3d4");
  const invalid = await handler(
    new Request("http://localhost/assignment-files/upload", { method: "POST", body: form }),
  );
  assert.equal(invalid.status, 400);
});

Deno.test("download link uses the public forwarded gateway origin", async () => {
  const { publicDownloadUrl } = await import("./server.ts");
  const request = new Request("http://internal/functions/v1/assignment-files", {
    headers: {
      "x-forwarded-host": "127.0.0.1",
      "x-forwarded-port": "55321",
      "x-forwarded-proto": "http",
    },
  });
  assert.equal(
    publicDownloadUrl(request, "http://kong:8000/storage/v1/object/sign/file?token=secret"),
    "http://127.0.0.1:55321/storage/v1/object/sign/file?token=secret",
  );
});

Deno.test("multipart rejects a file part without an explicit MIME type", async () => {
  const handler = createFileHandler({
    upload: () => Promise.resolve({ message: "unexpected", path: "unexpected" }),
  } as never);
  const body =
    '--test\r\nContent-Disposition: form-data; name="assignmentId"\r\n\r\na1b2c3d4\r\n--test\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\n\r\nhello\r\n--test--\r\n';
  const response = await handler(
    new Request("http://localhost/assignment-files/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body,
    }),
  );
  assert.equal(response.status, 400);
});
