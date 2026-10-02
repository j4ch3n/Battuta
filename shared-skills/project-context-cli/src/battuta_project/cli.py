"""Installed battuta-project command."""

import click
import shlex

from .explain import explain_project
from .memory import ProjectMemory
from .linear import LinearClient, require_linear_token
from .models import LinearConfig, LinearResult, MemoryResult
from .presentation import render
from .registry import ProjectRegistry


class _TokenGroup(click.Group):
    def make_context(self, info_name, args, parent=None, **extra):
        # Check before parsing: Click's eager help option bypasses callbacks.
        token = require_linear_token()
        context = super().make_context(info_name, args, parent=parent, **extra)
        context.obj = token
        return context


def _trimmed(ctx, param, value):
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise click.BadParameter("must not be blank", ctx=ctx, param=param)
    return value


@click.group(cls=_TokenGroup, invoke_without_command=True)
@click.pass_context
def main(ctx):
    """Manage project checkouts, context, and durable memory."""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@main.command()
@click.argument("github_url")
@click.option("--linear-project-id", callback=_trimmed, help="Existing Linear project ID to record locally.")
@click.option("--linear-team-id", callback=_trimmed, help="Linear team ID to record locally.")
def init(github_url: str, linear_project_id: str | None, linear_team_id: str | None):
    """Clone a GitHub repository and select it as the current project."""
    metadata = LinearConfig(project_id=linear_project_id, team_id=linear_team_id)
    project = ProjectRegistry().init(github_url, linear=metadata)
    click.echo(render("init.md.j2", project))


@main.command()
@click.argument("project_name")
def switch(project_name: str):
    """Select an existing project by its exact folder name."""
    project = ProjectRegistry().switch(project_name)
    click.echo(render("switch.md.j2", project))


@main.command()
def explain():
    """Index the current checkout's README/AGENTS files and directory tree."""
    click.echo(render("explain.md.j2", explain_project(ProjectRegistry().current())))


@main.group()
def linear():
    """Refresh Linear teams, link a project, or create and link one."""


@linear.command()
@click.pass_obj
def refresh(token: str):
    """Fetch all accessible teams and update the shared cache."""
    registry = ProjectRegistry()
    registry.state()
    teams = LinearClient(token).list_teams()
    registry.update_teams(teams)
    click.echo(render("linear.md.j2", LinearResult(operation="refresh", teams=teams)))


@linear.command()
@click.option("--project-id", required=True, callback=_trimmed, help="Existing Linear project ID.")
@click.option("--team-id", required=True, callback=_trimmed, help="Linear team ID.")
def link(project_id: str, team_id: str):
    """Record Linear IDs in the current project without an API request."""
    registry = ProjectRegistry()
    project = registry.link_linear(registry.current(), LinearConfig(project_id=project_id, team_id=team_id))
    click.echo(render("linear.md.j2", LinearResult(operation="link", project=project)))


@linear.command()
@click.argument("name", callback=_trimmed)
@click.option("--team-id", required=True, callback=_trimmed, help="Team to associate with the new project.")
@click.pass_obj
def create(token: str, name: str, team_id: str):
    """Create a Linear project and link it to the current local project."""
    registry = ProjectRegistry()
    project = registry.current()
    remote = LinearClient(token).create_project(name, team_id)
    try:
        linked = registry.link_linear(project, LinearConfig(project_id=remote.id, team_id=team_id))
    except click.ClickException as error:
        recovery = shlex.join(["battuta-project", "linear", "link", "--project-id", remote.id, "--team-id", team_id])
        switch = shlex.join(["battuta-project", "switch", project.name])
        raise click.ClickException(
            f"Linear project was created: {remote.id} ({remote.url}), but its local link could not be saved: {error}.\n"
            f"After fixing the local error, recover with:\n{switch}\n{recovery}"
        ) from error
    click.echo(render("linear.md.j2", LinearResult(operation="create", project=linked, remote=remote)))


@main.group()
def memory():
    """Read or edit durable memory for the current project."""


def _memory_result(operation, content=None, index=None):
    project = ProjectRegistry().current()
    store = ProjectMemory(project)
    entries = []
    if operation == "get":
        entries = store.get()
        count = len(entries)
    elif operation == "append":
        count = store.append(content)
    elif operation == "replace":
        store.replace(index, content)
        count = index
    else:
        count = store.replace_all(content)
    click.echo(render("memory.md.j2", MemoryResult(project=project.name, operation=operation, count=count, entries=entries)))


@memory.command()
@click.argument("content")
def append(content: str):
    """Append one non-empty trimmed memory line."""
    _memory_result("append", content)


@memory.command()
def get():
    """Return full memory with 1-based line indexes."""
    _memory_result("get")


@memory.command()
@click.argument("line_index", type=click.IntRange(min=1))
@click.argument("content")
def replace(line_index: int, content: str):
    """Replace one existing memory line."""
    _memory_result("replace", content, line_index)


@memory.command(name="replaceAll")
@click.argument("content")
def replace_all(content: str):
    """Replace full memory, trimming lines and dropping empty lines."""
    _memory_result("replaceAll", content)
