import asyncio

import pytest

from battuta_artifacts.app import create_app
from battuta_artifacts.events import CatalogEvents
from battuta_artifacts.registry import Registry, migrate


@pytest.fixture
def path(tmp_path):
    path = tmp_path.resolve() / "registry.sqlite3"
    migrate(path)
    return path


@pytest.fixture
def registry(path):
    return Registry(path)


def register(registry):
    registry.register(slug="demo", title="Demo", description="Description", source_root="/source",
                      entry_path="index.html", format="html", files={"index.html": "text/html"})


def test_commits_from_other_connections_refresh_every_subscriber(path, registry):
    async def scenario():
        events = CatalogEvents(path, interval=0.01)
        await events.start()
        streams = [events.stream(), events.stream()]
        try:
            for stream in streams:
                assert (await anext(stream))["event"] == "catalog-changed"
            for change in [lambda: register(registry), lambda: registry.update_metadata("demo", title="Changed"),
                           lambda: registry.deregister("demo")]:
                change()
                for stream in streams:
                    event = await asyncio.wait_for(anext(stream), timeout=2)
                    assert event == {"event": "catalog-changed", "data": "refresh"}
        finally:
            for stream in streams:
                await stream.aclose()
            await events.stop()

    asyncio.run(scenario())


def test_slow_client_changes_coalesce_and_close_removes_subscription(path, registry):
    async def scenario():
        events = CatalogEvents(path, interval=0.01)
        await events.start()
        stream = events.stream()
        try:
            await anext(stream)
            register(registry)
            await asyncio.sleep(0.04)
            registry.update_metadata("demo", title="Changed")
            await asyncio.sleep(0.04)
            assert len(events.subscribers) == 1
            assert next(iter(events.subscribers)).qsize() == 1
            await stream.aclose()
            assert len(events.subscribers) == 0
        finally:
            await stream.aclose()
            await events.stop()
        await events.stop()  # Stopping twice is safe.

    asyncio.run(scenario())


def test_http_stream_sends_event_and_disconnects_cleanly(path, registry):
    async def scenario():
        app = create_app(path)
        received = asyncio.Queue()
        disconnect = asyncio.Event()

        async def send(message):
            if message["type"] == "http.response.body" and b"event: catalog-changed" in message.get("body", b""):
                await received.put(message["body"])

        async def receive():
            await disconnect.wait()
            return {"type": "http.disconnect"}

        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                 "http_version": "1.1", "method": "GET", "scheme": "http", "path": "/artifacts/events",
                 "raw_path": b"/artifacts/events", "query_string": b"", "root_path": "", "headers": [],
                 "client": ("127.0.0.1", 1234), "server": ("127.0.0.1", 8000)}
        async with app.router.lifespan_context(app):
            task = asyncio.create_task(app(scope, receive, send))
            try:
                body = await asyncio.wait_for(received.get(), timeout=2)
                assert b"data: refresh" in body
                register(registry)
                await asyncio.wait_for(received.get(), timeout=3)
            finally:
                disconnect.set()
                await asyncio.wait_for(task, timeout=2)

    asyncio.run(scenario())
