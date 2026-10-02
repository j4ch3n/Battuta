"""Installed battuta-project command."""

import click

from .explain import explain_project
from .memory import ProjectMemory
from .models import MemoryResult
from .presentation import render
from .registry import ProjectRegistry


@click.group()
def main():
    """Manage project checkouts, context, and durable memory."""


@main.command()
@click.argument("github_url")
def init(github_url: str):
    """Clone a GitHub repository and select it as the current project."""
    project = ProjectRegistry().init(github_url)
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
