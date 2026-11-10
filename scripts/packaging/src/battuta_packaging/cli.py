"""Installed release packaging commands."""

from pathlib import Path

import click

from bot_setup.skills import check_manifests
from .services import install_services
from .bundle import stage_bots, validate_bundle


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
