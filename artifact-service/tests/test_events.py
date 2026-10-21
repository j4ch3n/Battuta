import asyncio
import tempfile
import unittest
from pathlib import Path

from battuta_artifacts.registry import Registry, migrate


class EventTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name).resolve() / "registry.sqlite3"
        migrate(self.path)
        self.registry = Registry(self.path)

    def register(self):
        self.registry.register(slug="demo", title="Demo", description="Description", source_root="/source",
                               entry_path="index.html", format="html", files={"index.html": "text/html"})

    async def test_commits_from_other_connections_refresh_every_subscriber(self):
        from battuta_artifacts.events import CatalogEvents

        events = CatalogEvents(self.path, interval=0.01)
        await events.start()
        self.addAsyncCleanup(events.stop)
        streams = [events.stream(), events.stream()]
        for stream in streams:
            self.addAsyncCleanup(stream.aclose)
            self.assertEqual((await anext(stream))["event"], "catalog-changed")
        for change in [self.register, lambda: self.registry.update_metadata("demo", title="Changed"),
                       lambda: self.registry.deregister("demo")]:
            change()
            for stream in streams:
                event = await asyncio.wait_for(anext(stream), timeout=2)
                self.assertEqual(event, {"event": "catalog-changed", "data": "refresh"})

    async def test_slow_client_changes_coalesce_and_close_removes_subscription(self):
        from battuta_artifacts.events import CatalogEvents

        events = CatalogEvents(self.path, interval=0.01)
        await events.start()
        stream = events.stream()
        await anext(stream)
        self.register()
        await asyncio.sleep(0.04)
        self.registry.update_metadata("demo", title="Changed")
        await asyncio.sleep(0.04)
        self.assertEqual(len(events.subscribers), 1)
        self.assertEqual(next(iter(events.subscribers)).qsize(), 1)
        await stream.aclose()
        self.assertEqual(len(events.subscribers), 0)
        await events.stop()
        await events.stop()

    async def test_http_stream_sends_event_and_disconnects_cleanly(self):
        from battuta_artifacts.app import create_app

        app = create_app(self.path)
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
                self.assertIn(b"data: refresh", body)
                self.register()
                await asyncio.wait_for(received.get(), timeout=3)
            finally:
                disconnect.set()
                await asyncio.wait_for(task, timeout=2)
