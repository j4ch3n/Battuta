"""Developer runners route real child commands without touching the checkout."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[4]


class Runners:
    """Copies a grouped runner into a disposable tree whose `pnpm` and `deno` only log their calls."""

    def __init__(self, root):
        self.root = root
        self.bin = root / "bin"
        self.bin.mkdir()
        self.log = root / "calls.jsonl"
        for name in ("pnpm", "deno"):
            executable = self.bin / name
            executable.write_text(f"#!{sys.executable}\n" + '''import json, os, sys
with open(os.environ["CALLS"], "a") as output:
    output.write(json.dumps([os.path.basename(sys.argv[0]), os.getcwd(), sys.argv[1:]]) + "\\n")
sys.exit(int(os.environ.get("FAIL_CHILD", "0")))
''')
            executable.chmod(0o700)
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "CALLS": str(self.log)}

    def run(self, name, *args, failure=0):
        source = ROOT / "scripts/checks" / name
        assert source.is_file(), f"Missing grouped runner: {source}"
        target = self.root / "scripts/checks" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        return subprocess.run(["node", str(target), *map(str, args)], cwd="/tmp", env={**self.env, "FAIL_CHILD": str(failure)}, capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]


@pytest.fixture
def runners(tmp_path):
    return Runners(tmp_path)


def test_deno_checks_use_each_function_directory_and_stop_on_failure(runners):
    for name in ("alpha", "beta", "_shared"):
        (runners.root / "supabase/functions" / name).mkdir(parents=True)
    result = runners.run("check-deno.mjs", "check")
    assert result.returncode == 0, result.stderr
    calls = runners.calls()
    assert {Path(call[1]).name for call in calls} == {"alpha", "beta"}
    assert all(call[2] == ["task", "check"] for call in calls)
    runners.log.unlink()
    result = runners.run("check-deno.mjs", "check", failure=9)
    assert result.returncode == 9
    assert len(runners.calls()) == 1


def test_staged_lint_routes_node_and_deno_files(runners):
    function = runners.root / "supabase/functions/alpha"
    function.mkdir(parents=True)
    node_file = runners.root / "agent-mail/index.ts"
    deno_file = function / "index.ts"
    result = runners.run("lint-staged-code.mjs", node_file, deno_file)
    assert result.returncode == 0, result.stderr
    calls = runners.calls()
    assert calls[0][0:2] == ["pnpm", str(runners.root)]
    assert str(node_file) in calls[0][2]
    assert calls[1] == ["deno", str(function), ["lint", str(deno_file)]]


def select_for(runners, changed):
    (runners.root / "supabase/functions/alpha").mkdir(parents=True)
    git = runners.bin / "git"
    git.write_text(f"#!{sys.executable}\nimport os, sys\nsys.stdout.write(os.environ['CHANGED_FILE'] + chr(0))\n")
    git.chmod(0o700)
    runners.env["CHANGED_FILE"] = changed
    result = runners.run("select-checks.mjs", "base", "head")
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.parametrize("project", ["memory-service", "speech-service", "artifact-service", "project-context-cli", "doc-service"])
def test_changed_python_project_selects_its_suite(runners, project):
    assert project in select_for(runners, f"{project}/src/module.py")["python"]


@pytest.mark.parametrize("changed", ["skills-hub/project-management/SKILL.md", "skills-hub/execute-assignment/SKILL.md", "bots/worker/bot.toml"],
                         ids=["project-skill", "execute-assignment-skill", "worker-manifest"])
def test_project_skill_changes_select_mail_and_worker_contract_checks(runners, changed):
    selected = select_for(runners, changed)
    assert "agent-mail" in selected["node"]
    assert "assignment-worker" in selected["node"]
