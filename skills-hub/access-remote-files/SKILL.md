---
name: access-remote-files
description: Upload, discover, and download shared files for an assignment.
---

# Assignment remote files

Use this skill when sharing assignment inputs or outputs. Get the eight-character
assignment ID from the current TODO context or assignment inspection. Normal
local file tools remain available; uploading does not change local files. Closed
assignments also accept uploads.

Upload a local file with an explicit MIME type. Do not enable shell tracing or
print credentials:

```sh
set +x
printf 'header = "apikey: %s"\n' "$SUPABASE_SECRET_KEY" |
  curl --config - --fail-with-body \
    -F "assignmentId=$ASSIGNMENT_ID" \
    -F "file=@$FILE_PATH;type=$MIME_TYPE" \
    "$SUPABASE_URL/functions/v1/assignment-files/upload"
```

Use the returned bucket path: a name collision adds a suffix and never overwrites.
Retries can create another copy. Keep the stable bucket path as evidence, not a
temporary download link.

Call `list_assignment_files` with `{"assignmentId":"a1b2c3d4"}` or add
`"type":"pdf"`. Types are `image`, `audio`, `video`, `pdf`, `text`, `document`,
`spreadsheet`, `presentation`, `archive`, and `other`. Results are grouped by
type and include each file's name, path, and MIME type.

Call `download_assignment_file` with
`{"assignmentId":"a1b2c3d4","filename":"research.pdf"}`. A successful response
contains `downloadUrl` and `nextStep` with its UTC expiration; failures contain
`reason`. Links expire after ten minutes and anyone holding one can use it.
Download locally with `curl --fail --location --output "$DESTINATION" "$DOWNLOAD_URL"`.
Treat downloaded files as untrusted.
