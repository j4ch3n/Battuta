import json
from dataclasses import replace
from pathlib import Path

import click

from .config import MemoryConfig


@click.group()
def main():
    """Shared local memory MCP service."""


@main.command()
@click.option("--host", default=None)
@click.option("--port", type=int, default=None)
def serve(host, port):
    import uvicorn
    from .server import create_app, open_store_for
    config = MemoryConfig.from_env()
    config = replace(config, host=host or config.host, port=port or config.port)
    uvicorn.run(create_app(config, open_store_for(config)), host=config.host, port=config.port)


@main.command()
@click.option("--json", "as_json", is_flag=True)
def doctor(as_json):
    from .server import open_store_for
    config = MemoryConfig.from_env()
    try:
        store = open_store_for(config)()
    except (RuntimeError, ValueError, OSError) as error:
        raise click.ClickException(str(error)) from error
    result = {"ready": True, "store": str(store.root), "memories": len(store.records())}
    click.echo(json.dumps(result) if as_json else "Memory store ready")


@main.group()
def model():
    """Provision and verify the local embedding model."""


@model.command("install")
@click.option("--from-dir", "source_dir", type=click.Path(exists=True, file_okay=False, path_type=Path))
def model_install(source_dir):
    from .model_setup import install_model
    try:
        manifest = install_model(Path.home(), source_dir)
    except (RuntimeError, OSError) as error:
        raise click.ClickException(str(error)) from error
    click.echo(json.dumps(manifest))


@model.command("verify")
@click.option("--json", "as_json", is_flag=True)
def model_verify(as_json):
    from .model_setup import verify_model
    try:
        manifest = verify_model(Path.home())
    except RuntimeError as error:
        raise click.ClickException(str(error)) from error
    click.echo(json.dumps(manifest) if as_json else "Local model verified")


@main.group()
def dream():
    """Run the memory dream."""


@dream.command("run")
def dream_run():
    """Worker entry: distill, consolidate and refresh overviews with the host's Claude Code."""
    from .dream import worker_main
    raise SystemExit(worker_main(MemoryConfig.from_env()))


if __name__ == "__main__":
    main()
