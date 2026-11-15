import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignmentId,
  filename,
  fileType,
  listInput,
  downloadInput,
  type FileType,
  type ListInput,
  type DownloadInput,
} from "./contracts.ts";

const bucket = "assignment-files";
type Entry = { name: string; path: string; mimeType: string };
const storageName = (name: string) =>
  Array.from(new TextEncoder().encode(name), (byte) =>
    (byte >= 65 && byte <= 90) ||
    (byte >= 97 && byte <= 122) ||
    (byte >= 48 && byte <= 57) ||
    byte === 46 ||
    byte === 95
      ? String.fromCharCode(byte)
      : `-${byte.toString(16).padStart(2, "0")}`,
  ).join("");
const displayName = (name: string) =>
  new TextDecoder().decode(
    Uint8Array.from(name.match(/-[0-9a-f]{2}|./g) ?? [], (part) =>
      part.startsWith("-") ? parseInt(part.slice(1), 16) : part.charCodeAt(0),
    ),
  );
export function createFileOperations(admin: SupabaseClient, now: () => number = Date.now) {
  const store = admin.storage.from(bucket);
  async function exists(id: string) {
    const { data, error } = await admin.rpc("assignment_remote_files_exists", {
      p_assignment_id: id,
    });
    if (error) throw error;
    return data === true;
  }
  const prefix = (id: string) => `assignments/${id}`;
  return {
    async upload(
      id: string,
      file: File,
    ): Promise<{ message: string; path: string } | { reason: string }> {
      if (!assignmentId.safeParse(id).success) return { reason: "Invalid assignment ID." };
      if (!filename.safeParse(file.name).success)
        return { reason: "Invalid filename; use a single safe filename." };
      if (!file.type) return { reason: "The file part must include a MIME Content-Type." };
      if (file.size >= 50000000) return { reason: "The file must be smaller than 50 MB." };
      try {
        if (!(await exists(id))) return { reason: "Assignment not found." };
        const dot = file.name.lastIndexOf(".");
        const split = dot > 0 ? dot : file.name.length;
        for (let i = 0; ; i++) {
          const name = i ? `${file.name.slice(0, split)}_${i}${file.name.slice(split)}` : file.name;
          const path = `${prefix(id)}/${storageName(name)}`;
          const { error } = await store.upload(path, file, {
            contentType: file.type,
            upsert: false,
          });
          if (!error) return { message: "File uploaded successfully.", path: `${bucket}/${path}` };
          if (String(error.statusCode) !== "409") throw error;
        }
      } catch {
        return { reason: "Unable to upload the file. Try again or contact the operator." };
      }
    },
    async list(
      input: ListInput,
    ): Promise<{ files: Partial<Record<FileType, Entry[]>> } | { reason: string }> {
      if (!listInput.safeParse(input).success) return { reason: "Invalid list request." };
      try {
        if (!(await exists(input.assignmentId))) return { reason: "Assignment not found." };
        const files: Partial<Record<FileType, Entry[]>> = {};
        const limit = 1000;
        for (let offset = 0; ; offset += limit) {
          const { data, error } = await store.list(prefix(input.assignmentId), {
            limit,
            offset,
            sortBy: { column: "name", order: "asc" },
          });
          if (error) throw error;
          for (const object of data) {
            if (!object.id) continue;
            const mimeType = object.metadata?.mimetype ?? "application/octet-stream";
            const type = fileType(mimeType);
            if (input.type && input.type !== type) continue;
            (files[type] ??= []).push({
              name: displayName(object.name),
              path: `${bucket}/${prefix(input.assignmentId)}/${object.name}`,
              mimeType,
            });
          }
          if (data.length < limit) break;
        }
        for (const entries of Object.values(files))
          entries.sort((a, b) => a.name.localeCompare(b.name));
        return { files };
      } catch {
        return { reason: "Unable to list files. Try again or contact the operator." };
      }
    },
    async download(
      input: DownloadInput,
    ): Promise<{ downloadUrl: string; nextStep: string } | { reason: string }> {
      if (!downloadInput.safeParse(input).success) return { reason: "Invalid download request." };
      try {
        if (!(await exists(input.assignmentId))) return { reason: "Assignment not found." };
        const path = `${prefix(input.assignmentId)}/${storageName(input.filename)}`;
        const { data: present, error: lookupError } = await store.exists(path);
        if (lookupError) throw lookupError;
        if (!present)
          return {
            reason: `The file ${input.filename} was not found for assignment ${input.assignmentId}.`,
          };
        const started = now();
        const { data, error } = await store.createSignedUrl(path, 600);
        if (error || !data?.signedUrl) throw error;
        let expires = started + 600000;
        try {
          const token = new URL(data.signedUrl).searchParams.get("token")?.split(".")[1];
          if (token) {
            const payload = JSON.parse(atob(token.replaceAll("-", "+").replaceAll("_", "/")));
            if (typeof payload.exp === "number" && Number.isFinite(payload.exp))
              expires = payload.exp * 1000;
          }
        } catch {
          // The conservative signing-start estimate applies to non-JWT links.
        }
        const expiry = new Date(expires)
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d{3}Z$/, " UTC");
        return {
          downloadUrl: data.signedUrl,
          nextStep: `Download the file using the link; it expires at ${expiry}.`,
        };
      } catch {
        return { reason: "Unable to create a download link. Try again or contact the operator." };
      }
    },
  };
}
