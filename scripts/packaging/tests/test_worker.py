"""Installed worker entry points retain shared catalog selections after relocation."""
import json
import os
from pathlib import Path
import shutil
import subprocess

from fixtures import ConfigFixture, ROOT, installed_tools


class WorkerReleaseTests(ConfigFixture):
    def test_configure_and_launch_private_worker_in_relocated_release(self):
        release = self.root / "release"
        (release / "bin").mkdir(parents=True)
        shutil.copy2(ROOT / "scripts/packaging/battuta", release / "bin/battuta")
        scripts = release / "scripts/bot_setup"
        scripts.mkdir(parents=True)
        shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
        installed_tools(release)
        (release / "bots/worker").mkdir(parents=True)
        (release / "bots/AGENTS_shared.md").write_text("shared fixture")
        (release / "bots/worker/AGENTS_dedicated.md").write_text("worker fixture")
        (release / "bots/worker/skills.json").write_text('{"skills":["execute-assignment"]}')
        (release / "bots/worker/.pi").mkdir()
        (release / "bots/worker/.pi/web-search.json").write_text('{"fetchContent":{"userAgent":"fixture mobile browser"}}')
        skill = release / "skills-hub/execute-assignment"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("execution fixture")
        runtime = release / "bots/worker/extension/assignment-worker"
        for name in ("mcp", "codemode"):
            extension = runtime / f"node_modules/@earendil-works/pi-coding-agent/dist/extensions/{name}/index.js"
            extension.parent.mkdir(parents=True, exist_ok=True)
            extension.write_text("fixture")
        (runtime / "index.ts").write_text("fixture")
        cli = runtime / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
        cli.parent.mkdir(parents=True)
        cli.write_text("fixture")
        (release / ".env.prod").write_text("SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n")
        moved = self.root / "relocated"
        release.rename(moved)
        bot = moved / "instances/worker-1"
        self.executable("pnpm", f"from pathlib import Path\nPath({str(self.root / 'unexpected-install')!r}).write_text('called')\n")
        self.executable("node", "import sys,json\nprint(json.dumps(sys.argv[1:]))\n")
        env = {**os.environ, "PATH":f"{self.bin}:{os.environ['PATH']}"}
        prepared = subprocess.run(["bash", str(moved / "bin/battuta"), "configure-worker"], env=env, text=True, capture_output=True)
        self.assertEqual(prepared.returncode, 0, prepared.stderr)
        for _ in range(2):
            configured = subprocess.run(["bash", str(moved / "bin/battuta"), "configure-worker", "--bot-dir", str(bot)], env=env, text=True, capture_output=True)
            self.assertEqual(configured.returncode, 0, configured.stderr)
        settings = json.loads((bot / ".pi/settings.json").read_text())
        self.assertFalse((self.root / "unexpected-install").exists(), "A staged release must not reinstall shared runtime dependencies")
        self.assertFalse((bot / ".pi/skills").exists())
        self.assertTrue(any((bot / ".pi" / value / "SKILL.md").is_file() for value in settings["skills"]))
        (bot / ".pi/web-search.json").unlink()
        launch = subprocess.run(["bash", str(moved / "bin/battuta"), "worker", "--bot-dir", str(bot)], env=env, text=True, capture_output=True)
        self.assertEqual(launch.returncode, 0, launch.stderr)
        self.assertEqual(json.loads(launch.stdout), [str(moved / "bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js")])
        self.assertEqual(json.loads((bot / ".pi/web-search.json").read_text()), {"fetchContent": {"userAgent": "fixture mobile browser"}})
        self.assertNotIn("private-sentinel", configured.stdout + configured.stderr + launch.stdout + launch.stderr)
