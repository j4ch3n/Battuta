"""Bot-facing commands for learnings, findings and thoughts."""

import os
import shlex
import sys

import click

from .notes import Notebook, NoteStore
from .presentation import display_path
from .drafts import DraftStore


def _show(store: NoteStore, result: Notebook | None, operation: str, *, query: str | None = None, to_line: int | None = None, limit: int | None = None, item_mode: bool = False):
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
        args = ["battuta-project", "note", "--scope", result.scope]
        args.extend(["item", "--search", query] if item_mode and query is not None else ["item", "--list"] if item_mode else ["search" if query is not None else "read"])
        args.extend(["--from-line", str(result.next_line)])
        if query is not None and not item_mode:
            args.extend(["--query", query])
        if to_line is not None:
            args.extend(["--to-line", str(to_line)])
        if limit is not None:
            args.extend(["--limit", str(limit)])
        lines.extend([f"Truncated: more notes available from line {result.next_line}.", shlex.join(args)])
    click.echo("\n".join(lines))


@click.group(invoke_without_command=True)
@click.option("--scope", required=True, type=click.Choice(["project", "general"]), help="Choose the selected project or general notes.")
@click.option("--meta", is_flag=True, help="Show notebook identity and item/draft references without bodies.")
@click.pass_context
def note(ctx: click.Context, scope: str, meta: bool):
    """Retain learnings, findings and thoughts independently of TODOs."""
    ctx.obj = NoteStore(scope, os.environ.get("AGENT_ROLE", ""))
    if meta:
        if ctx.invoked_subcommand:
            raise click.UsageError("Use --meta without a subcommand")
        result = ctx.obj.metadata()
        if result is None:
            _show(ctx.obj, None, "Notebook metadata")
        else:
            notebook, index = result
            click.echo(f"Notebook: {notebook.role}:{notebook.work_id}\nScope: {scope} · Project: {notebook.project or 'none'}\nItems: {len(notebook.lines)}\nItem file: {notebook.path}\nDrafts: {len(index['drafts'])}")
            for draft in index["drafts"]:
                click.echo(f"{draft['id']}. {draft['title']} · {notebook.path.parent / draft['file']}")
    elif ctx.invoked_subcommand is None:
        raise click.UsageError("Choose item, draft, a legacy command, or --meta")


@note.command()
@click.option("--text", help="Append a single-line finding.")
@click.option("--list", "list_items", is_flag=True)
@click.option("--search", "query", help="Literal case-insensitive search.")
@click.option("--from-line", default=1, type=click.IntRange(min=1))
@click.option("--to-line", type=click.IntRange(min=1))
@click.option("--limit", type=click.IntRange(min=1))
@click.pass_obj
def item(store: NoteStore, text: str | None, list_items: bool, query: str | None, from_line: int, to_line: int | None, limit: int | None):
    """Append, list or search numbered items."""
    if sum((text is not None, list_items, query is not None)) != 1:
        raise click.UsageError("Choose exactly one of --text, --list, --search")
    if text is not None:
        if from_line != 1 or to_line is not None or limit is not None:
            raise click.UsageError("Ranges and limits apply only to listing/search")
        _show(store, store.append(text), "Appended note")
    elif query is not None:
        if to_line is not None:
            raise click.UsageError("--to-line applies only to --list")
        _show(store, store.search(query, from_line=from_line, limit=limit), "Notebook matches", query=query, limit=limit, item_mode=True)
    else:
        _show(store, store.read(from_line=from_line, to_line=to_line, limit=limit), "Notebook notes", to_line=to_line, limit=limit, item_mode=True)


@note.command()
@click.option("--title", help="Create an editable draft with complete content from stdin.")
@click.option("--list", "list_drafts", is_flag=True)
@click.option("--get", "identifier", type=click.IntRange(min=1))
@click.pass_obj
def draft(store: NoteStore, title: str | None, list_drafts: bool, identifier: int | None):
    """Create, list or retrieve drafts; edit returned paths with ordinary file tools."""
    if sum((title is not None, list_drafts, identifier is not None)) != 1:
        raise click.UsageError("Choose exactly one of --title, --list, --get")
    drafts = DraftStore(store)
    if title is not None:
        if sys.stdin.isatty():
            raise click.UsageError("Pipe complete draft content to stdin")
        try:
            text = sys.stdin.buffer.read().decode("utf-8")
        except UnicodeError as error:
            raise click.ClickException(f"Invalid UTF-8 draft input: {error}") from error
        notebook, record = drafts.create(title, text)
        click.echo(f"Draft {record['id']} saved to {notebook.path.parent / record['file']}\n")
        click.echo(text, nl=False)
    elif identifier is not None:
        click.echo(drafts.get(identifier), nl=False)
    else:
        result = drafts.listing()
        if result is None:
            _show(store, None, "Notebook drafts")
        else:
            notebook, rows = result
            click.echo(f"Drafts · {notebook.scope} · Role: {notebook.role} · Work: {notebook.work_id}")
            if not rows:
                click.echo("No drafts.")
            for row in rows:
                click.echo(f"{row['id']}. {row['title']} · {row['availability']} · {row['path']}")


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
