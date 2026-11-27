"""Dream house-clean: physically remove memories retired long enough ago, with their index rows and empty folders."""

import datetime as dt

from agent_memory.core import timestamp
from agent_memory.core.locking import store_lock

RETENTION = dt.timedelta(days=30)


def purge_retired(store) -> dict:
    """Like the core's gc, but only for memories retired before the retention cutoff."""
    cutoff = store.clock.now() - RETENTION
    purged = []
    with store_lock(store.layout):
        for record in store.records(include_invalid=True):
            if record.is_active() or record.path is None or timestamp.parse(record.invalid_at) >= cutoff:
                continue
            record.path.unlink(missing_ok=True)
            purged.append(record.name)
            top, folder = store.layout.type_dir(record.type).resolve(), record.path.parent.resolve()
            while folder != top and top in folder.parents and not any(folder.iterdir()):
                folder.rmdir()
                folder = folder.parent
    report = store.sync_index()  # drops the purged files' search and embedding rows
    return {"purged": sorted(purged),
            "dangling_links": [[source, target] for source, target in report.dangling_links if target in purged]}
