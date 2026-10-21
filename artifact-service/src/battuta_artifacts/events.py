"""SQLite change detection with bounded, coalescing subscriber notifications."""

import asyncio
import logging
import sqlite3
from contextlib import suppress
from pathlib import Path

import aiosqlite


class CatalogEvents:
    def __init__(self, path: Path, *, interval: float = 1.0):
        self.path = path
        self.interval = interval
        self.subscribers: set[asyncio.Queue] = set()
        self.connection = None
        self.task = None

    async def start(self):
        self.connection = await aiosqlite.connect(self.path.absolute().as_uri() + "?mode=ro", uri=True)
        try:
            self.version = await self.data_version()
            self.task = asyncio.create_task(self.watch())
        except BaseException:
            await self.connection.close()
            self.connection = None
            raise

    async def data_version(self):
        async with self.connection.execute("PRAGMA data_version") as cursor:
            return (await cursor.fetchone())[0]

    async def watch(self):
        while True:
            await asyncio.sleep(self.interval)
            try:
                version = await self.data_version()
            except sqlite3.Error:
                logging.getLogger(__name__).exception("Cannot check artifact registry changes")
                continue
            if version != self.version:
                self.version = version
                for queue in self.subscribers:
                    if queue.empty():
                        queue.put_nowait(None)

    async def stream(self):
        queue = asyncio.Queue(maxsize=1)
        self.subscribers.add(queue)
        try:
            # Always refresh on connection/reconnection; events are hints, not a log.
            yield {"event": "catalog-changed", "data": "refresh"}
            while True:
                await queue.get()
                yield {"event": "catalog-changed", "data": "refresh"}
        finally:
            self.subscribers.discard(queue)

    async def stop(self):
        if self.task is not None:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = None
        if self.connection is not None:
            await self.connection.close()
            self.connection = None
