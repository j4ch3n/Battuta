import assert from "node:assert/strict";
import { rpc, withDatabaseTest } from "./helpers.ts";

Deno.test("assignment file storage is private and existence is privileged", () =>
  withDatabaseTest(async (sql, project) => {
    const assignment = (await rpc(sql, "assignment_create", [project, "Goal", ["Step"], "", []]))
      .assignment;
    const [result] =
      await sql`select public.assignment_remote_files_exists(${assignment.id}) as found`;
    assert.equal(result.found, true);
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
