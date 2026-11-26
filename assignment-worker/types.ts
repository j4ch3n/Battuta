import type { Static } from "typebox";
import type { AssignmentSchema, TodoSchema, DetailSchema, FailureSchema } from "./contracts.ts";
export type { ExecutionResult, LifecycleSettings, LifecycleMessage } from "./contracts.ts";
import type { LifecycleSettings } from "./contracts.ts";
import type { ExecutionResult } from "./contracts.ts";
export type AssignmentView = Static<typeof AssignmentSchema>;
export type TodoRow = Static<typeof TodoSchema>;
export type Detail = Static<typeof DetailSchema>;
export type AssignmentFailure = Static<typeof FailureSchema>;
export type Target = { project: string; assignment_id: string };
export type Claim = Target & { claimed_at: string; claimed_by: string | null };
export type TodoTarget = Claim & { position: number; expected_updated_at: string };
export type Binding = Claim & { session_file: string };
export type Workspace = { directory: string; notePath: string };
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
  claim(
    target: Target & { claimed_by: string; abilities: string[]; conversation_id: string },
  ): Promise<Detail>;
  renew(input: Claim): Promise<{ ok: true; assignment: AssignmentView }>;
  settings(): Promise<LifecycleSettings>;
  start(target: TodoTarget): Promise<{ ok: true; assignment: AssignmentView; todo: TodoRow }>;
  record(
    input: TodoTarget & ExecutionResult,
  ): Promise<{ ok: true; assignment: AssignmentView; todo: TodoRow }>;
  block(input: Claim & { blocker: string }): Promise<{ ok: true; assignment: AssignmentView }>;
  finish(input: Claim): Promise<{ ok: true; assignment: AssignmentView }>;
  close(): Promise<void>;
}
export interface ExecutionSessions {
  prepareWorkspace(target: Target): Promise<Workspace>;
  isIdle(): boolean;
  hasPendingMessages(): boolean;
  openAssignmentSession(detail: Detail): Promise<Binding>;
  runTodo(binding: Binding, todo: TodoRow, detail: Detail, workspace: Workspace): void;
  /** Sends the agent a reminder that starts a turn. */
  remind(text: string): void;
  /** Aborts the agent's current turn. */
  abort(): void;
  appendEntry(kind: string, data: unknown): void;
}
export type ReconcileReason = "startup" | "reconnect" | "idle" | "event" | "fallback";
/** The delegate runs as the coordinator sees them: whether one is active, and how to stop it. */
export interface RunTracker {
  isRunActive(): boolean;
  stop(): Promise<unknown>;
}
export interface CoordinatorOptions {
  workerId: string;
  capabilities: string[];
  /** The conversation the database mails the Manager in if this claim's lease lapses. */
  conversationId: string;
  settings: LifecycleSettings;
  assignments: AssignmentClient;
  sessions: ExecutionSessions;
  notify: (detail: Detail) => Promise<MailDelivery>;
  diagnostics: (event: string, error?: unknown) => void;
  /** Absent in tests and bots without delegation: then no run is ever active. */
  runs?: RunTracker;
  /** The worker's question to the Manager, when one is waiting. */
  asks?: { readonly waiting: boolean; cancel(): void };
}
export interface Coordinator {
  reconcile(reason: ReconcileReason): Promise<void>;
  restoreBinding(binding: Binding): Promise<void>;
  /** Records the TODO now, then dispatches the next one or finishes the assignment. */
  acceptReport(value: unknown): Promise<{ accepted: true }>;
  /** The agent ended with an error or was aborted: block with this explanation. */
  agentFailed(blocker: string): Promise<void>;
  /** The agent went idle: remind once, then block, when the TODO has no report. */
  agentIdle(): Promise<void>;
  /** The claim is gone: stop the run and the agent, drop the binding. */
  leaseLost(reason: string): Promise<void>;
  stop(): Promise<void>;
  on(event: "bound" | "unbound", listener: (binding: Binding) => void): void;
}
