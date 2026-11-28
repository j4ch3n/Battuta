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
from .files import HiddenPathError, SourceResponse, allowed_link_root, open_source
from .events import CatalogEvents
from .markdown import render_markdown
from .palette import project_colour
from .registry import ArtifactError, Registry


def catalog_timestamp(value) -> float:
    """Missing or invalid dates sort after dated work, consistently in UTC."""
    try:
        date = datetime.fromisoformat(value)
        return date.replace(tzinfo=date.tzinfo or timezone.utc).timestamp()
    except (TypeError, ValueError, OverflowError):
        return float("-inf")


def catalog_date(value) -> str:
    """Use a stable UTC calendar date, including before JavaScript is available."""
    stamp = catalog_timestamp(value)
    if stamp == float("-inf"):
        return "Date unavailable"
    date = datetime.fromtimestamp(stamp, timezone.utc)
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    return f"{date.day} {months[date.month - 1]} {date.year}"


def catalog_project(row: dict) -> str | None:
    if row.get("project"):
        return row["project"]
    # Older registrations have no project metadata but point into a project-owned
    # workspace. Derive only its label, never publish the private source path.
    try:
        relative = Path(row["source_root"]).relative_to(Path.home() / ".battuta/projects")
        if len(relative.parts) > 1:
            return relative.parts[0]
    except ValueError:
        pass
    return None


def catalog_groups(artifacts: list[dict]) -> list[dict]:
    groups = {}
    for artifact in artifacts:
        key = artifact["project"] or ""
        groups.setdefault(key, {"key": key, "name": key or "Unassigned", "artifacts": []})["artifacts"].append(artifact)
    for group in groups.values():
        group["artifacts"].sort(key=lambda item: (-catalog_timestamp(item["updated_at"]), item["slug"]))
    return sorted(groups.values(), key=lambda group: (group["name"].lower(), group["key"]))


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
        rows = [{**{key: row[key] for key in ("slug", "title", "description", "format", "revision", "updated_at")},
                 "project": catalog_project(row),
                 "url": f"/artifacts/a/{row['slug']}/"} for row in registry.list(published_only=True)]
        return [{**row, "colour": project_colour(row["project"])} for row in rows]

    @app.get("/artifacts/")
    def index():
        artifacts = catalog()
        return HTMLResponse(templates.get_template("index.html").render(artifacts=artifacts, groups=catalog_groups(artifacts)),
                            headers={"Cache-Control": "no-store"})

    @app.get("/artifacts/catalog")
    def catalog_json():
        return JSONResponse({"artifacts": catalog()}, headers={"Cache-Control": "no-store"})

    @app.get("/artifacts/catalog.js")
    def catalog_script():
        return FileResponse(Path(__file__).parent / "assets/catalog.js", media_type="text/javascript",
                             headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    def stylesheet(name: str):
        return FileResponse(Path(__file__).parent / "assets" / name, media_type="text/css",
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/artifacts/catalog.css")
    def catalog_styles():
        return stylesheet("catalog.css")

    @app.get("/artifacts/theme.css")
    def theme_styles():
        return stylesheet("theme.css")

    @app.get("/artifacts/fonts/{font_name}")
    def catalog_font(font_name: str):
        if font_name != "gabarito-latin.woff2":
            raise HTTPException(404, "Font not found")
        return FileResponse(Path(__file__).parent / "assets/fonts" / font_name, media_type="font/woff2",
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/artifacts/events")
    async def catalog_events():
        return EventSourceResponse(events.stream(), ping=15, send_timeout=30, headers={"Cache-Control": "no-store"})

    def error_page(heading: str, message: str):
        return HTMLResponse(templates.get_template("error.html").render(heading=heading, message=message),
                            status_code=404, headers={"Cache-Control": "no-store"})

    def not_found():
        return error_page("Nothing here to read",
                          "This link doesn't point to a published work. It may be mistyped, or the work may have "
                          "been withdrawn.")

    @app.exception_handler(404)
    async def unmatched(request, error):
        # Unknown routes and rejected fonts get the same page as unknown works.
        return not_found()

    def hidden():
        return error_page("Hidden files stay hidden",
                          "Files whose names start with a dot are never shared from an artifact.")

    @app.get("/artifacts/a/{slug}/")
    @app.get("/artifacts/a/{slug}/{path:path}")
    def artifact(slug: str, path: str = ""):
        if any(part.startswith(".") for part in path.split("/")):
            return hidden()
        try:
            item = registry.get(slug)
            if item["status"] != "published":
                return not_found()
            selected = path or item["entry_path"]
            if selected not in item["files"]:
                return not_found()
            if not path and "/" in selected:
                return RedirectResponse(f"/artifacts/a/{slug}/{quote(selected)}", headers={"Cache-Control": "no-store"})
            source = open_source(item["source_root"], selected, link_root=allowed_link_root(item["project"]))
            if Path(selected).suffix.lower() in (".md", ".markdown"):
                with source:
                    try:
                        rendered, headings = render_markdown(source.read())
                    except UnicodeDecodeError as exc:
                        raise HTTPException(422, "Markdown must use UTF-8 encoding") from exc
                project = catalog_project(item)
                page = templates.get_template("markdown.html").render(
                    title=item["title"], description=item["description"], updated_at=item["updated_at"],
                    project=project, colour=project_colour(project), content=rendered,
                    headings=headings if len(headings) >= 3 else [])
                return HTMLResponse(page,
                                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
            return SourceResponse(source, item["files"][selected])
        except HiddenPathError:
            return hidden()
        except (ArtifactError, OSError):
            return not_found()

    return app
