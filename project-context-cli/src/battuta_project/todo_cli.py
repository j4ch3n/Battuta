"""Bot-facing commands for ordered TODO queues."""

import os
from collections.abc import Callable

import click

from .presentation import display_path
from .todo_errors import TodoError, TodoErrorCode
from .todos import TodoList, TodoStore


def render_todos(result: TodoList, operation: str, *, remain: bool = False, next_only: bool = False, handoff: bool = False) -> str:
    scope = f"project / {result.project}" if result.scope == "project" else "general"
    counts = {status: sum(item.status == status for item in result.items) for status in ("done", "cancelled", "todo")}
    next_item = next((item for item in result.items if item.status == "todo"), None)
    lines = [
        operation,
        f"Scope: {scope} · Role: {result.role}",
        f"File: {display_path(result.path)}",
    ]
    if result.work_id is not None:
        lines.append(f"Work: {result.role}:{result.work_id}")
    if result.related_to is not None:
        lines.append(f"Related to: {result.related_to}")
    lines.append("")
    items = result.items
    if next_only:
        items = [next_item] if next_item else []
    elif remain:
        items = [item for item in items if item.status == "todo"]
    for item in items:
        lines.append(f"{item.id}. [{item.status}] {item.description}")
        if item.rational:
            lines.append(f"   Rational: {item.rational}")
    lines.extend([
        "",
        f"Progress: {counts['done']} done, {counts['cancelled']} cancelled, {counts['todo']} remaining",
        f"Next: #{next_item.id} {next_item.description}" if next_item else "No remaining TODO items.",
    ])
    if handoff and result.related_to is None:
        counterpart = "tl" if result.role == "pm" else "pm"
        lines.extend([
            "",
            f"For optional coordination, include {result.role}:{result.work_id} and scope {scope} in a bot-mail message to {counterpart.upper()}.",
            f"The counterparty can create its own related work in that same scope{' (select this project first)' if result.project else ''}:",
            f'battuta-project todo --scope {result.scope} create --related-to {result.role}:{result.work_id} --item "Describe your steps"',
        ])
    return "\n".join(lines)


def _show(operation: str, action: Callable[[], TodoList | None], *, remain: bool = False, next_only: bool = False, handoff: bool = False) -> None:
    try:
        result = action()
    except TodoError as error:
        raise click.ClickException(str(error)) from error
    if result is None:
        click.echo("No active TODO list in this scope for this role. Use create --item to start one in execution order.")
    else:
        click.echo(render_todos(result, operation, remain=remain, next_only=next_only, handoff=handoff))


@click.group()
@click.option("--scope", required=True, type=click.Choice(["project", "general"]), help="Choose the selected project, or general work without project ownership.")
@click.pass_context
def todo(ctx: click.Context, scope: str):
    """Keep an ordered execution list for long-running work."""
    try:
        ctx.obj = TodoStore(scope, os.environ.get("AGENT_ROLE", ""))
    except TodoError as error:
        raise click.ClickException(str(error)) from error


@todo.command()
@click.option("--item", multiple=True, required=True, help="Step description; repeat in execution order.")
@click.option("--force", is_flag=True, help="Abandon unfinished work only after explicit owner approval; preserve its file.")
@click.option("--related-to", help="Associate new work with an existing ROLE:WORK_ID in the same ownership scope.")
@click.pass_obj
def create(store: TodoStore, item: tuple[str, ...], force: bool, related_to: str | None):
    """Start this role's work; its unfinished list blocks unless --force."""
    _show("Created TODO list", lambda: store.create(list(item), force=force, related_to=related_to), handoff=True)


@todo.command()
@click.option("--item", multiple=True, required=True, help="Additional step description; repeat in execution order.")
@click.pass_obj
def extend(store: TodoStore, item: tuple[str, ...]):
    """Append steps to this role's current work, including a finished list."""
    _show("Extended TODO list", lambda: store.extend(list(item)))


@todo.command("list")
@click.option("--remain", is_flag=True, help="Show only remaining TODO items; keep overall progress counts and original IDs.")
@click.option("--next", "next_only", is_flag=True, help="Show only the next TODO item in execution order; keep overall progress counts and its original ID.")
@click.pass_obj
def list_todos(store: TodoStore, remain: bool, next_only: bool):
    """Show this role's current list, optionally remaining or next work."""
    if remain and next_only:
        raise click.ClickException(str(TodoError(TodoErrorCode.CONFLICTING_FILTERS)))
    operation = "Next TODO item" if next_only else "Remaining TODO items" if remain else "Current TODO list"
    _show(operation, store.read, remain=remain, next_only=next_only)


@todo.command()
@click.option("--rational", required=True, help="Detailed outcome and relevant verification for completing the next step.")
@click.pass_obj
def done(store: TodoStore, rational: str):
    """Mark only the next TODO item done, after relevant verification."""
    _show("Completed next TODO item", lambda: store.advance("done", rational))


@todo.command()
@click.option("--rational", required=True, help="Detailed explanation of why the next step is cancelled.")
@click.pass_obj
def cancel(store: TodoStore, rational: str):
    """Cancel only the next TODO item without claiming it was completed."""
    _show("Cancelled next TODO item", lambda: store.advance("cancelled", rational))


@todo.command("update-todo")
@click.option("--item", multiple=True, required=True, help="Replacement remaining step; repeat in execution order.")
@click.pass_obj
def update_todo(store: TodoStore, item: tuple[str, ...]):
    """Replace all remaining steps, preserving completed/cancelled items."""
    _show("Updated remaining TODO items", lambda: store.update_todo(list(item)))
