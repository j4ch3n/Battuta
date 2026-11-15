# Assignment remote files

Workers share files through the private `assignment-files` Storage bucket, under
`assignments/<assignment-id>/<filename>`. IDs are globally unique. Assignments
must exist, but their status does not restrict uploads. Closing an assignment
does not delete its files. This is independent of local assignment notes, whose
closed-assignment editing restrictions still apply.

The `assignment-files` Edge Function authenticates requests using the shared
Supabase secret in the `apikey` header. This is privileged access, not isolation
between bots or assignments. The bucket is not public. A signed download URL
can be used by anyone holding it until its ten-minute expiry.

`POST /functions/v1/assignment-files/upload` accepts multipart fields
`assignmentId` and `file`. Supply a filename and file-part MIME type. Files must
be smaller than 50,000,000 bytes. On success the response contains `message`
and the complete bucket `path`; failures contain `reason`. The uploader uses
non-upserting writes and retries sequential name conflicts with `_1`, `_2`,
etc. Simultaneous uploads with the same name can race in Storage and may lose
one file; avoid them.
Storage keys encode characters outside ASCII letters, digits, dots, and
underscores as a hyphen followed by their UTF-8 byte in hexadecimal. Listing
returns the original filename, while `path` is the actual encoded bucket path.
Use the returned path as-is rather than constructing it from the filename.

The function's MCP endpoint exposes `list_assignment_files` and
`download_assignment_file`. List takes `assignmentId` and an optional `type`
and returns all matching files grouped by type. Categories are image, audio,
video, pdf, text, document, spreadsheet, presentation, archive, and other. The
supplied MIME metadata determines the group, not the filename; CSV is a
spreadsheet, JSON is text, and recognized Office and OpenDocument types use
their document categories. Unknown types use other. MIME metadata does not
prove file content is safe.

Download takes `assignmentId` and `filename`. It checks the object exists before
returning `downloadUrl` and `nextStep`, which states the UTC expiry; failure
returns only `reason`. Stable bucket paths are suitable for evidence; signed
URLs are not. The list operation has no client pagination and very large folders
can produce large responses.

Deployment must confirm the Edge Function's request and memory limits support
multipart files below 50 MB; the local Storage limit alone does not prove this.
