import { z } from "zod";

export const types = [
  "image",
  "audio",
  "video",
  "pdf",
  "text",
  "document",
  "spreadsheet",
  "presentation",
  "archive",
  "other",
] as const;
export type FileType = (typeof types)[number];
export const assignmentId = z.string().regex(/^[0-9a-f]{8}$/);
export const filename = z
  .string()
  .refine((s) => !!s.trim() && s !== "." && s !== ".." && !/[/\\\p{Cc}]/u.test(s));
export const listInput = z.strictObject({ assignmentId, type: z.enum(types).optional() });
export const downloadInput = z.strictObject({ assignmentId, filename });
export type ListInput = z.infer<typeof listInput>;
export type DownloadInput = z.infer<typeof downloadInput>;
const failure = z.object({ reason: z.string() });
const entry = z.object({ name: z.string(), path: z.string(), mimeType: z.string() });
export const listOutput = z.union([
  z.object({ files: z.partialRecord(z.enum(types), z.array(entry)) }),
  failure,
]);
export const downloadOutput = z.union([
  z.object({ downloadUrl: z.string(), nextStep: z.string() }),
  failure,
]);

export function fileType(input: string): FileType {
  const mime = input.split(";")[0].trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (
    [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
    ].includes(mime)
  )
    return "spreadsheet";
  if (
    [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.oasis.opendocument.text",
    ].includes(mime)
  )
    return "document";
  if (
    [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.oasis.opendocument.presentation",
    ].includes(mime)
  )
    return "presentation";
  if (
    [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-tar",
      "application/gzip",
      "application/x-7z-compressed",
      "application/vnd.rar",
    ].includes(mime)
  )
    return "archive";
  for (const type of ["image", "audio", "video"] as const)
    if (mime.startsWith(`${type}/`)) return type;
  if (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/x-yaml",
    ].includes(mime) ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  )
    return "text";
  return "other";
}
