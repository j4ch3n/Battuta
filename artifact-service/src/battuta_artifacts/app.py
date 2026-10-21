"""Read-only HTTP surface. Startup checks the schema but never migrates it."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from jinja2 import Environment, PackageLoader, select_autoescape
from starlette.concurrency import run_in_threadpool
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse
from starlette.responses import FileResponse
from sse_starlette import EventSourceResponse

from .config import database_path
from .files import SourceResponse, open_source
from .events import CatalogEvents
from .markdown import render_markdown
from .registry import ArtifactError, Registry


def catalog_date(value: str) -> str:
    """Use a stable UTC calendar date, including before JavaScript is available."""
    if not value:
        return ""
    date = datetime.fromisoformat(value).astimezone(timezone.utc)
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    return f"{date.day} {months[date.month - 1]} {date.year}"


def create_app(path: Path | None = None) -> FastAPI:
    registry = Registry(path if path is not None else database_path())
    templates = Environment(loader=PackageLoader("battuta_artifacts", "templates"), autoescape=select_autoescape())
    templates.filters["catalog_date"] = catalog_date
    events = CatalogEvents(registry.path)

    @asynccontextmanager
    async def lifespan(app):
        await run_in_threadpool(registry.check_schema)
        await events.start()
        try:
            yield
        finally:
            await events.stop()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def catalog():
        return [{**{key: row[key] for key in ("slug", "title", "description", "format", "revision", "updated_at")},
                 "url": f"/artifacts/a/{row['slug']}/"} for row in registry.list()]

    @app.get("/artifacts/")
    def index():
        return HTMLResponse(templates.get_template("index.html").render(artifacts=catalog()),
                            headers={"Cache-Control": "no-store"})

    @app.get("/artifacts/catalog")
    def catalog_json():
        return JSONResponse({"artifacts": catalog()}, headers={"Cache-Control": "no-store"})

    @app.get("/artifacts/catalog.js")
    def catalog_script():
        return FileResponse(Path(__file__).parent / "assets/catalog.js", media_type="text/javascript",
                             headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/artifacts/catalog.css")
    def catalog_styles():
        return FileResponse(Path(__file__).parent / "assets/catalog.css", media_type="text/css",
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/artifacts/fonts/public-sans-latin.woff2")
    def catalog_font():
        return FileResponse(Path(__file__).parent / "assets/fonts/public-sans-latin.woff2", media_type="font/woff2",
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/artifacts/events")
    async def catalog_events():
        return EventSourceResponse(events.stream(), ping=15, send_timeout=30, headers={"Cache-Control": "no-store"})

    @app.get("/artifacts/a/{slug}/")
    @app.get("/artifacts/a/{slug}/{path:path}")
    def artifact(slug: str, path: str = ""):
        try:
            item = registry.get(slug)
            selected = path or item["entry_path"]
            if selected not in item["files"]:
                raise HTTPException(404, "Artifact resource not found")
            if not path and "/" in selected:
                return RedirectResponse(f"/artifacts/a/{slug}/{quote(selected)}", headers={"Cache-Control": "no-store"})
            source = open_source(item["source_root"], selected)
            if Path(selected).suffix.lower() in (".md", ".markdown"):
                with source:
                    try:
                        rendered = render_markdown(source.read())
                    except UnicodeDecodeError as exc:
                        raise HTTPException(422, "Markdown must use UTF-8 encoding") from exc
                return HTMLResponse(templates.get_template("markdown.html").render(title=item["title"], content=rendered),
                                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
            return SourceResponse(source, item["files"][selected])
        except (ArtifactError, OSError) as exc:
            raise HTTPException(404, "Artifact resource not found") from exc

    return app
