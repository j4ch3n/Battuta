import type { ProjectBinding } from "./binding.ts";
import type { SessionEntry } from "./stone.ts";
import type { MemoryStore } from "./store.ts";
import { redactHistoryEntry } from "./privacy.ts";

export function indexRequest(
  store: MemoryStore,
  binding: ProjectBinding,
  sessionId: string,
  sessionFile: string,
  entries: SessionEntry[],
) {
  const last = entries.at(-1);
  if (!last || store.stone.db.getIndexState(sessionFile)?.last_indexed_entry_id === last.id) return;
  const { turns } = store.stone.parser.parseEntries(
    entries.map((entry) => redactHistoryEntry(store.stone, entry)),
  );
  const records = store.stone.parser.turnsToRecords(
    turns,
    binding.projectId,
    sessionId,
    sessionFile,
  );
  store.transaction(() => {
    store.stone.db.upsertSession({
      id: sessionId,
      session_file: sessionFile,
      cwd: binding.checkout,
      project_id: binding.projectId,
    });
    for (const payload of records) {
      const id = store.write({
        kind: payload.kind,
        scope: "project",
        project_id: binding.projectId,
        text: payload.text,
        tags: payload.tags,
        session_id: sessionId,
        session_file: sessionFile,
        branch_leaf_id: last.id,
        entry_id_start: payload.entryIdStart,
        entry_id_end: payload.entryIdEnd,
      });
      for (const activity of payload.fileActivities ?? [])
        store.stone.db.insertFileActivity({
          record_id: id,
          project_id: binding.projectId,
          path: activity.path,
          action: activity.action,
          entry_id: activity.entryId,
        });
    }
    store.stone.db.upsertIndexState({
      session_file: sessionFile,
      session_id: sessionId,
      last_indexed_entry_id: last.id,
      last_indexed_entry_timestamp: last.timestamp,
      branch_leaf_id: last.id,
    });
  });
}
