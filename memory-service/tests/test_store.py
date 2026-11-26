import unittest

from agent_memory.core.errors import ValidationError
from battuta_memory.store import write_catalog
from helpers import entity, make_store


class StoreRuleTests(unittest.TestCase):
    def setUp(self):
        self.store = make_store(self, projects=("battuta", "acme-site"))

    def test_derives_unique_names_across_projects_and_types(self):
        self.store.record(**entity("battuta", "acme", "Acme is the client for battuta"))
        self.store.record(**entity("acme-site", "acme", "Acme owns the acme-site project"))
        self.store.record(type="fact", fields={"project": "global", "subject": "acme"}, abstract="Acme is a London firm")
        paths = {record.name: record.path.relative_to(self.store.root).as_posix() for record in self.store.records()}
        self.assertEqual(paths, {
            "battuta-entity-acme": "entity/battuta/battuta-entity-acme.md",
            "acme-site-entity-acme": "entity/acme-site/acme-site-entity-acme.md",
            "global-fact-acme": "fact/global/global-fact-acme.md",
        })

    def test_same_key_upserts_same_file(self):
        for _ in range(2):
            self.store.record(**entity("battuta", "acme", "Acme is the client", "Signed in 2026"))
        self.assertEqual([record.name for record in self.store.records()], ["battuta-entity-acme"])

    def test_rejects_unknown_project_and_lists_catalog(self):
        with self.assertRaises(ValidationError) as caught:
            self.store.record(**entity("atlas", "acme", "Acme"))
        self.assertIn("acme-site, battuta, global", str(caught.exception.errors))

    def test_rejects_overview_outside_wrapper(self):
        spec = {"type": "overview", "fields": {"project": "battuta", "subject": "2026-11-26"}, "abstract": "Battuta digest", "body": "Digest."}
        with self.assertRaises(ValidationError):
            self.store.record(**spec)
        with self.store.overview_writes():
            written = self.store.record(**spec)
        self.assertEqual(written.name, "battuta-overview-2026-11-26")

    def test_check_many_applies_same_rules(self):
        refused = self.store.check_many([
            {"type": "overview", "fields": {"project": "battuta", "subject": "x"}, "abstract": "digest"},
            entity("atlas", "acme", "Acme"),
            entity("battuta", "acme", "Acme is the client"),
        ])
        self.assertEqual([item.index for item in refused], [0, 1])

    def test_catalog_slug_collision_refused(self):
        with self.assertRaises(ValueError):
            write_catalog(self.store.root, ["Acme Site", "acme-site"])


if __name__ == "__main__":
    unittest.main()
