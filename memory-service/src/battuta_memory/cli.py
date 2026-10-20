import asyncio
import json
import click
from .config import MemoryConfig
from .upstream import UpstreamAdapter


@click.group()
def main():
    """Shared local memory MCP service."""


@main.command()
@click.option("--host", default=None)
@click.option("--port", type=int, default=None)
def serve(host, port):
    import uvicorn
    from dataclasses import replace
    from .server import create_mcp_app
    config = MemoryConfig.from_env()
    config = replace(config, host=host or config.host, port=port or config.port)
    uvicorn.run(create_mcp_app(config), host=config.host, port=config.port)


@main.command()
@click.option("--json", "as_json", is_flag=True)
def doctor(as_json):
    async def check():
        adapter = await UpstreamAdapter.open(MemoryConfig.from_env())
        try:
            return await adapter.health()
        finally:
            await adapter.close()
    try:
        result = asyncio.run(check())
    except (RuntimeError, ValueError, OSError) as error:
        raise click.ClickException(str(error)) from error
    click.echo(json.dumps(result) if as_json else "Memory backend ready")


if __name__ == "__main__":
    main()
