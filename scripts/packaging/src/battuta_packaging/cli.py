"""Installed release packaging commands."""

from pathlib import Path
import os
import shutil

import click

from .services import install_services
from .bundle import stage_bots, validate_bundle, extract_bundle
from .runtime import install_runtime
from .launch import run_bot
from bot_setup.env import read_env
from .wheel_metadata import build_wheels


@click.group()
def main():
    """Assemble and validate Battuta release output."""


@main.command("build-wheels")
@click.option("--source", required=True, type=click.Path(exists=True, file_okay=False, path_type=Path, resolve_path=True))
@click.option("--output", required=True, type=click.Path(file_okay=False, path_type=Path))
@click.option("--tag", required=True)
@click.option("--tool-version", required=True)
def wheels(source, output, tag, tool_version):
    """Build self-describing release wheels from checked-in runtime locks."""
    build_wheels(source, output, tag=tag, tool_version=tool_version)


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


@main.command("extract-bots")
@click.option("--archive", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--root", required=True, type=click.Path(file_okay=False, path_type=Path))
def extract(archive, root):
    """Extract a checksum-verified archive into an empty destination."""
    extract_bundle(archive, root)


@main.command("install-runtime")
@click.option("--root", required=True, type=click.Path(exists=True, file_okay=False, path_type=Path, resolve_path=True))
@click.option("--node", required=True, type=click.Path(dir_okay=False, path_type=Path))
def runtime(root, node):
    """Install locked JavaScript dependencies without starting bots."""
    install_runtime(root, node=node)


@main.command("install-speech")
def install_speech():
    """Download and verify release speech assets."""
    from .speech_models import install_models

    try:
        install_models(Path.home())
    except (OSError, ValueError) as error:
        raise click.ClickException(str(error)) from error
    click.echo("Speech assets installed")


@main.command("verify-speech")
def verify_speech():
    """Verify provisioned speech assets."""
    from .speech_models import verify_models

    try:
        verify_models(Path.home())
    except (OSError, ValueError) as error:
        raise click.ClickException(str(error)) from error
    click.echo("Speech assets verified")


@main.command("run-bot")
@click.option("--root", required=True, type=click.Path(exists=True, file_okay=False, path_type=Path, resolve_path=True))
@click.option("--bot", required=True)
@click.option("--env-file", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--node", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path, resolve_path=True))
@click.option("--mode", required=True, type=click.Choice(["service", "foreground-maintenance"]))
def launch(root, bot, env_file, node, mode):
    """Run exactly one named bot; stop its service before foreground maintenance."""
    run_bot(root, bot=bot, env_file=env_file, node=node, mode=mode)


@main.command("install-services")
@click.option("--root", required=True, type=click.Path(file_okay=False, path_type=Path))
@click.option("--env-file", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--node", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--replace", is_flag=True, help="Replace existing regular unit files with this release's definitions. Stop services first.")
def services(root, env_file, node, replace):
    """Install user service units, never start or restart them."""
    install_services(root, env_file=env_file, node=node, replace=replace)


@main.command("run-component")
@click.option("--component", required=True, type=click.Choice(["memory", "artifacts", "speech"]))
@click.option("--env-file", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path))
def component(component, env_file):
    """Run an installed application server with its private environment."""
    command = {"memory": "battuta-memory", "artifacts": "battuta-artifact", "speech": "battuta-speech"}[component]
    executable = shutil.which(command)
    if not executable:
        raise click.ClickException(f"Install {command} from the matching release wheel first")
    env = {**os.environ, **read_env(env_file)}
    env = {key: value for key, value in env.items() if "TELEGRAM" not in key}
    os.umask(0o077)
    os.execve(executable, [executable] if component == "speech" else [executable, "serve"], env)


if __name__ == "__main__":
    main()
