"""Read-only HTTP surface. Startup checks the schema but never migrates it."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from .config import database_path
from .files import SourceResponse, open_source
from .registry import ArtifactError, Registry


def create_app(path: Path | None = None) -> FastAPI:
    registry = Registry(path if path is not None else database_path())

    @asynccontextmanager
    async def lifespan(app):
        await run_in_threadpool(registry.check_schema)
        yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/artifacts/a/{slug}/")
    @app.get("/artifacts/a/{slug}/{path:path}")
    def artifact(slug: str, path: str = ""):
        try:
            item = registry.get(slug)
            selected = path or item["entry_path"]
            if selected not in item["files"]:
                raise HTTPException(404, "Artifact resource not found")
            source = open_source(item["source_root"], selected)
            return SourceResponse(source, item["files"][selected])
        except (ArtifactError, OSError) as exc:
            raise HTTPException(404, "Artifact resource not found") from exc

    return app
