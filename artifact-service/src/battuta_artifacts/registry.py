"""Transactional registry; only explicit setup is allowed to migrate schema."""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import URL, create_engine


class ArtifactError(Exception):
    code = "INVALID_INPUT"
    exit_code = 2


class NotFound(ArtifactError):
    code = "NOT_FOUND"
    exit_code = 3


class Conflict(ArtifactError):
    code = "CONFLICT"
    exit_code = 4


class SchemaError(ArtifactError):
    code = "SCHEMA_MISMATCH"
    exit_code = 5


def migration_config() -> Config:
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    return config


def migrate(path: Path) -> None:
    """Explicit setup/upgrade entry point. Never called by Registry or app startup."""
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(URL.create("sqlite", database=str(path)))
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()
            config = migration_config()
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    finally:
        engine.dispose()


class Registry:
    def __init__(self, path: Path):
        self.path = path.absolute()

    @contextmanager
    def connect(self, *, write=False):
        # mode=rw/ro prevents accidental schema/file creation outside setup.
        connection = sqlite3.connect(self.path.as_uri() + ("?mode=rw" if write else "?mode=ro"), uri=True, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def check_schema(self) -> None:
        try:
            with self.connect() as db:
                rows = db.execute("SELECT version_num FROM alembic_version").fetchall()
                expected = ScriptDirectory.from_config(migration_config()).get_heads()
                if sorted(row[0] for row in rows) != sorted(expected):
                    raise SchemaError("Registry schema is incompatible; run battuta-artifact setup.")
        except sqlite3.Error as exc:
            raise SchemaError("Registry is not initialized; run battuta-artifact setup.") from exc

    @staticmethod
    def _find(db, slug):
        row = db.execute("SELECT * FROM artifacts WHERE slug=?", (slug,)).fetchone()
        if row is None:
            raise NotFound(f"Artifact not found: {slug}")
        return dict(row)

    @staticmethod
    def _expect(item, expected_revision):
        if expected_revision is not None and item["revision"] != expected_revision:
            raise Conflict("Artifact revision changed; inspect it before retrying.")

    def get(self, slug: str) -> dict:
        with self.connect() as db:
            # SELECT does not start a transaction in sqlite3's legacy mode.
            # Pin metadata and allowlist to one revision, even under WAL writers.
            db.execute("BEGIN")
            return self._snapshot(db, slug)

    @classmethod
    def _snapshot(cls, db, slug):
        item = cls._find(db, slug)
        item["files"] = dict(db.execute("SELECT public_path, media_type FROM artifact_files WHERE artifact_id=? ORDER BY public_path", (item["id"],)))
        return item

    def list(self, *, published_only=False) -> list[dict]:
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM artifacts" +
                    (" WHERE status='published'" if published_only else "") + " ORDER BY updated_at DESC, slug")]

    def project_artifact(self, project: str, name: str) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT slug FROM artifacts WHERE project=? AND name=?", (project, name)).fetchone()
            if row is None:
                raise NotFound(f"Artifact not found in project {project}: {name}")
            return self.get(row["slug"])

    def register(self, *, slug: str, title: str, description: str, source_root: str,
                 entry_path: str, format: str, files: dict[str, str], status="draft", template=None,
                 project=None, name=None) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        identifier = str(uuid4())
        with self.connect(write=True) as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM artifacts WHERE slug=?", (slug,)).fetchone():
                raise Conflict(f"Slug already registered: {slug}")
            if project is not None and db.execute("SELECT 1 FROM artifacts WHERE project=? AND name=?", (project, name)).fetchone():
                raise Conflict(f"Artifact already exists in project {project}: {name}")
            db.execute("""INSERT INTO artifacts
                       (id, slug, title, description, source_root, entry_path, format, revision, created_at, updated_at,
                        status, template, project, name) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)""",
                       (identifier, slug, title, description, source_root, entry_path, format, now, now, status, template, project, name))
            db.executemany("INSERT INTO artifact_files VALUES (?, ?, ?)",
                           [(identifier, path, media) for path, media in files.items()])
            return self._snapshot(db, slug)

    def publish(self, slug: str, *, files: dict[str, str], expected_revision=None) -> dict:
        with self.connect(write=True) as db:
            db.execute("BEGIN IMMEDIATE")
            item = self._find(db, slug)
            self._expect(item, expected_revision)
            previous = dict(db.execute("SELECT public_path, media_type FROM artifact_files WHERE artifact_id=?", (item["id"],)))
            if item["status"] != "published" or files != previous:
                db.execute("DELETE FROM artifact_files WHERE artifact_id=?", (item["id"],))
                db.executemany("INSERT INTO artifact_files VALUES (?, ?, ?)",
                               [(item["id"], path, media) for path, media in files.items()])
                db.execute("UPDATE artifacts SET status='published', revision=revision+1, updated_at=? WHERE id=?",
                           (datetime.now(timezone.utc).isoformat(), item["id"]))
            return self._snapshot(db, slug)

    def update_metadata(self, slug: str, *, title=None, description=None, expected_revision=None) -> dict:
        with self.connect(write=True) as db:
            db.execute("BEGIN IMMEDIATE")
            item = self._find(db, slug)
            self._expect(item, expected_revision)
            db.execute("UPDATE artifacts SET title=?, description=?, revision=revision+1, updated_at=? WHERE id=?",
                       (title if title is not None else item["title"], description if description is not None else item["description"],
                        datetime.now(timezone.utc).isoformat(), item["id"]))
        return self.get(slug)

    def replace_files(self, slug: str, *, source_root: str, entry_path: str, format: str,
                      files: dict[str, str], expected_revision=None) -> dict:
        with self.connect(write=True) as db:
            db.execute("BEGIN IMMEDIATE")
            item = self._find(db, slug)
            self._expect(item, expected_revision)
            db.execute("DELETE FROM artifact_files WHERE artifact_id=?", (item["id"],))
            db.executemany("INSERT INTO artifact_files VALUES (?, ?, ?)",
                           [(item["id"], path, media) for path, media in files.items()])
            db.execute("UPDATE artifacts SET source_root=?, entry_path=?, format=?, revision=revision+1, updated_at=? WHERE id=?",
                       (source_root, entry_path, format, datetime.now(timezone.utc).isoformat(), item["id"]))
        return self.get(slug)

    def deregister(self, slug: str, *, expected_revision=None) -> None:
        with self.connect(write=True) as db:
            db.execute("BEGIN IMMEDIATE")
            item = self._find(db, slug)
            self._expect(item, expected_revision)
            db.execute("DELETE FROM artifacts WHERE id=?", (item["id"],))
