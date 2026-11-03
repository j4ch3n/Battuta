"""Installed release packaging commands."""

from pathlib import Path

import click

from bot_setup.skills import validate_bundle
from .services import install_services
from .skills import stage_skills


@click.group()
def main():
    """Assemble and validate Battuta release output."""


@main.command("stage-skills")
@click.argument("root", type=click.Path(exists=True, file_okay=False, path_type=Path))
def stage(root):
    """Copy manifest-selected skill directories into fresh staging."""
    stage_skills(root)


@main.command("validate-skills")
@click.argument("root", type=click.Path(exists=True, file_okay=False, path_type=Path))
def validate(root):
    """Validate both bots' fixed skill bundles without a catalog."""
    for bot in ("pm-bot", "tl-bot"):
        validate_bundle(root / "bots" / bot)


@main.command("install-services")
@click.option("--root", required=True, type=click.Path(file_okay=False, path_type=Path))
def services(root):
    """Install user service units, never start or restart them."""
    install_services(root)


if __name__ == "__main__":
    main()
