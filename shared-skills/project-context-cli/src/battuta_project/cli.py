"""Installed battuta-project command."""

import click
import shlex

from .explain import explain_project
from .linear import LinearClient, require_linear_token
from .models import LinearConfig, LinearResult, ProjectList
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


def _linear_pair(ctx, param, value):
    """Parse a complete Linear association for both init and link."""
    if value is None:
        return None
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 2 or not all(parts):
        raise click.BadParameter("expected <project-id>,<team-id> with two nonblank IDs", ctx=ctx, param=param)
    return LinearConfig(project_id=parts[0], team_id=parts[1])


@click.group(cls=_TokenGroup, invoke_without_command=True)
@click.pass_context
def main(ctx):
    """Manage project checkouts, selection, context, and Linear association."""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@main.command()
@click.argument("project_name")
@click.option("--github", help="GitHub repository URL to clone into the workspace.")
@click.option("--linear", callback=_linear_pair, metavar="<project-id>,<team-id>", help="Existing Linear IDs to record locally.")
def init(project_name: str, github: str | None, linear: LinearConfig | None):
    """Create a named project, optionally clone GitHub, and select it."""
    project = ProjectRegistry().init(project_name, github=github, linear=linear)
    click.echo(render("init.md.j2", project))


@main.command("list")
def list_projects():
    """List registered projects and their managed root and checkout paths."""
    projects = ProjectRegistry().list_projects()
    click.echo(render("list.md.j2", ProjectList(projects=projects)))


@main.command()
def current():
    """Report the selected project name without inspecting its checkout."""
    click.echo(f"Current Project: {ProjectRegistry().current_name()}")


@main.command()
@click.argument("project_name")
def switch(project_name: str):
    """Select an existing project by its exact folder name."""
    project = ProjectRegistry().switch(project_name)
    click.echo(render("switch.md.j2", project))


@main.command()
@click.pass_obj
def explain(token: str):
    """Show project summary, artifact paths, URLs, guidance, and checkout tree."""
    project = ProjectRegistry().current()
    explanation = explain_project(project)
    if project.config.linear.project_id:
        remote = LinearClient(token).get_project(project.config.linear.project_id)
        explanation = explanation.model_copy(update={"linear_project_url": remote.url})
    click.echo(render("explain.md.j2", explanation))


@main.group()
def github():
    """Associate a GitHub repository with the current project."""


@github.command("link")
@click.argument("repo_url")
def github_link(repo_url: str):
    """Record a repository URL without cloning or modifying workspace files."""
    registry = ProjectRegistry()
    project = registry.link_github(registry.current(), repo_url)
    click.echo(render("github.md.j2", project))


@main.group()
def linear():
    """Link a Linear project or create and link one."""


@linear.command()
@click.argument("association", callback=_linear_pair, metavar="<project-id>,<team-id>")
def link(association: LinearConfig):
    """Record Linear IDs in the current project without an API request."""
    registry = ProjectRegistry()
    project = registry.link_linear(registry.current(), association)
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
        recovery = shlex.join(["battuta-project", "linear", "link", f"{remote.id},{team_id}"])
        switch = shlex.join(["battuta-project", "switch", project.name])
        raise click.ClickException(
            f"Linear project was created: {remote.id} ({remote.url}), but its local link could not be saved: {error}.\n"
            f"After fixing the local error, recover with:\n{switch}\n{recovery}"
        ) from error
    click.echo(render("linear.md.j2", LinearResult(operation="create", project=linked, remote=remote)))
