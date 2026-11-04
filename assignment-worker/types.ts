import type { Static } from "typebox";
import type { AssignmentSchema, TodoSchema, DetailSchema, FailureSchema } from "./contracts.ts";
export type { ExecutionResult } from "./contracts.ts";
import type { ExecutionResult } from "./contracts.ts";
export type AssignmentView = Static<typeof AssignmentSchema>;
export type TodoRow = Static<typeof TodoSchema>;
export type Detail = Static<typeof DetailSchema>;
export type AssignmentFailure = Static<typeof FailureSchema>;
export type Target = { project: string; assignment_id: string };
export type Claim = Target & { claimed_at: string };
export type TodoTarget = Claim & { position: number; expected_updated_at: string };
export type Binding = Claim & { session_file: string };
export type MailDelivery =
  | { state: "sent"; reference: { conversation_id: string; id: string } }
  | { state: "failed" | "uncertain"; explanation: string };
export type AssignmentClientConfig = { supabaseUrl: string; secretKey: string };
export interface AssignmentClient {
  list(input: {
    project?: string;
    status?: AssignmentView["status"];
  }): Promise<{ ok: true; assignments: AssignmentView[] }>;
  get(target: Target): Promise<Detail>;
  claim(target: Target): Promise<Detail>;
  start(target: TodoTarget): Promise<{ ok: true; assignment: AssignmentView; todo: TodoRow }>;
  record(
    input: TodoTarget & ExecutionResult,
  ): Promise<{ ok: true; assignment: AssignmentView; todo: TodoRow }>;
  block(input: Claim & { blocker: string }): Promise<{ ok: true; assignment: AssignmentView }>;
  finish(input: Claim): Promise<{ ok: true; assignment: AssignmentView }>;
  close(): Promise<void>;
}
export interface ExecutionSessions {
  isIdle(): boolean;
  hasPendingMessages(): boolean;
  openAssignmentSession(detail: Detail): Promise<Binding>;
  runTodo(binding: Binding, todo: TodoRow, detail: Detail): Promise<void>;
  appendEntry(kind: string, data: unknown): void;
}
export type ReconcileReason = "startup" | "reconnect" | "idle" | "event" | "fallback";
export interface CoordinatorOptions {
  assignments: AssignmentClient;
  sessions: ExecutionSessions;
  notify(detail: Detail): Promise<MailDelivery>;
  diagnostics(event: string, error?: unknown): void;
}
export interface Coordinator {
  reconcile(reason: ReconcileReason): Promise<void>;
  restoreBinding(binding: Binding): Promise<void>;
  acceptReport(value: unknown): Promise<{ accepted: true }>;
  observeBoundary(outcome: "completed" | "aborted" | "error"): void;
  settle(event: { aborted: boolean }): Promise<void>;
  stop(): Promise<void>;
}
