"""Initial artifact registry."""

from alembic import op

revision = "0001_registry"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        source_root TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('html', 'markdown')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id, entry_path) REFERENCES artifact_files (artifact_id, public_path)
            DEFERRABLE INITIALLY DEFERRED
    )""")
    op.execute("""CREATE TABLE artifact_files (
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        public_path TEXT NOT NULL,
        media_type TEXT NOT NULL,
        PRIMARY KEY (artifact_id, public_path)
    )""")


def downgrade():
    raise RuntimeError("Destructive registry downgrades are not supported; restore a backup instead.")
