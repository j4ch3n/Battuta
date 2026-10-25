"""Bot-facing commands for learnings, findings and thoughts."""

import os
import shlex

import click

from .notes import Notebook, NoteStore
from .presentation import display_path


def _show(store: NoteStore, result: Notebook | None, operation: str, *, query: str | None = None, to_line: int | None = None, limit: int | None = None):
    if result is None:
        scope = f"project / {store.work.project}" if store.work.project else "general"
        click.echo(f"No notebook in scope {scope} for role {store.work.role}.")
        return
    scope = f"project / {result.project}" if result.project else "general"
    lines = [operation, f"Scope: {scope} · Role: {result.role}", f"Work: {result.role}:{result.work_id}", f"File: {display_path(result.path)}", ""]
    lines.extend(f"{line.number}. {line.text}" for line in result.lines)
    if not result.lines:
        lines.append("No matches." if query is not None else "No notes in the requested range.")
    if result.next_line is not None:
        args = ["battuta-project", "note", "--scope", result.scope, "search" if query is not None else "read", "--from-line", str(result.next_line)]
        if query is not None:
            args.extend(["--query", query])
        if to_line is not None:
            args.extend(["--to-line", str(to_line)])
        if limit is not None:
            args.extend(["--limit", str(limit)])
        lines.extend([f"Truncated: more notes available from line {result.next_line}.", shlex.join(args)])
    click.echo("\n".join(lines))


@click.group()
@click.option("--scope", required=True, type=click.Choice(["project", "general"]), help="Choose the selected project or general notes.")
@click.pass_context
def note(ctx: click.Context, scope: str):
    """Retain learnings, findings and thoughts independently of TODOs."""
    ctx.obj = NoteStore(scope, os.environ.get("AGENT_ROLE", ""))


@note.command()
@click.option("--text", required=True, help="Nonblank single-line note; preserve Markdown and Unicode.")
@click.pass_obj
def append(store: NoteStore, text: str):
    """Append a note; first append creates this role's notebook."""
    _show(store, store.append(text), "Appended note")


@note.command()
@click.option("--from-line", default=1, type=click.IntRange(min=1), show_default=True)
@click.option("--to-line", type=click.IntRange(min=1), help="Inclusive last line.")
@click.option("--limit", type=click.IntRange(min=1), help="Maximum notes returned, with continuation.")
@click.pass_obj
def read(store: NoteStore, from_line: int, to_line: int | None, limit: int | None):
    """Read the full notebook or an inclusive numbered range."""
    _show(store, store.read(from_line=from_line, to_line=to_line, limit=limit), "Notebook notes", to_line=to_line, limit=limit)


@note.command()
@click.option("--query", required=True, help="Literal, case-insensitive text (not a regular expression).")
@click.option("--from-line", default=1, type=click.IntRange(min=1), show_default=True)
@click.option("--limit", type=click.IntRange(min=1), help="Maximum matches returned, with continuation.")
@click.pass_obj
def search(store: NoteStore, query: str, from_line: int, limit: int | None):
    """Find numbered matching lines using ripgrep."""
    _show(store, store.search(query, from_line=from_line, limit=limit), "Notebook matches", query=query, limit=limit)
