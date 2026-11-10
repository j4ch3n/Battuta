"""Installed release packaging commands."""

from pathlib import Path

import click

from bot_setup.skills import check_manifests
from .services import install_services
from .bundle import stage_bots, validate_bundle
from .runtime import install_runtime
from .launch import run_bot


@click.group()
def main():
    """Assemble and validate Battuta release output."""


@main.command("stage-bots")
@click.option("--source", required=True, type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--destination", required=True, type=click.Path(file_okay=False, path_type=Path))
@click.option("--tag", required=True)
@click.option("--tool-version", required=True)
def stage(source, destination, tag, tool_version):
    """Build generated role profiles into an empty installation tree."""
    stage_bots(source.resolve(), destination, tag=tag, tool_version=tool_version)


@main.command("validate-bundle")
@click.option("--root", required=True, type=click.Path(file_okay=False, path_type=Path))
def validate_release(root):
    """Check installed role resources without a source catalog or Pi startup."""
    validate_bundle(root)


@main.command("install-runtime")
@click.option("--root", required=True, type=click.Path(exists=True, file_okay=False, path_type=Path, resolve_path=True))
@click.option("--node", required=True, type=click.Path(dir_okay=False, path_type=Path))
def runtime(root, node):
    """Install locked JavaScript dependencies without starting bots."""
    install_runtime(root, node=node)


@main.command("run-bot")
@click.option("--root", required=True, type=click.Path(exists=True, file_okay=False, path_type=Path, resolve_path=True))
@click.option("--bot", required=True)
@click.option("--env-file", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--node", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path, resolve_path=True))
@click.option("--mode", required=True, type=click.Choice(["service", "foreground-maintenance"]))
def launch(root, bot, env_file, node, mode):
    """Run exactly one named bot; stop its service before foreground maintenance."""
    run_bot(root, bot=bot, env_file=env_file, node=node, mode=mode)


@main.command("validate-skills")
@click.argument("root", type=click.Path(exists=True, file_okay=False, path_type=Path))
def validate(root):
    """Validate profile metadata against the installed shared catalog."""
    check_manifests(root)


@main.command("install-services")
@click.option("--root", required=True, type=click.Path(file_okay=False, path_type=Path))
@click.option("--replace", is_flag=True, help="Replace existing regular unit files with this release's definitions. Stop services first.")
def services(root, replace):
    """Install user service units, never start or restart them."""
    install_services(root, replace=replace)


if __name__ == "__main__":
    main()
