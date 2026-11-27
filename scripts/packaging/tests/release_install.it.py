"""Opt-in actual artifact installation; never start bots or invoke models."""

from email import message_from_bytes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile


COMMANDS = {
    "battuta-project": "battuta-project",
    "battuta-artifacts": "battuta-artifact",
    "battuta-memory": "battuta-memory",
    "battuta-speech": "battuta-speech",
    "battuta-doc": "battuta-doc",
    "battuta-bot-setup": "battuta-bot-setup",
    "battuta-packaging": "battuta-packaging",
}


def tool_environment(env, work, name):
    return {
        **env,
        "UV_TOOL_DIR": str(work / "tools" / name),
        "UV_TOOL_BIN_DIR": str(work / "bin" / name),
    }


def wheel_metadata(wheel):
    with zipfile.ZipFile(wheel) as archive:
        return message_from_bytes(archive.read(next(name for name in archive.namelist() if name.endswith("/METADATA"))))


@unittest.skipUnless(os.environ.get("BATTUTA_RELEASE_ASSETS"), "Release artifact installation is opt-in")
class ReleaseInstallation(unittest.TestCase):
    def test_verified_artifacts_install_without_source_or_constraints(self):
        assets = Path(os.environ["BATTUTA_RELEASE_ASSETS"]).resolve()
        tag = os.environ["BATTUTA_RELEASE_TAG"]
        platform = os.environ["BATTUTA_RELEASE_PLATFORM"]
        archive = f"battuta-{tag}-{platform}-arm64.tar.gz"
        influencer = platform == "raspberry-pi"
        with tempfile.TemporaryDirectory(prefix="battuta-release-install-", dir="/tmp") as directory:
            work = Path(directory)
            env = {key: value for key, value in os.environ.items() if key not in {"VIRTUAL_ENV", "PYTHONPATH", "UV_PROJECT_ENVIRONMENT", "UV_TOOL_DIR", "UV_TOOL_BIN_DIR", "UV_PYTHON_PREFERENCE"}}
            # A provided cache only reuses downloads; tool environments stay fresh under the work directory.
            env.update(HOME=str(work / "home"), UV_CACHE_DIR=os.environ.get("UV_CACHE_DIR", str(work / "cache")), XDG_CONFIG_HOME=str(work / "config"), XDG_DATA_HOME=str(work / "data"), LINEAR_API_TOKEN="fixture")
            Path(env["HOME"]).mkdir()
            # Third-party CLIs are stubbed: the clean image does not ship them and the check must not touch real accounts.
            stubs = work / "stubs"
            stubs.mkdir()
            claude_log = work / "claude-calls.log"
            claude = stubs / "claude"
            claude.write_text(f'#!/bin/sh\necho "$@" >> "{claude_log}"\n[ "$1 $2" = "mcp get" ] && exit 1\nexit 0\n')
            claude.chmod(0o755)
            gh = stubs / "gh"
            gh.write_text("#!/bin/sh\nexit 0\n")
            gh.chmod(0o755)
            # No systemd in the image: report no existing units and never start one.
            systemctl = stubs / "systemctl"
            systemctl.write_text("#!/bin/sh\nexit 0\n")
            systemctl.chmod(0o755)
            env["PATH"] = f"{stubs}{os.pathsep}{env['PATH']}"
            def run(*args, **kwargs):
                return subprocess.run(args, env=kwargs.pop("env", env), cwd=work, check=True, text=True, **kwargs)
            for manifest in (assets / "python-tools-SHA256SUMS", assets / f"{archive}.sha256"):
                for line in manifest.read_text().splitlines():
                    digest, name = line.split()
                    self.assertEqual(Path(name).name, name)
                    self.assertEqual(hashlib.sha256((assets / name).read_bytes()).hexdigest(), digest)
            # Dependency wheels are digest-pinned in tool metadata and installed through it.
            wheels = [(wheel, wheel_metadata(wheel)) for wheel in assets.glob("battuta_*.whl")]
            self.assertEqual({metadata["Name"] for _, metadata in wheels}, set(COMMANDS))
            self.assertFalse(list(assets.glob("*-constraints.txt")))
            installed = {}
            for wheel, metadata in wheels:
                name = metadata["Name"]
                tool_env = tool_environment(env, work, name)
                run("uv", "tool", "install", "--managed-python", "--python", "3.12", "--no-build", str(wheel), env=tool_env)
                tools = Path(tool_env["UV_TOOL_BIN_DIR"])
                environment = Path(tool_env["UV_TOOL_DIR"]) / name
                run(str(tools / COMMANDS[name]), "--help", capture_output=True, env=tool_env)
                installed[name] = (tools, environment)
            # Parse requirements with the installed packaging tool, not a checkout import.
            check = '''import json,sys
from packaging.requirements import Requirement
data=json.load(sys.stdin)
for value in data['requires']:
 r=Requirement(value)
 if r.marker and not r.marker.evaluate(): continue
 name=r.name.lower().replace('_','-')
 assert name in data['versions'], name
 if not r.url: assert data['versions'][name] in r.specifier, name
'''
            for _, metadata in wheels:
                python = installed[metadata["Name"]][1] / "bin/python"
                versions = run(str(python), "-c", "import importlib.metadata as m,json; print(json.dumps({d.metadata['Name'].lower().replace('_','-'):d.version for d in m.distributions()}))", capture_output=True).stdout
                payload = json.dumps({"requires": metadata.get_all("Requires-Dist", []), "versions": json.loads(versions)})
                run(str(installed["battuta-packaging"][1] / "bin/python"), "-c", check, input=payload)
            root = work / "battuta/latest"
            packaging = str(installed["battuta-packaging"][0] / "battuta-packaging")
            node = shutil.which("node", path=env["PATH"])
            def install_bots():
                run(packaging, "extract-bots", "--archive", str(assets / archive), "--root", str(root))
                run(packaging, "install-runtime", "--root", str(root), "--node", node)
            install_bots()
            entries = [str(path.relative_to(root)) for path in (root / "bots").glob("*/.pi/extensions/*/dist/index.js")]
            self.assertTrue(entries)
            code = "for (const name of " + json.dumps(entries) + ") { const m = await import(" + json.dumps(str(root) + "/") + "+name); if(typeof m.default !== 'function') throw new Error(name); }"
            run(node, "--input-type=module", "-e", code)
            env_file = work / ".env.prod"
            template = run(str(installed["battuta-bot-setup"][0] / "battuta-bot-setup"), "env-example", capture_output=True).stdout
            deployment = "influencer" if influencer else "main"
            services_env = tool_environment(env, work, "battuta-packaging")
            units = Path(env["XDG_CONFIG_HOME"]) / "systemd/user"
            def configure():
                run(str(installed["battuta-bot-setup"][0] / "battuta-bot-setup"), "configure-release", "--root", str(root), "--env-file", str(env_file), "--deployment", deployment)
                run(packaging, "install-services", "--root", str(root), "--env-file", str(env_file), "--node", node, "--deployment", deployment, env=services_env)
            if influencer:
                env_file.write_text(template + "\nBATTUTA_WORKER_1_TYPE=influencer\nSUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=fixture\nLINEAR_API_TOKEN=fixture\nCOS_TELEGRAM_TOKEN=101:fixture\nTELEGRAM_ALLOWED_USER_ID=123\n")
                configure()
                self.assertFalse((root / "skills-hub").exists())
            else:
                env_file.write_text(template + "\nBATTUTA_WORKER_1_TYPE=general\nBATTUTA_WORKER_2_TYPE=general\nSUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=fixture\nLINEAR_API_TOKEN=fixture\nCOS_TELEGRAM_TOKEN=101:fixture\nTELEGRAM_ALLOWED_USER_ID=123\n")
                agent = Path(env["HOME"]) / ".battuta/pi-bots/cos-bot/.pi"
                agent.mkdir(parents=True)
                (agent / "settings.json").write_text("{}")
                configure()
                self.assertIn("mcp add-json --scope user battuta-doc", claude_log.read_text())
                self.assertTrue((Path(env["HOME"]) / ".battuta/pi-bots/worker-2/.pi/mcp.json").is_file())
                self.assertFalse((root / "skills-hub").exists())
                # Only disposable schedule/config files: no scheduler or model is running.
                settings = json.loads((root / "bots/cos-bot/.pi/settings.json").read_text())
                self.assertNotIn("extensions", settings)
                self.assertTrue((root / "bots/cos-bot/.pi/extensions/dream/dist/index.js").is_file())
                run(str(installed["battuta-memory"][1] / "bin/python"), "-c", "import sqlite3, onnxruntime, tokenizers, jieba; c=sqlite3.connect(':memory:'); c.execute('create virtual table t using fts5(x)'); c.close(); assert 'CPUExecutionProvider' in onnxruntime.get_available_providers()")
            self.assertIn(f"WorkingDirectory={root}/bots/worker\n", (units / "battuta-worker@.service").read_text())
            # Upgrade: rename latest to its tag and reinstall at the same path, so units and private state carry over.
            private = {path: path.read_bytes() for path in (Path(env["HOME"]) / ".battuta/pi-bots").rglob("*.json")}
            service_files = {path: path.read_text() for path in units.iterdir()}
            previous = root.parent / json.loads((root / "bots/release.json").read_text())["tag"]
            root.rename(previous)
            install_bots()
            configure()
            self.assertTrue((previous / "bots/release.json").is_file())
            self.assertEqual({path: path.read_text() for path in units.iterdir()}, service_files)
            self.assertEqual({path: path.read_bytes() for path in private}, private)


if __name__ == "__main__":
    unittest.main()
