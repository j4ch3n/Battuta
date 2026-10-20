"""The only storage/embedding dependency boundary; no upstream schema changes."""

import asyncio
import fcntl
import hashlib
import json
import math
from importlib.metadata import version
from pathlib import Path

from .config import DIMENSION, MODEL, MemoryConfig


class TerminalMutationError(ValueError):
    """A journaled mutation cannot safely be retried; never resurrect its target."""


class UpstreamAdapter:
    def __init__(self, storage, lock=None, manifest=None):
        self.storage = storage
        self._lock = lock
        self.manifest = manifest

    @staticmethod
    def verify_cache(home: Path):
        from .model_setup import verify_model
        return verify_model(home)

    @staticmethod
    def create_storage(config):
        from mcp_memory_service.storage.sqlite_vec import SqliteVecMemoryStorage
        return SqliteVecMemoryStorage(str(config.database), embedding_model=MODEL)

    @classmethod
    async def open(cls, config: MemoryConfig):
        config.configure_upstream()
        manifest = cls.verify_cache(Path.home())
        config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock = (config.data_dir / "service.lock").open("a+")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            lock.close()
            raise RuntimeError("Another memory server owns this data directory") from error
        adapter = None
        try:
            from .state import StateStore
            state = StateStore.open(config.data_dir / "state.db")
            try:
                state.bind_model(manifest)
            finally:
                state.close()
            storage = cls.create_storage(config)
            adapter = cls(storage, lock, manifest)
            await storage.initialize()
            await adapter.assert_real_embeddings()
            return adapter
        except BaseException:
            if adapter:
                await adapter.close()
            else:
                lock.close()
            raise

    async def assert_real_embeddings(self):
        storage = self.storage
        if storage.embedding_model_name != MODEL or storage.embedding_dimension != DIMENSION:
            raise RuntimeError("Embedding model identity mismatch; explicit migration required")
        from mcp_memory_service.embeddings.onnx_embeddings import ONNXEmbeddingModel
        model = storage.embedding_model
        if not isinstance(model, ONNXEmbeddingModel) or model._tokenizer is None or model._model is None:
            raise RuntimeError("Actual ONNX model and tokenizer required; hash fallback refused")
        if model.model_name != MODEL or model._model.get_providers() != ["CPUExecutionProvider"]:
            raise RuntimeError("Unexpected ONNX model/provider")
        vector = await asyncio.to_thread(model.encode, ["Embedding readiness check"])
        values = list(vector[0])
        if len(values) != DIMENSION or not all(math.isfinite(float(x)) for x in values) or not any(values):
            raise RuntimeError("Invalid ONNX probe vector")
        return self.manifest

    async def health(self):
        await self.assert_real_embeddings()
        return {"ready": True, "model": self.manifest, "upstream_version": version("mcp-memory-service")}

    def embed(self, text):
        from sqlite_vec import serialize_float32
        tokenizer = self.storage.embedding_model._tokenizer
        # Inspect untruncated token count, not the model's truncated encode result.
        from tokenizers import Tokenizer
        counter = Tokenizer.from_str(tokenizer.to_str())
        counter.no_truncation()
        if len(counter.encode(text).ids) > 256:
            raise ValueError("Memory exceeds embedding token limit; split or rephrase")
        return serialize_float32(self.storage._generate_embedding(text))

    async def _rows(self, sql, params=()):
        # Read-only SQL avoids upstream helpers that swallow database exceptions.
        # All access stays inside its serialized connection boundary.
        def read():
            cursor = self.storage.conn.execute(sql, params)
            names = [d[0] for d in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]
        return await self.storage._execute_with_retry(read)

    @staticmethod
    def record(row):
        tags = row["tags"].split(",") if row["tags"] else []
        metadata = json.loads(row["metadata"] or "{}")
        record = {
            "ref": row["content_hash"], "content": row["content"],
            "scope": {"global": "scope:global" in tags, "projects": sorted(t[5:] for t in tags if t.startswith("proj:"))},
            "tags": sorted(t for t in tags if not t.startswith(("scope:", "proj:", "kind:"))),
            "kind": next((t[5:] for t in tags if t.startswith("kind:")), row["memory_type"] or "observation"), "sources": metadata.get("sources", []),
            "created_at": row["created_at"], "updated_at": row["updated_at"],
            "parent_ref": row.get("parent_id"), "superseded_by": row.get("superseded_by"),
            "active": not row.get("superseded_by") and row.get("deleted_at") is None,
            **({"distance": row["distance"]} if "distance" in row else {}),
        }
        record["revision"] = hashlib.sha256(json.dumps({k: v for k, v in record.items() if k != "distance"}, sort_keys=True).encode()).hexdigest()
        return record

    @staticmethod
    def _filters(request, resolved):
        clauses = ["m.deleted_at IS NULL", "COALESCE(m.embedding_pending,0)=0"]
        params = []
        if not request.include_history:
            clauses.append("COALESCE(m.superseded_by,'')=''")
        if resolved.tags is not None:
            clauses.append("(" + " OR ".join("instr(',' || m.tags || ',', ',' || ? || ',') > 0" for _ in resolved.tags) + ")")
            params.extend(resolved.tags)
        if request.kind:
            # Wrapper kinds are owned reserved tags; upstream has a narrower ontology.
            clauses.append("(instr(',' || m.tags || ',', ',' || ? || ',') > 0 OR (instr(',' || m.tags || ',', ',kind:') = 0 AND m.memory_type=?))")
            params.extend(["kind:" + request.kind, request.kind])
        if request.tags:
            conditions = []
            for tag in request.tags:
                conditions.append("instr(',' || m.tags || ',', ',' || ? || ',') > 0")
                params.append(tag)
            clauses.append("(" + (" AND " if request.tag_match == "all" else " OR ").join(conditions) + ")")
        return " AND ".join(clauses), params

    async def list(self, request, resolved):
        where, params = self._filters(request, resolved)
        rows = await self._rows(f"SELECT m.* FROM memories m WHERE {where} ORDER BY m.updated_at DESC, m.content_hash ASC", params)
        return [self.record(row) for row in rows]

    async def search(self, request, resolved):
        vector = await asyncio.to_thread(self.embed, request.query)
        where, params = self._filters(request, resolved)
        # Exact filtered distance search has no global-neighbour candidate cap.
        # sqlite-vec still computes distance; upstream owns all stored embeddings.
        rows = await self._rows(f"""SELECT m.*, vec_distance_l2(e.content_embedding, ?) AS distance
            FROM memories m JOIN memory_embeddings e ON m.id=e.rowid
            WHERE {where} ORDER BY distance, m.content_hash LIMIT ?""", [vector, *params, request.limit])
        return [self.record(row) for row in rows]

    async def get(self, ref, include_deleted=False):
        rows = await self._rows("SELECT * FROM memories WHERE content_hash=?" + ("" if include_deleted else " AND deleted_at IS NULL"), (ref,))
        return self.record(rows[0]) if rows else None

    async def inventory(self, request):
        # One statement supplies a consistent read snapshot. Fail closed rather
        # than paginate a moving corpus or silently drop old correction targets.
        rows = await self._rows("SELECT * FROM memories ORDER BY content_hash LIMIT ?", (request.max_records + 1,))
        if len(rows) > request.max_records:
            raise ValueError("Dream inventory exceeds record limit")
        if any(row.get("embedding_pending") for row in rows):
            raise ValueError("Dream inventory has pending embeddings")
        records, inactive, recent = [], [], []
        for row in rows:
            record = self.record(row)
            changed = max(row.get("created_at") or 0, row.get("updated_at") or 0, row.get("deleted_at") or 0)
            if request.window_start <= changed < request.window_end:
                recent.append(record["ref"])
            if record["active"]:
                records.append(record)
            else:
                inactive.append({"ref": record["ref"], "superseded_by": record["superseded_by"]})
        return {"records": records, "inactive": inactive, "recent_refs": recent,
            "window_start": request.window_start, "window_end": request.window_end}

    async def history(self, ref):
        # Parent links are hashes; walk both directions without recursive cycles.
        record = await self.get(ref)
        if not record:
            return []
        seen = {ref}
        while record["parent_ref"] and record["parent_ref"] not in seen:
            parent = await self.get(record["parent_ref"])
            if not parent:
                break
            record = parent
            seen.add(record["ref"])
        history = [record]
        seen = {record["ref"]}
        while record["superseded_by"] and record["superseded_by"] not in seen:
            record = await self.get(record["superseded_by"])
            if not record:
                break
            history.append(record)
            seen.add(record["ref"])
        return history

    @staticmethod
    def content_ref(content):
        from mcp_memory_service.utils.hashing import generate_content_hash
        return generate_content_hash(content)

    @staticmethod
    def storage_kind(kind):
        from mcp_memory_service.models.ontology import MemoryTypeOntology
        return kind if MemoryTypeOntology.validate_memory_type(kind) else "observation"

    async def store(self, payload):
        from mcp_memory_service.models.memory import Memory
        current = await self.get(payload["ref"], include_deleted=True)
        if current:
            if not current["active"]:
                raise ValueError("Cannot resurrect inactive memory")
            # Only recovery of our journaled write may reach this branch.
            return
        ok, message = await self.storage.store(Memory(content=payload["content"], content_hash=payload["ref"],
            tags=payload["tags"], memory_type=self.storage_kind(payload["kind"]), metadata={"sources": payload["sources"]}), skip_semantic_dedup=True)
        if not ok:
            raise RuntimeError("Upstream memory store failed")

    async def metadata(self, payload):
        current = await self.get(payload["ref"], include_deleted=True)
        if not current or not current["active"]:
            raise ValueError("Memory is inactive")
        ok, _ = await self.storage.update_memory_metadata(payload["ref"], {"tags": payload["tags"], "metadata": {"sources": payload["sources"]}})
        if not ok:
            raise RuntimeError("Upstream metadata update failed")

    async def evolve(self, payload):
        current = await self.get(payload["old_ref"], include_deleted=True)
        target = await self.get(payload["ref"], include_deleted=True)
        if current and current["superseded_by"] == payload["ref"] and target and target["parent_ref"] == payload["old_ref"]:
            return
        if not current or not current["active"]:
            raise TerminalMutationError("Memory correction failed: version state conflicts; use the current ref and revised content")
        if target:
            # A process can die inside upstream update_memory_versioned after store()
            # commits but before lineage linking. Repair only this exact journal target.
            if not target["active"] or target["parent_ref"]:
                # Upstream may compensate a failed lineage transaction by tombstoning
                # the newly committed row. Receipt this failure instead of reviving it
                # or letting the pending intent block every subsequent write/startup.
                raise TerminalMutationError("Memory correction failed: replacement is inactive or conflicting; use revised content")
            def link():
                conn = self.storage.conn
                with conn:
                    version = conn.execute("SELECT COALESCE(version,1)+1 FROM memories WHERE content_hash=?", (payload["old_ref"],)).fetchone()[0]
                    conn.execute("UPDATE memories SET parent_id=?,version=? WHERE content_hash=?", (payload["old_ref"], version, payload["ref"]))
                    cursor = conn.execute("UPDATE memories SET superseded_by=? WHERE content_hash=? AND superseded_by IS NULL AND deleted_at IS NULL", (payload["ref"], payload["old_ref"]))
                    if cursor.rowcount != 1:
                        raise RuntimeError("Version recovery conflict")
            await self.storage._execute_with_retry(link)
        else:
            ok, _, ref = await self.storage.update_memory_versioned(payload["old_ref"], payload["content"],
                new_tags=payload["tags"], new_memory_type=self.storage_kind(payload["kind"]), reason=payload["reason"])
            if not ok or ref != payload["ref"]:
                raise RuntimeError("Upstream version update failed")

    async def delete(self, payload):
        if await self.get(payload["ref"]) is None:
            return
        ok, _ = await self.storage.delete(payload["ref"])
        if not ok:
            raise RuntimeError("Upstream deletion failed")

    async def close(self):
        try:
            await self.storage.close()
        finally:
            if self._lock:
                self._lock.close()
                self._lock = None
