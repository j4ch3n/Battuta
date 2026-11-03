"""Developer runners route real child commands without touching the checkout."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class CheckRunnerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "calls.jsonl"
        for name in ("pnpm", "deno"):
            executable = self.bin / name
            executable.write_text(f"#!{sys.executable}\n" + '''import json, os, sys
with open(os.environ["CALLS"], "a") as output:
    output.write(json.dumps([os.path.basename(sys.argv[0]), os.getcwd(), sys.argv[1:]]) + "\\n")
sys.exit(int(os.environ.get("FAIL_CHILD", "0")))
''')
            executable.chmod(0o700)
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "CALLS": str(self.log)}

    def runner(self, name, *args, failure=0):
        source = ROOT / "scripts/checks" / name
        self.assertTrue(source.is_file(), f"Missing grouped runner: {source}")
        target = self.root / "scripts/checks" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        return subprocess.run(["node", str(target), *map(str, args)], cwd="/tmp", env={**self.env, "FAIL_CHILD": str(failure)}, capture_output=True, text=True)

    def test_deno_checks_use_each_function_directory_and_stop_on_failure(self):
        for name in ("alpha", "beta", "_shared"):
            (self.root / "supabase/functions" / name).mkdir(parents=True)
        result = self.runner("check-deno.mjs", "check")
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual({Path(call[1]).name for call in calls}, {"alpha", "beta"})
        self.assertTrue(all(call[2] == ["task", "check"] for call in calls))
        self.log.unlink()
        result = self.runner("check-deno.mjs", "check", failure=9)
        self.assertEqual(result.returncode, 9)
        self.assertEqual(len(self.log.read_text().splitlines()), 1)

    def test_staged_lint_routes_node_and_deno_files(self):
        function = self.root / "supabase/functions/alpha"
        function.mkdir(parents=True)
        node_file = self.root / "agent-mail/index.ts"
        deno_file = function / "index.ts"
        result = self.runner("lint-staged-code.mjs", node_file, deno_file)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(calls[0][0:2], ["pnpm", str(self.root)])
        self.assertIn(str(node_file), calls[0][2])
        self.assertEqual(calls[1], ["deno", str(function), ["lint", str(deno_file)]])
