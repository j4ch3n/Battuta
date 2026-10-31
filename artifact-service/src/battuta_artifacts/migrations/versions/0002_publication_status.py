"""Draft lifecycle and managed project identity; existing registrations stay public."""

from alembic import op

revision = "0002_publication_status"
down_revision = "0001_registry"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE artifacts ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'))")
    op.execute("UPDATE artifacts SET status='published'")
    op.execute("ALTER TABLE artifacts ADD COLUMN template TEXT")
    op.execute("ALTER TABLE artifacts ADD COLUMN project TEXT")
    op.execute("ALTER TABLE artifacts ADD COLUMN name TEXT")
    op.execute("CREATE UNIQUE INDEX artifact_project_name ON artifacts(project, name) WHERE project IS NOT NULL")


def downgrade():
    raise RuntimeError("Destructive registry downgrades are not supported; restore a backup instead.")
