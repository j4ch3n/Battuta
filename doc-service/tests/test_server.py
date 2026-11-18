import asyncio
from dataclasses import replace
import json
import socket
from types import SimpleNamespace

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
import pytest
import uvicorn

from battuta_doc.config import DocError, Settings
from battuta_doc.jobs import JobStatus
from battuta_doc.server import TOOLS, create_mcp_app, dispatch


class StubJobs:
    def __init__(self, tmp_path):
        self.tmp_path = tmp_path
        self.done = JobStatus("a" * 16, "done", result={"output_dir": "/o", "index": "/o/INDEX.md", "tree": "t",
                                                         "counts": {"pages": 1}, "warnings": []})
        self.running = JobStatus("a" * 16, "running", "layout", 1, 4, 3.0)
        self.convert_status = self.done
        self.options = None
        self.beats = 0
        self.error = None

    async def convert(self, source, options, heartbeat):
        self.options = options
        if self.error:
            raise self.error
        for _ in range(self.beats):
            await heartbeat(self.running)
        return self.convert_status

    def job(self, doc_id):
        return self.running if doc_id == "a" * 16 else (_ for _ in ()).throw(DocError("not_found", "unknown doc_id"))

    def list(self):
        return []

    def recover(self):
        pass

    def sweep(self, older_than_days=None):
        return 0

    def queue_state(self):
        return {"running": [], "queued": []}


class StubModels:
    def __init__(self, ready=True):
        self.ready = ready

    def health(self):
        return {"ready": self.ready, "state": "ready" if self.ready else "warming_up", "error": None}

    def ensure(self):
        pass


@pytest.fixture
def env(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (root / "a.pdf").write_bytes(b"x")
    settings = replace(Settings.from_env({"BATTUTA_DOC_DATA_DIR": str(tmp_path / "d"), "BATTUTA_DOC_INPUT_ROOTS": str(root)}))
    return settings, StubJobs(tmp_path), StubModels(), str(root / "a.pdf")


def call(env, name, args):
    settings, jobs, models, _ = env
    return json.loads(asyncio.run(dispatch(name, args, settings=settings, jobs=jobs, models=models))[0].text)


def test_lists_exactly_the_six_tools_and_none_has_a_wait_parameter():
    assert {t.name for t in TOOLS} == {"doc_convert", "doc_job", "doc_page_image", "doc_service_status", "doc_list", "doc_delete"}
    assert all("wait" not in t.inputSchema["properties"] for t in TOOLS)


def test_doc_convert_schema_defaults():
    props = next(t for t in TOOLS if t.name == "doc_convert").inputSchema["properties"]
    assert (props["charts"]["default"], props["ocr"]["default"], props["tables"]["default"], props["figures"]["default"]) == (
        True, "auto", "accurate", "extract")


def test_doc_convert_returns_index_and_tree_when_done(env):
    out = call(env, "doc_convert", {"source": env[3]})
    assert out["status"] == "done" and out["index"].endswith("INDEX.md") and out["tree"] == "t"
    assert env[1].options.charts is True


def test_results_carry_next_step_that_differs_by_status(env):
    done = call(env, "doc_convert", {"source": env[3]})
    env[1].convert_status = env[1].running
    running = call(env, "doc_convert", {"source": env[3]})
    assert done["next_step"] and running["next_step"] and done["next_step"] != running["next_step"]


def test_doc_job_reports_progress_and_final_payload_matches_convert(env):
    out = call(env, "doc_job", {"doc_id": "a" * 16})
    assert (out["status"], out["pages_done"], out["pages_total"]) == ("running", 1, 4) and "next_step" in out
    env[1].job = lambda doc_id: env[1].done
    assert call(env, "doc_job", {"doc_id": "a" * 16}) == call(env, "doc_convert", {"source": env[3]})


@pytest.mark.parametrize("name,args,code", [
    ("doc_convert", {"source": "/nope"}, "not_found"),
    ("doc_convert", {"source": "rel.pdf"}, "invalid_source"),
    ("doc_convert", {"source": "x", "wait": False}, "invalid_option"),
    ("doc_convert", {"source": "SRC", "ocr": "bad"}, "invalid_option"),
    ("doc_job", {"doc_id": "b" * 16}, "not_found"),
    ("doc_delete", {}, "invalid_option"),
    ("doc_delete", {"doc_id": "a", "older_than_days": 1}, "invalid_option"),
])
def test_dispatch_raises_doc_errors_with_code(env, name, args, code):
    settings, jobs, models, src = env
    args = {k: (src if v == "SRC" else v) for k, v in args.items()}
    with pytest.raises(DocError) as e:
        asyncio.run(dispatch(name, args, settings=settings, jobs=jobs, models=models))
    assert e.value.code == code


def serve(env, body):
    async def run():
        settings, jobs, models, source = env
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(create_mcp_app(settings, jobs, models), log_level="error"))
        task = asyncio.create_task(server.serve(sockets=[sock]))
        try:
            async with asyncio.timeout(15):
                while not server.started:
                    await asyncio.sleep(0.01)
                await body(f"http://127.0.0.1:{port}", port)
        finally:
            server.should_exit = True
            await asyncio.wait_for(task, 10)
            sock.close()

    asyncio.run(run())


def test_mcp_roundtrip_errors_progress_prompts_and_health(env):
    env[1].beats = 2
    seen = []

    async def body(url, port):
        async with streamablehttp_client(url + "/mcp") as (r, w, _):
            async with ClientSession(r, w) as s:
                caps = (await s.initialize()).capabilities
                assert caps.prompts is None
                assert len((await s.list_tools()).tools) == 6

                async def progress(p, total, message):
                    seen.append(message)

                ok = await s.call_tool("doc_convert", {"source": env[3]}, progress_callback=progress)
                assert json.loads(ok.content[0].text)["status"] == "done" and len(seen) == 2
                env[1].error = DocError("busy", "full", retry_after_seconds=60)
                bad = await s.call_tool("doc_convert", {"source": env[3]})
                assert bad.isError and json.loads(bad.content[0].text) == {"code": "busy", "message": "full", "retry_after_seconds": 60}
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        assert b"200" in (await reader.read())[:20]
        env[2].ready = False
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        data = await reader.read()
        assert b"503" in data[:20] and b"warming_up" in data

    serve(env, body)


def test_rejects_foreign_host_header(env):
    async def body(url, port):
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"POST /mcp HTTP/1.1\r\nHost: evil.example\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
        status_line = (await reader.read())[:20]
        assert b" 421" in status_line or b" 403" in status_line or b" 400" in status_line

    serve(env, body)
