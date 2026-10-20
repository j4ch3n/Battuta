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
