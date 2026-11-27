import json
import subprocess
import sys

import pytest
from agent_memory.core import reconcile, sessions
from agent_memory.core.config import Config
from agent_memory.core.toolkit import WriteToolkit
from battuta_memory.archive import ingest

pytestmark = pytest.mark.integration


def test_toolkit_session_serves_battuta_rules(store, tmp_path):
    config = Config.load(store.root)
    config.index.vector_enabled = False
    config.save(store.root)
    line = json.dumps({"entry_id": "a", "conversation_id": "c1", "speaker": "owner", "text": "MockTest's client is Acme Ltd",
                       "timestamp": "2026-11-26T09:00:00+00:00"})
    ingest(store, (line + "\n").encode())
    sheet = reconcile.build(store, "cos-2026-11-26", sessions.read(store.layout, "cos-2026-11-26"))
    seed = tmp_path / "seed"
    seed.mkdir()
    WriteToolkit(store, sheet).save_seed(seed)
    requests = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
                {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "submit_operations", "arguments": {"operations": [
                    {"op": "new", "type": "overview", "fields": {"project": "mocktest", "subject": "x"}, "abstract": "digest", "body": "b"}]}}}]
    completed = subprocess.run([sys.executable, "-m", "battuta_memory.toolkit_write", str(seed)], input="\n".join(map(json.dumps, requests)) + "\n",
                               capture_output=True, text=True, timeout=60, check=True)
    replies = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
    result = replies[-1]["result"]
    assert result["isError"]
    assert "overview" in result["content"][0]["text"]
