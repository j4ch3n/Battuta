/** Contracts consumed from the pinned Stone utilities. */
import type { DatabaseSync } from "node:sqlite";

export type RecordKind =
  "decision" | "preference" | "task" | "error_resolution" | "turn_summary" | "session_summary";
export type Scope = "project" | "global";
export interface MemoryRecord {
  id: string;
  kind: RecordKind;
  scope: Scope;
  project_id: string | null;
  text: string;
  tags: string | null;
  status: string;
  created_at: number;
  confidence: number;
  importance: number;
  session_id: string | null;
  entry_id_start: string | null;
  entry_id_end: string | null;
}
export interface RecordInput {
  kind: RecordKind;
  text: string;
  scope?: Scope;
  project_id?: string | null;
  tags?: string | null;
  importance?: number;
  confidence?: number;
  status?: string;
  session_id?: string;
  session_file?: string;
  branch_leaf_id?: string;
  entry_id_start?: string;
  entry_id_end?: string;
}
export interface RankedRecord {
  record: MemoryRecord;
  score: number;
  reasons: string[];
}
export interface SessionEntry {
  id: string;
  type: string;
  timestamp?: string;
  message?: { role?: string; content?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}
export interface ParsedTurn {
  userEntryId: string;
  userPrompt: string;
  assistantEntryIds: string[];
  assistantText: string;
  toolCalls: unknown[];
  errors: unknown[];
  lastEntryId: string;
}
export interface RecordPayload {
  kind: RecordKind;
  text: string;
  scope: Scope;
  tags?: string;
  entryIdStart?: string;
  entryIdEnd?: string;
  fileActivities?: { entryId: string; path: string; action: string }[];
}
export interface StoneDb {
  getDb(): DatabaseSync;
  closeDb(): void;
  upsertRecord(record: RecordInput): string;
  getRecord(id: string): MemoryRecord | undefined;
  listRecords(options?: { includeInactive?: boolean }): MemoryRecord[];
  buildFtsQuery(query: string): string;
  softForgetRecord(id: string): boolean;
  hardDeleteRecord(id: string): boolean;
  upsertSession(input: {
    id: string;
    session_file: string;
    cwd: string;
    project_id: string;
    branch_leaf_id?: string;
  }): void;
  getIndexState(path: string): { last_indexed_entry_id: string | null } | undefined;
  upsertIndexState(input: {
    session_file: string;
    session_id: string;
    last_indexed_entry_id: string;
    last_indexed_entry_timestamp?: string;
    branch_leaf_id?: string;
  }): void;
  insertFileActivity(input: {
    record_id: string;
    project_id: string;
    path: string;
    action: string;
    entry_id: string;
  }): void;
  getRecentFilePaths(projectId: string | null, limit?: number): string[];
  insertInjection(input: {
    session_id: string;
    turn_entry_id?: string;
    prompt_hash: string;
    injected_refs: string;
    packet: string;
    reasons: string;
  }): void;
  getLastInjection(sessionId: string): { packet: string } | undefined;
}
export interface Stone {
  db: StoneDb;
  retrieval: {
    rankAndFilter(
      records: (MemoryRecord & { rank: number })[],
      projectId: string | null,
      crossProjectEnabled: boolean,
    ): RankedRecord[];
  };
  privacy: {
    redactSecrets(text: string): string;
    isSensitiveForGlobalMemory(text: string): boolean;
  };
  parser: {
    parseEntries(entries: SessionEntry[]): { turns: ParsedTurn[] };
    turnsToRecords(
      turns: ParsedTurn[],
      projectId: string,
      sessionId: string,
      sessionFile: string,
    ): RecordPayload[];
  };
  visibility: { isRecordVisibleInProject(record: MemoryRecord, projectId: string | null): boolean };
}
