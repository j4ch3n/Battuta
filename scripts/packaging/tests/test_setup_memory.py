"""Stub host and tool boundaries while exercising provisioning order/failures."""

import json
import os
import shutil
import subprocess

import pytest

from fixtures import ROOT


@pytest.mark.parametrize("failure,expected", [(None, ["native", "model", "doctor"]), ("native", ["native"]), ("model", ["native", "model"])])
def test_release_memory_setup_checks_installed_environment_before_readiness(tmp_path, failure, expected):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copy2(ROOT / "scripts/setup-memory.sh", scripts / "setup-memory.sh")
    binary = tmp_path / "bin"
    binary.mkdir()
    tool_bin = tmp_path / "tools/battuta-memory/bin"
    tool_bin.mkdir(parents=True)
    log = tmp_path / "calls.jsonl"
    for path, body in (
        (binary / "uname", '#!/bin/sh\ncase "$1" in -s) printf Linux;; -m) printf aarch64;; *) exit 99;; esac\n'),
        (binary / "getconf", '#!/bin/sh\ncase "$1" in LONG_BIT) printf 64;; GNU_LIBC_VERSION) printf "glibc 2.28";; *) exit 99;; esac\n'),
        (binary / "uv", f'#!/bin/sh\ntest "$*" = "tool dir" || exit 99\nprintf "%s" "{tmp_path}/tools"\n'),
        (tool_bin / "python", '#!/usr/bin/env python3\nimport os,json\nwith open(os.environ["CALLS"], "a") as f: f.write(json.dumps("native")+"\\n")\nraise SystemExit(7 if os.environ.get("FAIL_STAGE") == "native" else 0)\n'),
        (binary / "battuta-memory", '#!/usr/bin/env python3\nimport os,sys,json\nwith open(os.environ["CALLS"], "a") as f: f.write(json.dumps(sys.argv[1])+"\\n")\nraise SystemExit(7 if os.environ.get("FAIL_STAGE") == sys.argv[1] else 0)\n'),
    ):
        path.write_text(body)
        path.chmod(0o700)
    result = subprocess.run(["bash", str(scripts / "setup-memory.sh")],
                            env={**os.environ, "PATH": f"{binary}:{os.environ['PATH']}", "CALLS": str(log), "FAIL_STAGE": failure or ""},
                            capture_output=True, text=True)
    assert (result.returncode == 0) == (failure is None), result.stdout + result.stderr
    assert [json.loads(line) for line in log.read_text().splitlines()] == expected
    assert not (tmp_path / "memory-service").exists()
