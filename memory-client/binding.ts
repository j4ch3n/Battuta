import { z } from "zod";

export const requestBindingSchema = z
  .object({
    request_id: z.string().trim().min(1).max(200),
    conversation_id: z.string().trim().min(1).max(200),
    session_id: z.string().trim().min(1).max(200),
    project: z.string().nullable(),
    origin: z.enum(["owner", "mail", "internal"]),
    admitted_at: z.string().datetime({ offset: true }),
    mail_ref: z
      .object({ conversation_id: z.string().min(1), id: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();
export type RequestBinding = z.infer<typeof requestBindingSchema>;

export function resolveRequestBinding(value: unknown): Promise<RequestBinding> {
  return Promise.resolve().then(() => requestBindingSchema.parse(value));
}
