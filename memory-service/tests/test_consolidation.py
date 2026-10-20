"""Derived graph lifecycle with real persistence and controlled analysis races."""
import asyncio
import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from battuta_memory.service import MemoryService
from battuta_memory.state import StateStore


RUN = "2026-10-21T03:00:00Z"


class ConsolidationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.state = StateStore.open(Path(folder.name) / "state.db")
        self.addCleanup(self.state.close)
        self.snapshot = {"input_fingerprint": "a" * 64, "algorithm_fingerprint": "b" * 64,
            "records": [{"ref": f"{i:064x}", "revision": "c" * 64} for i in range(16)]}
        self.derived = {"clusters": [], "edges": [self.edge(0, 1)]}
        self.adapter = SimpleNamespace(global_snapshot=AsyncMock(side_effect=lambda: copy.deepcopy(self.snapshot)),
            analyze_global=AsyncMock(side_effect=lambda _: copy.deepcopy(self.derived)))
        self.service = MemoryService(self.adapter, None, self.state)

    @staticmethod
    def edge(source, target):
        return {"source_ref": f"{source:064x}", "target_ref": f"{target:064x}",
            "source_revision": "c" * 64, "target_revision": "c" * 64,
            "relationship_type": "related", "similarity": 0.6, "confidence": 0.0, "needs_review": False}

    async def consolidate(self):
        return await self.service.consolidate_global(SimpleNamespace(run_id=RUN))

    async def test_restart_reuses_draft_or_published_generation_without_reanalysis(self):
        self.assertEqual((await self.service.global_relationships(None))["status"], "unavailable")
        with patch.object(self.state, "activate_graph", side_effect=RuntimeError("interrupted")):
            with self.assertRaises(RuntimeError):
                await self.consolidate()
        self.assertIsNone(self.state.graph_active())
        self.service = MemoryService(self.adapter, None, self.state)
        published = await self.consolidate()
        self.assertEqual((await self.service.global_relationships(None))["edges"], [self.edge(0, 1)])
        self.assertEqual(await self.consolidate(), published)
        self.assertEqual(self.adapter.analyze_global.await_count, 1)
        for changed in ("input_fingerprint", "algorithm_fingerprint"):
            with self.subTest(changed=changed):
                self.snapshot[changed] = "d" * 64
                hints = await self.service.global_relationships(None)
                self.assertEqual((hints["status"], hints["edges"]), ("stale", []))
                await self.consolidate()
                self.assertEqual((await self.service.global_relationships(None))["status"], "current")

    async def test_analysis_does_not_hold_canonical_lock_and_stale_results_are_bounded(self):
        for changes in (1, 2):
            with self.subTest(changes=changes):
                self.state.discard_graph_draft()
                # Ensure neither the previous active generation nor draft matches.
                self.snapshot["input_fingerprint"] = f"{changes + 100:064x}"
                calls = 0
                async def analyze(_):
                    nonlocal calls
                    calls += 1
                    # A concurrent canonical writer can acquire its normal lock.
                    async with asyncio.timeout(1):
                        async with self.service.mutations:
                            if calls <= changes:
                                self.snapshot["input_fingerprint"] = f"{changes * 10 + calls:064x}"
                    return copy.deepcopy(self.derived)
                self.adapter.analyze_global.side_effect = analyze
                if changes == 2:
                    with self.assertRaises(RuntimeError):
                        await self.consolidate()
                    self.assertEqual((await self.service.global_relationships(None))["status"], "stale")
                else:
                    await self.consolidate()
                    self.assertEqual(self.state.graph_active()["input_fingerprint"], self.snapshot["input_fingerprint"])
                self.assertEqual(calls, 2)

    async def test_invalid_analysis_never_activates_and_failures_release_builder(self):
        for change in ({"target_ref": "f" * 64}, {"target_revision": "e" * 64},
                       {"similarity": float("nan")}, {"confidence": 2}, {"needs_review": "false"}):
            with self.subTest(change=change):
                self.derived["edges"] = [{**self.edge(0, 1), **change}]
                with self.assertRaises(ValueError):
                    await self.consolidate()
                self.assertIsNone(self.state.graph_active())
        self.adapter.analyze_global.side_effect = RuntimeError("analysis unavailable")
        with self.assertRaises(RuntimeError):
            await self.consolidate()
        entered = asyncio.Event()
        async def wait(_):
            entered.set()
            await asyncio.Event().wait()
        self.adapter.analyze_global.side_effect = wait
        task = asyncio.create_task(self.consolidate())
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.derived = {"clusters": [], "edges": []}
        self.adapter.analyze_global.side_effect = lambda _: copy.deepcopy(self.derived)
        published = await asyncio.wait_for(self.consolidate(), 1)
        self.assertEqual((published["cluster_count"], published["edge_count"]), (0, 0))
        hints = await self.service.global_relationships(None)
        self.assertEqual((hints["status"], hints["edges"]), ("current", []))

    async def test_hints_are_deduplicated_stably_bounded_and_contain_no_fact_text(self):
        edges = [self.edge(i, j) for i in range(16) for j in range(i + 1, 16)]
        self.derived["edges"] = [*reversed(edges), edges[0]]
        self.derived["clusters"] = [{"member_refs": [f"{i:064x}" for i in range(5)]}]
        published = await self.consolidate()
        self.assertEqual(published["edge_count"], 120)
        hints = await self.service.global_relationships(None)
        self.assertEqual(hints["edges"], edges[:100])
        self.assertTrue(hints["truncated"])
        self.assertNotIn("content", str(self.state.graph_active()))
