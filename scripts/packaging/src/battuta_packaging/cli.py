"""Installed release packaging commands."""

from pathlib import Path

import click

from bot_setup.skills import check_manifests
from .services import install_services


@click.group()
def main():
    """Assemble and validate Battuta release output."""


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
