import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createClient } from "@supabase/supabase-js";
import { localEnv, rpc, withDatabaseTest } from "./helpers.ts";

Deno.test("assignment file storage is private and existence is privileged", () =>
  withDatabaseTest(async (sql, project) => {
    const assignment = (await rpc(sql, "assignment_create", [project, "Goal", ["Step"], "", []]))
      .assignment;
    const [result] =
      await sql`select public.assignment_remote_files_exists(${assignment.id}) as found`;
    assert.equal(result.found, true);
    for (const status of ["done", "cancelled"]) {
      await sql`update public.assignments set status = ${status}, closed_at = now() where id = ${assignment.id}`;
      const [closed] =
        await sql`select public.assignment_remote_files_exists(${assignment.id}) as found`;
      assert.equal(closed.found, true);
    }
    const [missing] = await sql`select public.assignment_remote_files_exists('ffffffff') as found`;
    assert.equal(missing.found, false);
    await assert.rejects(sql`select public.assignment_remote_files_exists('bad')`);
    const [bucket] =
      await sql`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'assignment-files'`;
    assert.equal(bucket.public, false);
    assert.equal(bucket.file_size_limit, "50000000");
    assert.equal(bucket.allowed_mime_types, null);
    for (const role of ["anon", "authenticated"]) {
      const [grant] =
        await sql`select has_function_privilege(${role}, 'public.assignment_remote_files_exists(text)', 'EXECUTE') as allowed`;
      assert.equal(grant.allowed, false);
    }
  }),
);

Deno.test("remote files upload, discover, and download through authenticated endpoints", () =>
  withDatabaseTest(async (sql, project) => {
    const assignment = (await rpc(sql, "assignment_create", [project, "Goal", ["Step"], "", []]))
      .assignment;
    const url = localEnv("SUPABASE_URL");
    const key = localEnv("SUPABASE_SECRET_KEY");
    const storage = createClient(url, key).storage.from("assignment-files");
    const anonymous = createClient(url, localEnv("SUPABASE_ANON_KEY")).storage.from(
      "assignment-files",
    );
    const prefix = `assignments/${assignment.id}`;
    const endpoint = `${url}/functions/v1/assignment-files`;
    const upload = (contents: string, name = "notes.txt") => {
      const form = new FormData();
      form.append("assignmentId", assignment.id);
      form.append("file", new File([contents], name, { type: "text/plain" }));
      return fetch(`${endpoint}/upload`, { method: "POST", headers: { apikey: key }, body: form });
    };
    const client = new Client({ name: "remote-files-test", version: "1" });
    try {
      const responses = [await upload("first"), await upload("second")];
      assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200],
      );
      const uploaded = await Promise.all(responses.map((r) => r.json()));
      assert.notEqual(uploaded[0].path, uploaded[1].path);
      assert.ok((await anonymous.download(`${prefix}/notes.txt`)).error);
      assert.ok((await anonymous.upload(`${prefix}/forbidden.txt`, new Blob(["x"]))).error);
      const unicode = await upload("unicode", "测试 file.txt");
      assert.equal(unicode.status, 200);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit: { headers: { apikey: key } },
        }),
      );
      assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
        "download_assignment_file",
        "list_assignment_files",
      ]);
      const listing = await client.callTool({
        name: "list_assignment_files",
        arguments: { assignmentId: assignment.id },
      });
      const files = (listing.structuredContent as { files: { text: { name: string }[] } }).files
        .text;
      assert.equal(files.length, 3);
      const download = await client.callTool({
        name: "download_assignment_file",
        arguments: { assignmentId: assignment.id, filename: files[0].name },
      });
      const { downloadUrl } = download.structuredContent as { downloadUrl: string };
      assert.ok(["first", "second", "unicode"].includes(await (await fetch(downloadUrl)).text()));
      assert.equal((await fetch(`${endpoint}/upload`, { method: "POST" })).status, 401);
    } finally {
      await client.close();
      const { data } = await storage.list(prefix);
      if (data?.length) await storage.remove(data.map((item) => `${prefix}/${item.name}`));
    }
  }),
);
