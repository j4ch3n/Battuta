import json
import os
import sqlite3


class StateStore:
    def __init__(self, conn):
        self.conn = conn

    @classmethod
    def open(cls, path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS intents(key TEXT PRIMARY KEY, digest TEXT NOT NULL, payload TEXT, result TEXT);
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS captures(key TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT);
            CREATE TABLE IF NOT EXISTS global_graph(slot TEXT PRIMARY KEY CHECK(slot IN ('active','draft')), payload TEXT NOT NULL);
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(ref UNINDEXED, content, keywords);
            CREATE TABLE IF NOT EXISTS memory_fts_revisions(ref TEXT PRIMARY KEY, revision TEXT NOT NULL);
            PRAGMA user_version=1;
        """)
        return cls(conn)

    def receipt(self, key, digest):
        row = self.conn.execute("SELECT digest,result FROM intents WHERE key=?", (key,)).fetchone()
        if row and row[0] != digest:
            raise ValueError("Idempotency key conflict")
        return json.loads(row[1]) if row and row[1] is not None else None

    def bind_model(self, manifest):
        value = json.dumps(manifest, sort_keys=True)
        current = self.conn.execute("SELECT value FROM settings WHERE key='model'").fetchone()
        if current and current[0] != value:
            raise RuntimeError("Embedding model changed; explicit re-embedding migration required")
        with self.conn:
            self.conn.execute("INSERT OR IGNORE INTO settings VALUES('model',?)", (value,))

    def prepare_intent(self, key, digest, payload):
        result = self.receipt(key, digest)
        with self.conn:
            self.conn.execute("INSERT OR IGNORE INTO intents VALUES(?,?,?,NULL)", (key, digest, json.dumps(payload)))
        return {"result": result}

    def complete_intent(self, key, result):
        with self.conn:
            self.conn.execute("UPDATE intents SET payload=NULL,result=? WHERE key=?", (json.dumps(result), key))

    def recover_intents(self):
        return [{"key": key, "payload": json.loads(payload)} for key, payload in self.conn.execute("SELECT key,payload FROM intents WHERE result IS NULL ORDER BY rowid")]

    def capture_receipt(self, key, digest):
        row = self.conn.execute("SELECT digest,result FROM captures WHERE key=?", (key,)).fetchone()
        if row and row[0] != digest:
            raise ValueError("Capture batch conflict")
        if row:
            return json.loads(row[1]) if row[1] else None
        with self.conn:
            self.conn.execute("INSERT INTO captures VALUES(?,?,NULL)", (key, digest))
        return None

    def complete_capture(self, key, result):
        with self.conn:
            self.conn.execute("UPDATE captures SET result=? WHERE key=?", (json.dumps(result), key))

    def close(self):
        self.conn.close()

    def reconcile_index(self, records):
        import unicodedata
        current = dict(self.conn.execute("SELECT ref,revision FROM memory_fts_revisions"))
        canonical = {record["ref"]: record for record in records}
        with self.conn:
            for ref in current.keys() - canonical.keys():
                self.conn.execute("DELETE FROM memory_fts WHERE ref=?", (ref,))
                self.conn.execute("DELETE FROM memory_fts_revisions WHERE ref=?", (ref,))
            for ref, record in canonical.items():
                if current.get(ref) == record["revision"]:
                    continue
                keywords = " ".join((record.get("memory_metadata") or {}).get("keywords", []))
                self.conn.execute("DELETE FROM memory_fts WHERE ref=?", (ref,))
                self.conn.execute("INSERT INTO memory_fts VALUES(?,?,?)", (ref, unicodedata.normalize("NFKC", record["content"]).casefold(), unicodedata.normalize("NFKC", keywords).casefold()))
                self.conn.execute("INSERT OR REPLACE INTO memory_fts_revisions VALUES(?,?)", (ref, record["revision"]))

    def lexical_search(self, query, records, limit):
        from .retrieval import lexical_query
        match = lexical_query(query)
        if not match or not records:
            return []
        eligible = json.dumps({r["ref"]: r["revision"] for r in records})
        return [row[0] for row in self.conn.execute("""SELECT memory_fts.ref FROM memory_fts
            JOIN memory_fts_revisions r ON r.ref=memory_fts.ref
            JOIN json_each(?) e ON e.key=r.ref AND e.value=r.revision
            WHERE memory_fts MATCH ? ORDER BY bm25(memory_fts), memory_fts.ref LIMIT ?""", (eligible, match, limit))]

    def _graph(self, slot):
        row = self.conn.execute("SELECT payload FROM global_graph WHERE slot=?", (slot,)).fetchone()
        return json.loads(row[0]) if row else None

    def graph_active(self):
        return self._graph("active")

    def graph_draft(self, input_fingerprint, algorithm_fingerprint):
        draft = self._graph("draft")
        if draft and (draft["input_fingerprint"], draft["algorithm_fingerprint"]) == (input_fingerprint, algorithm_fingerprint):
            return draft
        return None

    def save_graph_draft(self, draft):
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO global_graph VALUES('draft',?)", (json.dumps(draft, allow_nan=False),))

    def activate_graph(self, generation_id):
        active = self.graph_active()
        if active and active["generation_id"] == generation_id:
            return active
        draft = self._graph("draft")
        if not draft or draft["generation_id"] != generation_id:
            raise ValueError("Graph draft unavailable")
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO global_graph VALUES('active',?)", (json.dumps(draft, allow_nan=False),))
            self.conn.execute("DELETE FROM global_graph WHERE slot='draft'")
        return draft

    def discard_graph_draft(self):
        with self.conn:
            self.conn.execute("DELETE FROM global_graph WHERE slot='draft'")
