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
        with tempfile.TemporaryDirectory(prefix="battuta-release-install-", dir="/tmp") as directory:
            work = Path(directory)
            env = {key: value for key, value in os.environ.items() if key not in {"VIRTUAL_ENV", "PYTHONPATH", "UV_PROJECT_ENVIRONMENT", "UV_TOOL_DIR", "UV_TOOL_BIN_DIR", "UV_PYTHON_PREFERENCE"}}
            env.update(HOME=str(work / "home"), UV_CACHE_DIR=str(work / "cache"), XDG_CONFIG_HOME=str(work / "config"), XDG_DATA_HOME=str(work / "data"), LINEAR_API_TOKEN="fixture")
            Path(env["HOME"]).mkdir()
            def run(*args, **kwargs):
                return subprocess.run(args, env=kwargs.pop("env", env), cwd=work, check=True, text=True, **kwargs)
            for manifest in (assets / "python-tools-SHA256SUMS", assets / f"battuta-{tag}-linux-arm64.tar.gz.sha256"):
                for line in manifest.read_text().splitlines():
                    digest, name = line.split()
                    self.assertEqual(Path(name).name, name)
                    self.assertEqual(hashlib.sha256((assets / name).read_bytes()).hexdigest(), digest)
            wheels = [(wheel, wheel_metadata(wheel)) for wheel in assets.glob("*.whl")]
            self.assertEqual(len(wheels), 5)
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
            root = work / "relocated-install"
            run(str(installed["battuta-packaging"][0] / "battuta-packaging"), "extract-bots", "--archive", str(assets / f"battuta-{tag}-linux-arm64.tar.gz"), "--root", str(root))
            node = shutil.which("node", path=env["PATH"])
            run(str(installed["battuta-packaging"][0] / "battuta-packaging"), "install-runtime", "--root", str(root), "--node", node)
            entries = ["bots/_shared/agent-mail/dist/index.js", "bots/_shared/project-spec/dist/index.js", "bots/_shared/memory-client/dist/index.js", "bots/_shared/memory-client/dist/dream-extension.js", "bots/cos-bot/.pi/extensions/index.js", "bots/worker/.pi/extensions/index.js"]
            code = "for (const name of " + json.dumps(entries) + ") { const m = await import(" + json.dumps(str(root) + "/") + "+name); if(typeof m.default !== 'function') throw new Error(name); }"
            run(node, "--input-type=module", "-e", code)
            env_file = work / ".env.prod"
            template = run(str(installed["battuta-bot-setup"][0] / "battuta-bot-setup"), "env-example", capture_output=True).stdout
            env_file.write_text(template + "\nWORKER_BOT_COUNT=2\nSUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=fixture\nLINEAR_API_TOKEN=fixture\nCOS_TELEGRAM_TOKEN=101:fixture\nTELEGRAM_ALLOWED_USER_ID=123\n")
            agent = Path(env["HOME"]) / ".battuta/pi-bots/cos-bot/.pi"
            agent.mkdir(parents=True)
            (agent / "settings.json").write_text('{"defaultProvider":"fixture","defaultModel":"model"}')
            run(str(installed["battuta-bot-setup"][0] / "battuta-bot-setup"), "configure-release", "--root", str(root), "--env-file", str(env_file))
            self.assertTrue((Path(env["HOME"]) / ".battuta/pi-bots/worker-2/.pi/mcp.json").is_file())
            self.assertFalse((root / "skills-hub").exists())
            # Only disposable schedule/config files: no scheduler or model is running.
            settings = json.loads((root / "bots/cos-bot/.pi/settings.json").read_text())
            dream = [path for path in settings["extensions"] if "dream-extension" in path]
            self.assertEqual(len(dream), 1)
            self.assertFalse(Path(dream[0]).is_absolute())
            self.assertTrue((root / "bots/cos-bot/.pi" / dream[0]).is_file())
            run(str(installed["battuta-memory"][1] / "bin/python"), "-c", "import sqlite3,sqlite_vec,onnxruntime,tokenizers; c=sqlite3.connect(':memory:'); c.enable_load_extension(True); sqlite_vec.load(c); c.close(); assert 'CPUExecutionProvider' in onnxruntime.get_available_providers()")


if __name__ == "__main__":
    unittest.main()
