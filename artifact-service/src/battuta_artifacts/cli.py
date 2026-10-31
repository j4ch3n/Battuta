"""Local-only management interface. JSON is output, never registration input."""

import json
import sqlite3
import sys
from pathlib import Path

import click
from pydantic import ValidationError

from .config import database_path, public_base_url
from .models import Metadata, assemble_files
from .registry import ArtifactError, Registry, migrate


class ArtifactGroup(click.Group):
    def main(self, args=None, **kwargs):
        args = list(sys.argv[1:] if args is None else args)
        try:
            # Own the outer error boundary, including parsing before invoke().
            kwargs["standalone_mode"] = False
            return super().main(args, **kwargs)
        except (ArtifactError, ValidationError, OSError, sqlite3.Error, ValueError, click.ClickException) as exc:
            if isinstance(exc, ArtifactError):
                code, status = exc.code, exc.exit_code
            elif isinstance(exc, (OSError, sqlite3.Error)):
                code, status = "STORAGE_ERROR", 5
            else:
                code, status = "INVALID_INPUT", 2
            message = exc.format_message() if isinstance(exc, click.ClickException) else str(exc)
            if "--json" in args:
                click.echo(json.dumps({"ok": False, "error": {"code": code, "message": message}}))
            else:
                click.echo(f"Error: {message}", err=True)
            raise SystemExit(status) from exc


@click.group(cls=ArtifactGroup)
@click.option("--json", "json_output", is_flag=True, help="Return machine-readable output.")
@click.pass_context
def main(ctx, json_output):
    """Manage original host files exposed by the artifact service."""
    ctx.ensure_object(dict)
    ctx.obj["json"] = json_output


def output(ctx, json_output, **payload):
    if json_output or ctx.obj["json"]:
        click.echo(json.dumps({"ok": True, **payload}))
    elif "directory" in payload:
        from .bundles import file_tree
        click.echo(payload["guidance"] + "\n\nFiles and purposes:\n" + file_tree(payload["files"]))
    elif "artifact" in payload:
        item = payload["artifact"]
        click.echo(f"{item['slug']} — {item['status']} (revision {item['revision']})")
        if "url" in item:
            click.echo(f"URL: {item['url']}\nCheck locally: {item['local_url']}")
    elif "artifacts" in payload:
        for item in payload["artifacts"]:
            click.echo(f"{item['slug']}\t{item['status']}\t{item['title']}\t{item['description']}\t{item.get('url', '')}")
    else:
        click.echo(payload.get("message", "Done."))


def registry():
    result = Registry(database_path())
    result.check_schema()
    return result


def presented(item):
    if item["status"] != "published":
        return item
    public_path = f"/a/{item['slug']}/"
    local_path = f"/artifacts{public_path}"
    return {**item, "url": f"{public_base_url()}{public_path}", "local_url": f"http://127.0.0.1:8000{local_path}"}


def json_option(fn):
    return click.option("--json", "json_output", is_flag=True)(fn)


def file_options(fn):
    for option in [click.option("--file", "files", multiple=True, help="Additional relative file; repeat for each file."),
                   click.option("--entry", required=True), click.option("--root", type=click.Path(path_type=Path, file_okay=False))]:
        fn = option(fn)
    return fn


@main.command()
@json_option
@click.pass_context
def setup(ctx, json_output):
    """Explicitly create or upgrade the SQLite schema using Alembic."""
    migrate(database_path())
    output(ctx, json_output, message="Registry setup complete.")


@main.command()
@click.argument("name")
@click.option("--project", required=True)
@click.option("--slug")
@click.option("--template", default="report", help="Packaged reference template; see the artifacts skill for selection guidance.")
@click.option("--title", required=True)
@click.option("--description", required=True)
@json_option
@click.pass_context
def init(ctx, name, project, slug, template, title, description, json_output):
    """Initialize a project-owned reference bundle as a private draft."""
    from .bundles import initialize
    output(ctx, json_output, **initialize(registry(), project=project, name=name, slug=slug or name,
                                         template=template, title=title, description=description))


@main.command()
@click.option("--slug", required=True)
@click.option("--title", required=True)
@click.option("--description", required=True)
@file_options
@json_option
@click.pass_context
def register(ctx, slug, title, description, root, entry, files, json_output):
    """Register a new artifact and exact file allowlist."""
    metadata = Metadata(slug=slug, title=title, description=description)
    item = registry().register(**metadata.model_dump(), **assemble_files(root, entry, files), status="published")
    output(ctx, json_output, artifact=presented(item))


@main.command()
@click.argument("slug")
@click.option("--title")
@click.option("--description")
@click.option("--expected-revision", type=click.IntRange(min=1))
@json_option
@click.pass_context
def update(ctx, slug, title, description, expected_revision, json_output):
    """Update supplied metadata without changing files."""
    if title is None and description is None:
        raise ArtifactError("Provide --title or --description.")
    store = registry()
    current = store.get(slug)
    Metadata(slug=slug, title=title if title is not None else current["title"],
             description=description if description is not None else current["description"])
    output(ctx, json_output, artifact=presented(store.update_metadata(slug, title=title, description=description,
                                                                     expected_revision=expected_revision)))


@main.command("replace-files")
@click.argument("slug")
@file_options
@click.option("--expected-revision", type=click.IntRange(min=1))
@json_option
@click.pass_context
def replace_files(ctx, slug, root, entry, files, expected_revision, json_output):
    """Replace the complete file configuration; omitted files lose access."""
    item = registry().replace_files(slug, **assemble_files(root, entry, files), expected_revision=expected_revision)
    output(ctx, json_output, artifact=presented(item))


@main.command("list")
@json_option
@click.pass_context
def list_artifacts(ctx, json_output):
    """List registered artifacts."""
    output(ctx, json_output, artifacts=[presented(item) for item in registry().list()])


@main.command()
@click.argument("slug")
@json_option
@click.pass_context
def show(ctx, slug, json_output):
    """Show local source mapping, metadata, and exact allowlist."""
    item = presented(registry().get(slug))
    if not json_output and not ctx.obj["json"]:
        click.echo(json.dumps(item, indent=2))
    else:
        output(ctx, json_output, artifact=item)


@main.command()
@click.argument("slug")
@click.option("--expected-revision", type=click.IntRange(min=1))
@json_option
@click.pass_context
def deregister(ctx, slug, expected_revision, json_output):
    """Remove registration only; never delete source files."""
    registry().deregister(slug, expected_revision=expected_revision)
    output(ctx, json_output, message=f"Deregistered {slug}; source files unchanged.")


@main.command()
@click.option("--port", default=8000, type=click.IntRange(min=0, max=65535), show_default=True)
def serve(port):
    """Run the read-only service on 127.0.0.1 (never migrate schema)."""
    import uvicorn
    from .app import create_app

    registry()
    uvicorn.run(create_app(), host="127.0.0.1", port=port)
