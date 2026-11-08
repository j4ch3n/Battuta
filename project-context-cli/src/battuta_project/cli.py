"""Installed battuta-project command."""

import click
import json
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
    """Manage project checkouts, context, and GitHub/Linear association."""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@main.command()
@click.argument("project_name")
@click.option("--github", help="GitHub repository URL to clone into the workspace.")
@click.option("--linear", callback=_linear_pair, metavar="<project-id>,<team-id>", help="Existing Linear IDs to record locally.")
def init(project_name: str, github: str | None, linear: LinearConfig | None):
    """Create a named project and optionally clone GitHub."""
    project = ProjectRegistry().init(project_name, github=github, linear=linear)
    click.echo(render("init.md.j2", project))


@main.command("list")
@click.option("--json", "as_json", is_flag=True, help="Return a JSON project catalog.")
def list_projects(as_json: bool):
    """List registered projects and their managed root and checkout paths."""
    registry = ProjectRegistry()
    projects = registry.list_projects()
    if as_json:
        click.echo(json.dumps({"projects": sorted(p.name for p in projects)}, ensure_ascii=False))
        return
    click.echo(render("list.md.j2", ProjectList(projects=projects)) if projects else registry.discovery.unavailable_message())


@main.command()
@click.argument("project_name")
@click.pass_obj
def explain(token: str, project_name: str):
    """Show project summary, artifact paths, URLs, guidance, and checkout tree."""
    project = ProjectRegistry().load(project_name)
    explanation = explain_project(project)
    if project.config.linear.project_id:
        remote = LinearClient(token).get_project(project.config.linear.project_id)
        explanation = explanation.model_copy(update={"linear_project_url": remote.url})
    click.echo(render("explain.md.j2", explanation))


@main.group()
def github():
    """Associate a GitHub repository with an explicit project."""


@github.command("link")
@click.argument("project_name")
@click.argument("repo_url")
def github_link(project_name: str, repo_url: str):
    """Record a repository URL without cloning or modifying workspace files."""
    registry = ProjectRegistry()
    project = registry.link_github(registry.load(project_name), repo_url)
    click.echo(render("github.md.j2", project))


@main.group()
def linear():
    """Link a Linear project or create and link one."""


@linear.command()
@click.argument("project_name")
@click.argument("association", callback=_linear_pair, metavar="<project-id>,<team-id>")
def link(project_name: str, association: LinearConfig):
    """Record Linear IDs in an explicit project without an API request."""
    registry = ProjectRegistry()
    project = registry.link_linear(registry.load(project_name), association)
    click.echo(render("linear.md.j2", LinearResult(operation="link", project=project)))


@linear.command()
@click.argument("project_name")
@click.argument("name", callback=_trimmed)
@click.option("--team-id", required=True, callback=_trimmed, help="Team to associate with the new project.")
@click.pass_obj
def create(token: str, project_name: str, name: str, team_id: str):
    """Create a Linear project and link it to an explicit local project."""
    registry = ProjectRegistry()
    project = registry.load(project_name)
    remote = LinearClient(token).create_project(name, team_id)
    try:
        linked = registry.link_linear(project, LinearConfig(project_id=remote.id, team_id=team_id))
    except click.ClickException as error:
        recovery = shlex.join(["battuta-project", "linear", "link", project.name, f"{remote.id},{team_id}"])
        raise click.ClickException(
            f"Linear project was created: {remote.id} ({remote.url}), but its local link could not be saved: {error}.\n"
            f"After fixing the local error, recover with:\n{recovery}"
        ) from error
    click.echo(render("linear.md.j2", LinearResult(operation="create", project=linked, remote=remote)))
