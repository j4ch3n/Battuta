"""Build real wheels, then configure a release with an offline tooling environment."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from fixtures import ROOT, copy_scheduler_runtime
from skill_fixtures import skill_catalog


class OfflineToolingTests(unittest.TestCase):
    def test_wheels_install_and_launcher_configures_without_checkout_imports(self):
        with tempfile.TemporaryDirectory(dir="/tmp", prefix="battuta-wheels-") as directory:
            work = Path(directory).resolve()
            release = work / "release"
            wheels = release / "scripts/packaging/wheels"
            wheels.mkdir(parents=True)
            env = {**os.environ, "TMPDIR": str(Path('/tmp').resolve()), "UV_CACHE_DIR": str(work / "uv-cache"), "PIP_CACHE_DIR": str(work / "pip-cache"), "PYTHONDONTWRITEBYTECODE": "1"}
            def run(*args, **options):
                result = subprocess.run(args, cwd=work, env=env, capture_output=True, text=True, **options)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result
            for project in ("bot_setup", "packaging"):
                run("uv", "build", "--project", str(ROOT / "scripts" / project), "--wheel", "--out-dir", str(wheels))
            requirements = work / "requirements.txt"
            run("uv", "export", "--project", str(ROOT / "scripts/packaging"), "--locked", "--no-dev", "--no-emit-project", "--no-emit-package", "battuta-bot-setup", "--format", "requirements-txt", "--output-file", str(requirements))
            run(sys.executable, "-m", "pip", "download", "--require-hashes", "--no-deps", "--only-binary=:all:", "--python-version", "3.12", "--dest", str(wheels), "-r", str(requirements))
            checksums = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in sorted(wheels.glob("*.whl")))
            (wheels / "SHA256SUMS").write_text(checksums)
            (release / "bin").mkdir()
            launcher = release / "bin/battuta"
            shutil.copyfile(ROOT / "scripts/packaging/battuta", launcher)
            copy_scheduler_runtime(release)
            for role in ("pm", "tl"):
                skill_catalog(release, role)
                (release / f"bots/{role}-bot/AGENTS_dedicated.md").write_text(role)
            (release / "bots/AGENTS_shared.md").write_text("Shared")
            (release / ".env.prod").write_text(f"LINEAR_API_TOKEN=private-linear\nSUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=private-supabase\nTELEGRAM_ALLOWED_USER_ID=123\nPM_TELEGRAM_TOKEN=101:private-pm\nTL_TELEGRAM_TOKEN=102:private-tl\nPI_SCHEDULER_STATE_FILE={work / 'schedule.json'}\n")
            env.update(PYTHONPATH="", HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9", XDG_CONFIG_HOME=str(work / "config"))
            env.pop("VIRTUAL_ENV", None)
            result = run("bash", str(launcher), "configure")
            self.assertNotIn("private-linear", result.stdout + result.stderr)
            binary = release / "scripts/packaging/.venv/bin"
            for command in ("battuta-bot-setup", "battuta-packaging"):
                run(str(binary / command), "--help")
            run("bash", str(launcher), "configure")
            run("bash", str(launcher), "install-services")
            self.assertEqual(len(list((work / "config/systemd/user").glob("*.service"))), 4)
            self.assertFalse((release / "pyproject.toml").exists())
            self.assertTrue((release / "skills-hub").is_dir())
            self.assertTrue(all(not (release / f"bots/{role}-bot/.pi/skills").exists() for role in ("pm", "tl")))
            for role in ("pm", "tl"):
                config = json.loads((release / f"bots/{role}-bot/.pi/mcp.json").read_text())
                self.assertEqual("luma" in config["mcpServers"], role == "pm")
            shutil.rmtree(binary.parent)
            next(wheels.glob("battuta_packaging-*.whl")).write_bytes(b"tampered")
            failed = subprocess.run(["bash", str(launcher), "configure"], cwd=work, env=env, capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertFalse(binary.parent.exists())
            self.assertNotIn("private-linear", failed.stdout + failed.stderr)


if __name__ == "__main__":
    unittest.main()
