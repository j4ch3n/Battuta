import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from battuta_memory.config import MemoryConfig
from battuta_memory.contracts import RememberRequest, UpdateRequest, LinkRequest, ForgetRequest, ListRequest
from battuta_memory.service import MemoryService
from battuta_memory.state import StateStore
from battuta_memory.upstream import UpstreamAdapter


class StorageFixture(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        config = MemoryConfig(data_dir=self.root)
        config.configure_upstream()
        from mcp_memory_service.storage.sqlite_vec import SqliteVecMemoryStorage
        async def fake_model(storage):
            storage.embedding_dimension = 384
            storage.embedding_model = object()
        self.patches = [patch.object(SqliteVecMemoryStorage, "_initialize_embedding_model", fake_model),
            patch.object(SqliteVecMemoryStorage, "_generate_embedding", return_value=[1.0] + [0.0] * 383)]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        storage = UpstreamAdapter.create_storage(config)
        await storage.initialize()
        self.addAsyncCleanup(storage.close)
        self.adapter = UpstreamAdapter(storage)
        self.adapter.embed = lambda _: b"valid"
        self.state = StateStore.open(self.root / "state.db")
        self.addCleanup(self.state.close)
        self.service = MemoryService(self.adapter, config, self.state)

    def note(self, content="Original fact", project="atlas", key=None):
        return RememberRequest(content=content, projects=[project] if project is not None else ["global"], idempotency_key=key)


class MutationTests(StorageFixture):
    async def test_frozen_v3_retirement_can_promote_stage_without_changing_claim(self):
        from battuta_memory.contracts import SetMetadataRequest
        from test_records import SOURCE, fact
        values = dict(projects=["global"], sources=[SOURCE], memory_metadata=fact()["memory_metadata"])
        old = await self.service.remember(RememberRequest(content="Legacy original", **values))
        new = await self.service.remember(RememberRequest(content="Legacy replacement", **values))
        original = await self.adapter.get(old["ref"])
        replacement = await self.adapter.get(new["ref"])
        request = SetMetadataRequest(ref=old["ref"], expected_revision=original["revision"],
            idempotency_key="legacy-frozen-retire", replacement_ref=new["ref"],
            memory_metadata={**original["memory_metadata"], "stage": "durable", "status": "superseded"},
            evidence=[{"ref": new["ref"], "revision": replacement["revision"]}])
        receipt = await self.service.set_metadata(request)
        self.assertEqual(await self.service.set_metadata(request), receipt)
        self.assertFalse((await self.adapter.get(old["ref"]))["active"])

    async def test_retire_derived_claim_after_support_withdrawal(self):
        from battuta_memory.contracts import SetMetadataRequest, GetRequest
        from test_records import SOURCE, fact
        values = dict(projects=["global"], sources=[SOURCE], memory_metadata=fact()["memory_metadata"])
        support = await self.service.remember(RememberRequest(content="Retirement support", **values))
        source = await self.adapter.get(support["ref"])
        claims = []
        for kind in ("hypothesis", "synthesized-observation"):
            metadata = {**values["memory_metadata"], "knowledge_type": kind, "confidence": "tentative",
                "rationale": "Supported claim", "evidence": [{"ref": source["ref"], "revision": source["revision"],
                "relation": "supports", "requirement": "current"}]}
            claim = await self.service.remember(RememberRequest(content=f"Claim {kind}", **{**values, "memory_metadata": metadata}))
            before = await self.adapter.get(claim["ref"])
            claims.append((kind, claim, before))
        await self.service.forget(ForgetRequest(ref=source["ref"]))
        for kind, claim, before in claims:
            retired = {**before["memory_metadata"], "status": "superseded", "evidence": []}
            request = SetMetadataRequest(ref=claim["ref"], expected_revision=before["revision"],
                idempotency_key=f"retire-{kind}", memory_metadata=retired)
            with self.assertRaises(ValueError):
                await self.service.set_metadata(SetMetadataRequest(ref=claim["ref"], expected_revision=before["revision"],
                    idempotency_key=f"tamper-{kind}", memory_metadata={**retired, "confidence": "disputed"}))
            with self.assertRaises(ValueError):
                await self.service.set_metadata(request.model_copy(update={"expected_revision": "0" * 64, "idempotency_key": f"stale-{kind}"}))
            await self.service.set_metadata(request)
            after = await self.adapter.get(claim["ref"], include_deleted=True)
            self.assertFalse(after["active"])
            self.assertEqual(after["memory_metadata"], retired)
            self.assertEqual(after["sources"], before["sources"])
            self.assertEqual(after["content"], before["content"])
            self.assertIsNone(after["superseded_by"])
            self.assertEqual(self.adapter.storage.conn.execute("SELECT count(*) FROM memories WHERE content_hash=?", (claim["ref"],)).fetchone()[0], 1)
            with self.assertRaises(ValueError):
                await self.service.get(GetRequest(ref=claim["ref"]))
            with self.assertRaises(ValueError):
                SetMetadataRequest(ref=claim["ref"], expected_revision=after["revision"],
                    idempotency_key=f"reactivate-{kind}", memory_metadata={**retired, "status": "active"})

    async def test_opaque_projects_round_trip_and_link_without_registry(self):
        from battuta_memory.contracts import RecallRequest
        names = ["Atlas", "My Project", "one,two", "%2c", "项目", "X" * 65]
        created = await self.service.remember(RememberRequest(content="Opaque memberships", projects=names))
        expected = ["%2c", "atlas", "my project", "one,two", "x" * 65, "项目"]
        record = await self.adapter.get(created["ref"])
        self.assertEqual(record["scope"]["projects"], expected)
        for name in names:
            with self.subTest(name=name):
                result = await self.service.list(ListRequest(selector="projects", projects=[name], include_global=False))
                self.assertEqual([r["ref"] for r in result["records"]], [created["ref"]])
        await self.service.link_projects(LinkRequest(ref=created["ref"], add=["New Project"], remove=["ONE,TWO"]))
        self.assertEqual((await self.adapter.get(created["ref"]))["scope"]["projects"], ["%2c", "atlas", "my project", "new project", "x" * 65, "项目"])

    async def test_withdrawal_preserves_old_evidence_but_cannot_change_claim_or_bypass_guards(self):
        from battuta_memory.contracts import SetMetadataRequest
        from test_records import SOURCE, fact
        for withdrawn in ("forgotten", "corrected"):
            with self.subTest(withdrawn=withdrawn):
                values = dict(projects=["global"], sources=[SOURCE], memory_metadata=fact()["memory_metadata"])
                support = await self.service.remember(RememberRequest(content=f"Support {withdrawn}", **values))
                source = await self.adapter.get(support["ref"])
                metadata = {**values["memory_metadata"], "knowledge_type": "hypothesis", "confidence": "tentative", "rationale": "Possible pattern", "evidence": [{"ref": source["ref"], "revision": source["revision"], "relation": "supports", "requirement": "historical"}]}
                claim = await self.service.remember(RememberRequest(content=f"Claim {withdrawn}", **{**values, "memory_metadata": metadata}))
                before = await self.adapter.get(claim["ref"])
                if withdrawn == "forgotten":
                    await self.service.forget(ForgetRequest(ref=source["ref"]))
                else:
                    await self.service.update(UpdateRequest(ref=source["ref"], content="Corrected supporting fact", reason="Owner correction"))
                request = dict(ref=claim["ref"], expected_revision=before["revision"], idempotency_key=f"reject-{withdrawn}", memory_metadata={**before["memory_metadata"], "status": "rejected"})
                for change in ({"rationale": "New unsupported explanation"}, {"confidence": "disputed"}, {"evidence": [{**metadata["evidence"][0], "revision": "0" * 64}]}):
                    with self.subTest(change=change), self.assertRaises(ValueError):
                        await self.service.set_metadata(SetMetadataRequest(**{**request, "memory_metadata": {**request["memory_metadata"], **change}}))
                with self.assertRaisesRegex(ValueError, "evidence"):
                    await self.service.set_metadata(SetMetadataRequest(**request, evidence=[{"ref": source["ref"], "revision": source["revision"]}]))
                receipt = await self.service.set_metadata(SetMetadataRequest(**request))
                self.assertEqual(await self.service.set_metadata(SetMetadataRequest(**request)), receipt)
                after = await self.adapter.get(claim["ref"])
                self.assertEqual(after["sources"], before["sources"])
                self.assertEqual(after["memory_metadata"], request["memory_metadata"])
                with self.assertRaises(ValueError):
                    await self.service.set_metadata(SetMetadataRequest(**{**request, "expected_revision": after["revision"], "idempotency_key": f"reactivate-{withdrawn}", "memory_metadata": {**after["memory_metadata"], "status": "active"}}))

    async def test_malformed_old_metadata_does_not_block_inventory_or_valid_work(self):
        from battuta_memory.contracts import InventoryRequest
        from test_records import SOURCE, fact
        for index, malformed in enumerate(("{broken", '{"sources":[],"memory_metadata":{"stage":"unknown"}}')):
            old = await self.service.remember(self.note(f"Old record {index}"))
            self.adapter.storage.conn.execute("UPDATE memories SET metadata=? WHERE content_hash=?", (malformed, old["ref"]))
            self.adapter.storage.conn.commit()
            await self.service.remember(RememberRequest(content=f"Valid attributed fact {index}", projects=["global"], sources=[SOURCE], memory_metadata=fact()["memory_metadata"]))
            inventory = await self.service.inventory(InventoryRequest(window_start=0, window_end=9999999999))
            historical = next(r for r in inventory["records"] if r["ref"] == old["ref"])
            self.assertTrue(historical["metadata_error"])
            self.assertEqual(self.adapter.storage.conn.execute("SELECT metadata FROM memories WHERE content_hash=?", (old["ref"],)).fetchone()[0], malformed)

    async def test_lifecycle_supersession_survives_lost_ack_with_sources_and_history(self):
        from battuta_memory.contracts import SetMetadataRequest, GetRequest
        from test_records import SOURCE, fact
        values = dict(projects=["global"], sources=[SOURCE], memory_metadata=fact()["memory_metadata"])
        old = await self.service.remember(RememberRequest(content="Original attributed fact", **values))
        new = await self.service.remember(RememberRequest(content="Consolidated attributed fact", **values))
        original = await self.adapter.get(old["ref"])
        replacement = await self.adapter.get(new["ref"])
        request = SetMetadataRequest(ref=old["ref"], expected_revision=original["revision"], idempotency_key="retire", replacement_ref=new["ref"],
            memory_metadata={**original["memory_metadata"], "status": "superseded"}, evidence=[{"ref": new["ref"], "revision": replacement["revision"]}])
        with patch.object(self.state, "complete_intent", side_effect=RuntimeError("lost acknowledgement")):
            with self.assertRaises(RuntimeError):
                await self.service.set_metadata(request)
        await self.service.recover()
        receipt = await self.service.set_metadata(request)
        self.assertEqual(receipt["ref"], old["ref"])
        historical = await self.service.get(GetRequest(ref=old["ref"], include_history=True))
        self.assertEqual(historical["sources"], [SOURCE])
        self.assertEqual([r["ref"] for r in historical["history"]], [old["ref"], new["ref"]])
        self.assertEqual(self.state.recover_intents(), [])

    async def test_metadata_promotion_preserves_vector_sources_and_unrelated_json_and_replays(self):
        import json
        from battuta_memory.contracts import SetMetadataRequest
        from test_records import fact, SOURCE
        request = RememberRequest(content="Owner reported buying an NS2", projects=["global"], sources=[SOURCE], memory_metadata=fact()["memory_metadata"])
        first = await self.service.remember(request)
        self.adapter.storage.conn.execute("UPDATE memories SET metadata=json_set(metadata, '$.custom', 'preserve') WHERE content_hash=?", (first["ref"],))
        self.adapter.storage.conn.commit()
        before = await self.adapter.get(first["ref"])
        vector = self.adapter.storage.conn.execute("SELECT content_embedding FROM memory_embeddings").fetchone()[0]
        update = SetMetadataRequest(ref=first["ref"], expected_revision=before["revision"], idempotency_key="promote", memory_metadata={**before["memory_metadata"], "stage": "durable"})
        with patch.object(self.adapter, "embed", side_effect=AssertionError("metadata must not embed")):
            receipt = await self.service.set_metadata(update)
            self.assertEqual(await self.service.set_metadata(update), receipt)
        after = await self.adapter.get(first["ref"])
        self.assertEqual(after["sources"], [SOURCE])
        self.assertEqual(after["memory_metadata"]["confidence"], "confirmed")
        self.assertNotEqual(after["revision"], before["revision"])
        self.assertEqual(after["ref"], before["ref"])
        self.assertEqual(self.adapter.storage.conn.execute("SELECT content_embedding FROM memory_embeddings").fetchone()[0], vector)
        self.assertEqual(json.loads(self.adapter.storage.conn.execute("SELECT metadata FROM memories WHERE content_hash=?", (first["ref"],)).fetchone()[0])["custom"], "preserve")

    async def test_metadata_rejects_self_support_and_incompatible_duplicates(self):
        from battuta_memory.contracts import SetMetadataRequest
        from test_records import fact, SOURCE
        base = dict(content="Attributed claim", projects=["global"], sources=[SOURCE], memory_metadata=fact()["memory_metadata"])
        first = await self.service.remember(RememberRequest(**base))
        record = await self.adapter.get(first["ref"])
        for change in ({"memory_metadata": {**base["memory_metadata"], "expires_at": "2027-01-01T00:00:00Z"}}, {"sources": [{**SOURCE, "entry_id": "different"}]}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "conflict"):
                await self.service.remember(RememberRequest(**{**base, **change}))
        with self.assertRaisesRegex(ValueError, "[Cc]ycl"):
            await self.service.set_metadata(SetMetadataRequest(ref=first["ref"], expected_revision=record["revision"], idempotency_key="cycle", memory_metadata={**base["memory_metadata"], "evidence": [{"ref": first["ref"], "revision": record["revision"], "relation": "supports", "requirement": "current"}]}))

    async def test_optional_guards_preserve_legacy_receipt_identities(self):
        request = self.note(key="legacy")
        legacy = request.model_dump(mode="json", by_alias=True)
        legacy.pop("evidence", None)
        legacy.pop("memory_metadata", None)
        legacy.pop("projects")
        legacy["scope"] = {"global": False, "projects": ["atlas"]}
        receipt = {"ref": "a" * 64, "outcome": "created"}
        self.state.prepare_intent("remember:legacy", self.service.digest(legacy), {"unused": True})
        self.state.complete_intent("remember:legacy", receipt)
        self.assertEqual(await self.service.remember(request), receipt)
        update = UpdateRequest(ref="a" * 64, content="New", reason="legacy")
        public = update.model_dump(mode="json", by_alias=True)
        public.pop("evidence", None)
        public.pop("sources", None)
        public.pop("expected_revision", None)
        public.pop("memory_metadata", None)
        keyed = update.model_dump()
        keyed.pop("evidence", None)
        keyed.pop("sources", None)
        keyed.pop("expected_revision", None)
        keyed.pop("memory_metadata", None)
        key = "update:" + self.service.digest(keyed)
        self.state.prepare_intent(key, self.service.digest(public), {"unused": True})
        self.state.complete_intent(key, receipt)
        self.assertEqual(await self.service.update(update), receipt)
        forget = ForgetRequest(ref="a" * 64)
        legacy_forget = forget.model_dump(mode="json", by_alias=True)
        for field in ("evidence", "expected_revision", "replacement_ref"):
            legacy_forget.pop(field, None)
        key = "forget:" + forget.ref
        forgotten = {"ref": forget.ref, "forgotten": True}
        self.state.prepare_intent(key, self.service.digest(legacy_forget), {"unused": True})
        self.state.complete_intent(key, forgotten)
        self.assertEqual(await self.service.forget(forget), forgotten)

    async def test_frozen_evidence_rejects_membership_change_and_earlier_plan_update(self):
        source = await self.service.remember(self.note("Evidence"))
        record = await self.adapter.get(source["ref"])
        guard = [{"ref": record["ref"], "revision": record["revision"]}]
        await self.service.link_projects(LinkRequest(ref=source["ref"], add=["beacon"]))
        request = {**self.note("Derived").model_dump(by_alias=True), "evidence": guard}
        with self.assertRaisesRegex(ValueError, "evidence"):
            await self.service.remember(RememberRequest(**request))
        current = await self.adapter.get(source["ref"])
        guard[0]["revision"] = current["revision"]
        await self.service.update(UpdateRequest(ref=source["ref"], content="Corrected evidence", reason="earlier operation", evidence=guard))
        with self.assertRaisesRegex(ValueError, "evidence"):
            await self.service.remember(RememberRequest(**request))

    async def test_evidence_guards_reject_forgotten_and_changed_sources_but_receipts_win(self):
        source = await self.service.remember(self.note("Evidence"))
        record = await self.adapter.get(source["ref"])
        guard = [{"ref": record["ref"], "revision": record["revision"]}]
        request = self.note("Derived", key="derived").model_dump(by_alias=True)
        request["evidence"] = guard
        derived = RememberRequest(**request)
        receipt = await self.service.remember(derived)
        await self.service.forget(ForgetRequest(ref=source["ref"]))
        self.assertEqual(await self.service.remember(derived), receipt)
        target = await self.service.remember(self.note("Target"))
        for operation, request in [
            (self.service.remember, RememberRequest(**{**request, "content": "Other derived", "idempotency_key": "other"})),
            (self.service.update, UpdateRequest(ref=target["ref"], content="Revised", reason="dream", evidence=guard)),
            (self.service.forget, ForgetRequest(ref=target["ref"], evidence=guard)),
        ]:
            with self.subTest(operation=operation.__name__), self.assertRaisesRegex(ValueError, "evidence"):
                await operation(request)
        self.assertTrue((await self.adapter.get(target["ref"]))["active"])

    async def test_update_unions_sources_and_forget_lineage_survives_restart(self):
        from battuta_memory.contracts import InventoryRequest
        a = {"agent_id": "cos", "session_id": "a", "entry_id": "1"}
        b = {"agent_id": "cos", "session_id": "b", "entry_id": "2"}
        first = await self.service.remember(RememberRequest(**{**self.note().model_dump(by_alias=True), "sources": [a]}))
        second = await self.service.remember(RememberRequest(**{**self.note("Second").model_dump(by_alias=True), "sources": [b]}))
        updated = await self.service.update(UpdateRequest(ref=first["ref"], content="Combined", reason="merge", sources=[b]))
        self.assertEqual((await self.adapter.get(updated["ref"]))["sources"], [a, b])
        await self.service.forget(ForgetRequest(ref=second["ref"], replacement_ref=updated["ref"]))
        storage = type(self.adapter.storage)(str(self.root / "memory.db"))
        await storage.initialize()
        self.addAsyncCleanup(storage.close)
        state = StateStore.open(self.root / "state.db")
        self.addCleanup(state.close)
        restarted = MemoryService(UpstreamAdapter(storage), self.service.config, state)
        await restarted.recover()
        inventory = await restarted.inventory(InventoryRequest(window_start=0, window_end=9999999999))
        self.assertIn({"ref": second["ref"], "superseded_by": updated["ref"]}, inventory["inactive"])
        self.assertIsNone(await restarted.adapter.get(second["ref"]))

    async def test_remember_receipt_reports_actual_reused_content_and_historical_state(self):
        first = await self.service.remember(self.note("Original CASE"))
        request = self.note("original case", key="reuse")
        receipt = await self.service.remember(request)
        self.assertEqual(receipt["outcome"], "reused")
        self.assertEqual(receipt["before"], "Original CASE")
        self.assertEqual(receipt["after"], "Original CASE")
        self.assertEqual(receipt["revision"], (await self.adapter.get(first["ref"]))["revision"])
        await self.service.forget(ForgetRequest(ref=first["ref"]))
        self.assertEqual(await self.service.remember(request), receipt)

    async def test_merge_forget_requires_an_active_distinct_same_scope_replacement(self):
        first = await self.service.remember(self.note())
        replacement = await self.service.remember(self.note("Merged fact"))
        other_scope = await self.service.remember(self.note("Other scope", project=None))
        for ref in (first["ref"], other_scope["ref"]):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                await self.service.forget(ForgetRequest(ref=first["ref"], replacement_ref=ref))
        source = await self.service.remember(self.note("Redundant fact"))
        result = await self.service.forget(ForgetRequest(ref=source["ref"], replacement_ref=replacement["ref"]))
        self.assertTrue(result["forgotten"])
        await self.service.forget(ForgetRequest(ref=replacement["ref"]))
        with self.assertRaises(ValueError):
            await self.service.forget(ForgetRequest(ref=first["ref"], replacement_ref=replacement["ref"]))
        self.assertTrue((await self.adapter.get(first["ref"]))["active"])

    async def test_dream_preconditions_reject_changed_membership_without_mutation(self):
        first = await self.service.remember(self.note())
        revision = (await self.adapter.get(first["ref"]))["revision"]
        await self.service.link_projects(LinkRequest(ref=first["ref"], add=["beacon"]))
        for request, operation in [
            (UpdateRequest(ref=first["ref"], content="Rewritten", reason="dream", expected_revision=revision), self.service.update),
            (ForgetRequest(ref=first["ref"], expected_revision=revision), self.service.forget),
        ]:
            with self.subTest(operation=operation.__name__), self.assertRaisesRegex(ValueError, "changed"):
                await operation(request)
        self.assertTrue((await self.adapter.get(first["ref"]))["active"])

    async def test_compensated_version_failure_does_not_poison_recovery(self):
        import sqlite3
        first = await self.service.remember(self.note())
        request = UpdateRequest(ref=first["ref"], content="Corrected fact", reason="owner")
        execute = self.adapter.storage._execute_with_retry
        async def fail_lineage_once(operation, *args, **kwargs):
            if operation.__name__ == "_link_and_supersede":
                raise sqlite3.OperationalError("injected transient lineage error")
            return await execute(operation, *args, **kwargs)
        with patch.object(self.adapter.storage, "_execute_with_retry", side_effect=fail_lineage_once):
            with self.assertRaises(RuntimeError):
                await self.service.update(request)
        target = self.adapter.content_ref(request.content)
        self.assertIsNone(await self.adapter.get(target))
        # Recovery must terminally receipt the failed correction, not revive its tombstone.
        await self.service.recover()
        self.assertEqual(self.state.recover_intents(), [])
        unrelated = await self.service.remember(self.note("Unrelated fact"))
        self.assertIsNotNone(await self.adapter.get(unrelated["ref"]))
        with self.assertRaisesRegex(ValueError, "correction failed"):
            await self.service.update(request)
        self.assertTrue((await self.adapter.get(first["ref"]))["active"])
        self.assertIsNone(await self.adapter.get(target))

    async def test_wrapper_kinds_survive_upstream_normalization_and_corrections(self):
        for kind in ("preference", "constraint"):
            with self.subTest(kind=kind):
                note = RememberRequest(content=f"An explicit {kind}", projects=["global"], kind=kind)
                first = await self.service.remember(note)
                self.assertEqual((await self.adapter.get(first["ref"]))["kind"], kind)
                inventory = await self.service.list(ListRequest(selector="all", kind=kind))
                self.assertEqual([r["ref"] for r in inventory["records"]], [first["ref"]])
                changed = await self.service.update(UpdateRequest(ref=first["ref"], content=f"Corrected {kind}", reason="owner"))
                self.assertEqual((await self.adapter.get(changed["ref"]))["kind"], kind)
                inventory = await self.service.list(ListRequest(selector="all", kind=kind))
                self.assertEqual([r["ref"] for r in inventory["records"]], [changed["ref"]])

    async def test_exact_duplicates_reject_conflicting_scope(self):
        first = await self.service.remember(self.note())
        with self.assertRaisesRegex(ValueError, "scope"):
            await self.service.remember(self.note(project="beacon"))
        record = await self.adapter.get(first["ref"])
        self.assertEqual(record["scope"]["projects"], ["atlas"])
        with self.assertRaisesRegex(ValueError, "scope"):
            await self.service.remember(self.note(project=None))
        other = await self.service.remember(self.note(content="Original fact, with a detail"))
        self.assertNotEqual(first["ref"], other["ref"])

    async def test_versioned_edit_and_membership_preserve_vectors(self):
        first = await self.service.remember(self.note())
        before = self.adapter.storage.conn.execute("SELECT content_embedding FROM memory_embeddings").fetchone()[0]
        await self.service.link_projects(LinkRequest(ref=first["ref"], add=["beacon"]))
        after = self.adapter.storage.conn.execute("SELECT content_embedding FROM memory_embeddings").fetchone()[0]
        self.assertEqual(before, after)
        changed = await self.service.update(UpdateRequest(ref=first["ref"], content="Corrected fact", reason="owner correction"))
        self.assertNotEqual(changed["ref"], first["ref"])
        self.assertEqual((await self.adapter.get(changed["ref"]))["scope"]["projects"], ["atlas", "beacon"])
        with self.assertRaisesRegex(ValueError, "inactive"):
            await self.service.update(UpdateRequest(ref=first["ref"], content="Stale correction", reason="late"))

    async def test_final_membership_and_global_link_rejected(self):
        first = await self.service.remember(self.note())
        with self.assertRaises(ValueError):
            await self.service.link_projects(LinkRequest(ref=first["ref"], remove=["atlas"]))
        global_ = await self.service.remember(self.note("Global", None))
        with self.assertRaises(ValueError):
            await self.service.link_projects(LinkRequest(ref=global_["ref"], add=["atlas"]))

    async def test_forget_preview_and_completed_retry_do_not_resurrect(self):
        first = await self.service.remember(self.note(key="stable"))
        await self.service.forget(ForgetRequest(ref=first["ref"], dry_run=True))
        self.assertIsNotNone(await self.adapter.get(first["ref"]))
        await self.service.forget(ForgetRequest(ref=first["ref"]))
        self.assertEqual(await self.service.remember(self.note(key="stable")), first)
        self.assertIsNone(await self.adapter.get(first["ref"]))
        with self.assertRaises(ValueError):
            await self.service.remember(self.note())
        with self.assertRaisesRegex(ValueError, "conflict"):
            await self.service.remember(self.note("different", key="stable"))
        row = self.adapter.storage.conn.execute("SELECT content,deleted_at FROM memories").fetchone()
        self.assertEqual(row[0], "Original fact")
        self.assertIsNotNone(row[1])

    async def test_crash_after_store_before_receipt_recovers(self):
        original = self.state.complete_intent
        with patch.object(self.state, "complete_intent", side_effect=RuntimeError("simulated crash")):
            with self.assertRaisesRegex(RuntimeError, "simulated crash"):
                await self.service.remember(self.note(key="retry"))
        await self.service.recover()
        result = await self.service.remember(self.note(key="retry"))
        self.assertEqual(self.adapter.storage.conn.execute("SELECT count(*) FROM memories").fetchone()[0], 1)
        self.assertEqual(result["ref"], hashlib.sha256(b"original fact").hexdigest())

    async def test_crash_after_version_commit_recovers(self):
        first = await self.service.remember(self.note())
        request = UpdateRequest(ref=first["ref"], content="Corrected fact", reason="owner")
        with patch.object(self.state, "complete_intent", side_effect=RuntimeError("simulated crash")):
            with self.assertRaises(RuntimeError):
                await self.service.update(request)
        await self.service.recover()
        result = await self.service.update(request)
        history = await self.adapter.history(result["ref"])
        self.assertEqual(len(history), 2)

    async def test_crash_inside_upstream_version_store_repairs_orphan(self):
        from mcp_memory_service.models.memory import Memory
        first = await self.service.remember(self.note())
        async def crash_after_store(old_ref, content, **kwargs):
            ref = self.adapter.content_ref(content)
            ok, _ = await self.adapter.storage.store(Memory(content, ref, tags=kwargs["new_tags"], memory_type=kwargs["new_memory_type"]), skip_semantic_dedup=True)
            self.assertTrue(ok)
            raise RuntimeError("crash before lineage")
        with patch.object(self.adapter.storage, "update_memory_versioned", side_effect=crash_after_store):
            with self.assertRaisesRegex(RuntimeError, "crash before lineage"):
                await self.service.update(UpdateRequest(ref=first["ref"], content="Corrected fact", reason="owner"))
        await self.service.recover()
        ref = self.adapter.content_ref("Corrected fact")
        self.assertEqual([r["ref"] for r in await self.adapter.history(ref)], [first["ref"], ref])

    async def test_crash_before_journal_commit_has_no_upstream_write(self):
        with patch.object(self.state, "prepare_intent", side_effect=RuntimeError("disk full")):
            with self.assertRaisesRegex(RuntimeError, "disk full"):
                await self.service.remember(self.note())
        self.assertEqual(self.adapter.storage.conn.execute("SELECT count(*) FROM memories").fetchone()[0], 0)

    async def test_membership_mutations_are_serialized(self):
        import asyncio
        first = await self.service.remember(self.note())
        await asyncio.gather(self.service.link_projects(LinkRequest(ref=first["ref"], add=["beacon"])),
            self.service.link_projects(LinkRequest(ref=first["ref"], remove=["atlas"], add=["beacon"])))
        self.assertEqual((await self.adapter.get(first["ref"]))["scope"]["projects"], ["beacon"])
