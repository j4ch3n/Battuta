"""Bot-facing commands for ordered TODO queues."""

import os
from collections.abc import Callable

import click

from .presentation import display_path
from .todo_errors import TodoError
from .todos import TodoList, TodoStore


def render_todos(result: TodoList, operation: str) -> str:
    scope = f"project / {result.project}" if result.scope == "project" else "general"
    counts = {status: sum(item.status == status for item in result.items) for status in ("done", "cancelled", "todo")}
    next_item = next((item for item in result.items if item.status == "todo"), None)
    lines = [
        operation,
        f"Scope: {scope} · Role: {result.role}",
        f"File: {display_path(result.path)}",
        "",
    ]
    for item in result.items:
        lines.append(f"{item.id}. [{item.status}] {item.description}")
        if item.rational:
            lines.append(f"   Rational: {item.rational}")
    lines.extend([
        "",
        f"Progress: {counts['done']} done, {counts['cancelled']} cancelled, {counts['todo']} remaining",
        f"Next: #{next_item.id} {next_item.description}" if next_item else "No remaining TODO items.",
    ])
    return "\n".join(lines)


def _show(operation: str, action: Callable[[], TodoList | None]) -> None:
    try:
        result = action()
    except TodoError as error:
        raise click.ClickException(str(error)) from error
    if result is None:
        click.echo("No active TODO list in this scope for this role. Use create --item to start one in execution order.")
    else:
        click.echo(render_todos(result, operation))


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
@click.pass_obj
def create(store: TodoStore, item: tuple[str, ...], force: bool):
    """Create a new list; unfinished work blocks creation unless --force."""
    _show("Created TODO list", lambda: store.create(list(item), force=force))


@todo.command("list")
@click.pass_obj
def list_todos(store: TodoStore):
    """Show every item, progress, and the next step in the latest list."""
    _show("Current TODO list", store.read)


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
