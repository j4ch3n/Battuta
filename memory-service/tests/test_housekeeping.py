import datetime as dt
import unittest

from agent_memory.core.clock import FrozenClock

from battuta_memory.housekeeping import purge_retired
from battuta_memory.reads import Reads
from helpers import entity, make_store


class PurgeRetiredTests(unittest.TestCase):
    def setUp(self):
        self.store = make_store(self)
        self.store.clock = FrozenClock(dt.datetime(2026, 10, 1, tzinfo=dt.UTC))

    def add(self, subject, project="mocktest", **extra):
        return self.store.record(**entity(project, subject, f"{subject} is a contact for {project}", **extra)).name

    def names(self):
        return {record.name for record in self.store.records(include_invalid=True)}

    def test_purges_by_retirement_age(self):
        for days, purged in ((31, True), (29, False)):
            with self.subTest(days=days):
                slug = self.add(f"acme-{days}")
                path = self.store.find(slug).path
                self.store.delete(slug)
                self.store.clock.advance(days=days)
                report = purge_retired(self.store)
                self.assertEqual(slug in report["purged"], purged)
                self.assertEqual(path.exists(), not purged)
                self.assertEqual(self.store.find(slug) is None, purged)

    def test_active_memories_are_kept(self):
        slug = self.add("acme-ltd")
        self.store.clock.advance(days=365)
        self.assertEqual(purge_retired(self.store)["purged"], [])
        self.assertTrue(self.store.find(slug).is_active())

    def index_rows(self, slug, path):
        relative = path.relative_to(self.store.root).as_posix()
        with self.store._database.connect() as connection:
            return {table: connection.execute(f"SELECT count(*) FROM {table} WHERE path = ?", (relative,)).fetchone()[0]
                    for table in ("files", "records", "vector_files", "vector_chunks")}

    def test_purged_memory_leaves_search_and_embedding_index(self):
        slug = self.add("acme-ltd")
        path = self.store.find(slug).path
        self.store.delete(slug)
        self.assertTrue(all(self.index_rows(slug, path).values()))
        self.store.clock.advance(days=31)
        purge_retired(self.store)
        self.assertEqual(set(self.index_rows(slug, path).values()), {0})
        self.assertNotIn(slug, [memory["name"] for memory in Reads(self.store).recall(query="acme contact")["memories"]])

    def test_prunes_empty_folders_but_keeps_type_folder_and_occupied_folders(self):
        alone, shared = self.add("acme-ltd"), self.add("beta-ltd", project="battuta")
        neighbour = self.add("gamma-ltd", project="battuta")
        alone_dir, shared_dir = self.store.find(alone).path.parent, self.store.find(shared).path.parent
        self.store.delete(alone)
        self.store.delete(shared)
        self.store.clock.advance(days=31)
        purge_retired(self.store)
        self.assertFalse(alone_dir.exists())
        self.assertTrue(shared_dir.exists())
        self.assertTrue(self.store.layout.type_dir("entity").is_dir())
        self.assertTrue(self.store.find(neighbour).is_active())

    def test_second_run_does_nothing(self):
        slug = self.add("acme-ltd")
        self.store.delete(slug)
        self.store.clock.advance(days=31)
        self.assertEqual(purge_retired(self.store)["purged"], [slug])
        before = self.names()
        self.assertEqual(purge_retired(self.store), {"purged": [], "dangling_links": []})
        self.assertEqual(self.names(), before)

    def test_reports_links_left_pointing_at_purged_memory(self):
        old = self.add("acme-ltd")
        new = self.add("acme-group", links=[old])
        self.store.delete(old)
        self.store.clock.advance(days=31)
        self.assertEqual(purge_retired(self.store)["dangling_links"], [[new, old]])


if __name__ == "__main__":
    unittest.main()
