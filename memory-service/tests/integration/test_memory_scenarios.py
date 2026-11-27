"""Bot journeys over the real MCP HTTP server, store and embedder; only Claude and the project catalog are mocked.

The production tool-use reasoner path is covered by test_toolkit_session.py.
"""
import asyncio
import json
import os
import socket
import threading
import time
from functools import partial
from unittest.mock import MagicMock, patch
from urllib.request import Request, urlopen

import pytest
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from pytest_bdd import given, parsers, scenarios, then, when

from battuta_memory import dream, server
from battuta_memory.config import MemoryConfig

pytestmark = [pytest.mark.integration,
              pytest.mark.skipif(os.environ.get("BATTUTA_MEMORY_INTEGRATION") != "1",
                                 reason="set BATTUTA_MEMORY_INTEGRATION=1 with the model provisioned")]

scenarios("features/memory.feature")

OVERVIEW = {"abstract": "MockTest project", "body": "Overview written by the dream."}


class Memory:
    def __init__(self, config, port):
        self.config, self.url, self.facts, self.uploaded = config, f"http://127.0.0.1:{port}", [], 0

    def call(self, tool, **arguments):
        async def run():
            async with streamable_http_client(f"{self.url}/mcp") as (read, write, _), ClientSession(read, write) as session:
                await session.initialize()
                return (await session.call_tool(f"memory_{tool}", arguments)).structuredContent
        payload = asyncio.run(run())
        assert payload["ok"], payload
        return payload["data"]

    def archive(self, text):
        self.uploaded += 1
        line = {"entry_id": f"e{self.uploaded}", "conversation_id": "c1", "speaker": "owner", "text": text,
                "timestamp": f"2026-11-26T09:0{self.uploaded}:00+00:00"}
        request = Request(f"{self.url}/archive", json.dumps(line).encode(), {"Content-Type": "application/x-ndjson"})
        assert json.load(urlopen(request, timeout=10))["ok"]

    def recall(self, query, project):
        types = [item["type"] for item in self.call("types")["types"]]
        return self.call("recall", projects=[project], types=types, query=query)["memories"]

    def slug(self, fact, project="mocktest"):
        return next(memory["name"] for memory in self.recall(fact, project) if memory["abstract"] == fact)


@pytest.fixture
def memory(tmp_path):
    facts = []  # ops the writer distills on the next dream
    writer = MagicMock(side_effect=lambda _prompt: "\n".join(json.dumps({"op": "new", **facts.pop(0)}) for _ in range(len(facts))))
    manager = MagicMock(return_value="")  # no review verdicts: nothing to merge or supersede
    overview = MagicMock(return_value=json.dumps(OVERVIEW))
    catalog = MagicMock(return_value=["mocktest"])
    real_run_dream = dream.run_dream
    config = MemoryConfig(data_dir=tmp_path.resolve() / "memory")
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    http = uvicorn.Server(uvicorn.Config(server.create_app(config, server.open_store_for(config)), log_level="error"))
    thread = threading.Thread(target=lambda: asyncio.run(http.serve(sockets=[sock])))
    # worker_main builds a Claude host reasoner and calls run_dream with it; swap in the role mocks, keep the real steps.
    with patch.object(server, "catalog_from_cli", catalog), patch("battuta_memory.reasoner.claude_reasoner"), \
            patch.object(dream, "run_dream", lambda store, state, **_host: real_run_dream(
                store, state, write_reasoner=writer, manage_reasoner=manager, ask=overview, catalog=catalog)):
        thread.start()
        while not http.started:
            time.sleep(0.05)
        try:
            service = Memory(config, sock.getsockname()[1])
            service.facts = facts
            yield service
        finally:
            http.should_exit = True
            thread.join(timeout=10)
            sock.close()


@given(parsers.parse('project "{project}" has no overview'))
def no_overview(memory, project):
    assert memory.call("project_overview", project=project) == {"status": "not_written"}


@given(parsers.parse('the owner told the CoS "{fact}" in project "{project}"'))
def owner_told(memory, fact, project):
    memory.archive(fact)
    memory.facts.append({"type": "entity", "fields": {"project": project, "subject": f"fact-{memory.uploaded}"}, "abstract": fact, "body": fact})


@given("the nightly dream has run")
@when("the nightly dream runs")
def nightly_dream(memory):
    assert dream.worker_main(memory.config) == 0


@when(parsers.parse('the CoS forgets "{fact}" on the owner\'s confirmation'))
def forget(memory, fact):
    memory.call("forget", entries=[{"slug": memory.slug(fact)}], reason="owner asked", owner_confirmation="yes, forget it")


@when(parsers.parse('the CoS replaces "{old}" with "{new}"'), target_fixture="replaced")
def replace(memory, old, new):
    return memory.call("forget", entries=[{"slug": memory.slug(old), "successor": memory.slug(new)}], reason="owner corrected", owner_confirmation="yes")["results"][0]


@then(parsers.parse('recalling "{query}" in project "{project}" returns "{fact}"'))
def recalled(memory, query, project, fact):
    assert fact in [item["abstract"] for item in memory.recall(query, project)]


@then(parsers.parse('recalling "{query}" in project "{project}" returns nothing'))
def recalled_nothing(memory, query, project):
    assert memory.recall(query, project) == []


@then(parsers.parse('recalling "{query}" in project "{project}" does not return "{fact}"'))
def not_recalled(memory, query, project, fact):
    assert fact not in [item["abstract"] for item in memory.recall(query, project)]


@then("the old memory is reported superseded")
def superseded(replaced):
    assert replaced["result"] == "superseded"


@then(parsers.parse('the overview of project "{project}" is the one the dream wrote'))
def overview_written(memory, project):
    assert memory.call("project_overview", project=project)["overview"]["body"] == OVERVIEW["body"]


@then("the last dream succeeded")
def dream_succeeded(memory):
    status = memory.call("dream_status")
    assert (status["status"], bool(status["last_success_at"])) == ("succeeded", True)
