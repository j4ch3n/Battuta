import type { ProjectBinding } from "./binding.ts";
import type { Stone, Scope, RecordKind, RecordInput, MemoryRecord } from "./stone.ts";
import { MemoryDatabase } from "./database.ts";
import { searchScope } from "./recall.ts";
import { requireSafeMemory } from "./privacy.ts";
import { globalDowngradeReason } from "./global-policy.ts";
import { fingerprint } from "./suppression.ts";

export type MemoryStatus = "active" | "soft_forgotten";

export interface RememberInput {
  kind: RecordKind;
  text: string;
  scope?: Scope;
  tags?: string;
  importance?: number;
}
export class MemoryStore {
  readonly stone: Stone;
  readonly path: string;
  private readonly database: MemoryDatabase;
  private constructor(database: MemoryDatabase) {
    this.database = database;
    this.stone = database.stone;
    this.path = database.path;
  }

  static async open(path: string): Promise<MemoryStore> {
    return new MemoryStore(await MemoryDatabase.open(path));
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation);
  }

  private projectId(binding: ProjectBinding | null, scope: Scope) {
    if (scope === "global") return null;
    if (!binding) throw new Error("Select a valid project before using project memory");
    return binding.projectId;
  }

  search(
    binding: ProjectBinding | null,
    query: string,
    scope: Scope,
    limit = 5,
    kind?: RecordKind,
  ) {
    const projectId = this.projectId(binding, scope);
    if (!query.trim())
      throw new Error("Memory search query must not be blank; use memory_list to list entries");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new Error("Memory search limit must be between 1 and 20");
    return searchScope(this.stone, projectId, query, scope, limit, kind);
  }

  list(
    binding: ProjectBinding | null,
    scope: Scope,
    status: MemoryStatus = "active",
  ): MemoryRecord[] {
    const projectId = this.projectId(binding, scope);
    return this.stone.db
      .listRecords({ includeInactive: status !== "active" })
      .filter(
        (record) =>
          record.scope === scope && record.project_id === projectId && record.status === status,
      );
  }

  open(
    binding: ProjectBinding | null,
    ref: string,
    status: MemoryStatus | "any" = "active",
  ): MemoryRecord {
    const record = this.stone.db.getRecord(ref);
    if (
      !record ||
      (status === "any"
        ? !["active", "soft_forgotten"].includes(record.status)
        : record.status !== status) ||
      !this.stone.visibility.isRecordVisibleInProject(record, binding?.projectId ?? null)
    )
      throw new Error("Memory record is not available in this scope/project");
    return record;
  }

  remember(binding: ProjectBinding | null, input: RememberInput) {
    const text = input.text.trim();
    if (!text) throw new Error("Memory text must not be blank");
    const sensitiveText = `${text}\n${input.tags ?? ""}`;
    requireSafeMemory(this.stone, sensitiveText);
    const requested = input.scope ?? "project";
    const downgradeReason =
      requested === "global"
        ? globalDowngradeReason(this.stone, input.kind, sensitiveText)
        : undefined;
    const downgraded = downgradeReason !== undefined;
    const scope = downgraded ? "project" : requested;
    const projectId = this.projectId(binding, scope);
    if (
      input.importance !== undefined &&
      (!Number.isFinite(input.importance) || input.importance < 0 || input.importance > 1)
    )
      throw new Error("Importance must be between 0 and 1");
    const id = this.write(
      {
        ...input,
        text,
        scope,
        project_id: projectId,
        confidence: 1,
        status: "active",
      },
      true,
    )!;
    return { record: this.open(binding, id), downgraded, downgradeReason };
  }

  write(input: RecordInput, intentional = false): string | undefined {
    return this.transaction(() => {
      const db = this.stone.db.getDb();
      const key = fingerprint(input);
      if (intentional) db.prepare("DELETE FROM battuta_suppression WHERE fingerprint = ?").run(key);
      else if (db.prepare("SELECT 1 FROM battuta_suppression WHERE fingerprint = ?").get(key))
        return;
      return this.stone.db.upsertRecord(input);
    });
  }

  replace(binding: ProjectBinding | null, ref: string, input: RememberInput) {
    return this.transaction(() => {
      const previous = this.open(binding, ref);
      const saved = this.remember(binding, { ...input, scope: previous.scope });
      if (saved.record.scope !== previous.scope)
        throw new Error("Correction cannot change memory scope");
      if (saved.record.id === ref) throw new Error("Correction must change the memory content");
      this.forget(binding, ref);
      return saved;
    });
  }

  forget(binding: ProjectBinding | null, ref: string, hard = false): MemoryRecord {
    return this.transaction(() => {
      const record = this.open(binding, ref, "any");
      this.stone.db
        .getDb()
        .prepare("INSERT OR IGNORE INTO battuta_suppression (fingerprint) VALUES (?)")
        .run(fingerprint(record));
      // Retired content must not remain in stored recall packets either.
      this.stone.db
        .getDb()
        .prepare("DELETE FROM injections WHERE injected_refs LIKE ?")
        .run(`%${ref}%`);
      if (hard) this.stone.db.hardDeleteRecord(ref);
      else this.stone.db.softForgetRecord(ref);
      return record;
    });
  }

  close() {
    this.database.close();
  }
}
