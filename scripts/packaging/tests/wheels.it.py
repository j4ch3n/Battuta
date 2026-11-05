"""Install real release wheels outside the checkout, using isolated uv tools."""

from email.parser import BytesParser
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from zipfile import ZipFile

from fixtures import ROOT

PROJECTS = {
    "battuta-project": ("project-context-cli", "battuta-project", None),
    "battuta-artifacts": ("artifact-service", "battuta-artifact", "battuta-project"),
    "battuta-memory": ("memory-service", "battuta-memory", None),
    "battuta-bot-setup": ("scripts/bot_setup", "battuta-bot-setup", None),
    "battuta-packaging": ("scripts/packaging", "battuta-packaging", "battuta-bot-setup"),
}


class ReleasedToolsTests(unittest.TestCase):
    def test_wheels_install_without_checkout_imports(self):
        with tempfile.TemporaryDirectory(dir="/tmp", prefix="battuta-wheels-") as directory:
            work = Path(directory).resolve()
            version = os.environ.get("BATTUTA_RELEASE_VERSION", "1.2.3+gabc1234")
            wheels = Path(os.environ.get("BATTUTA_RELEASE_WHEELS", work / "wheels")).resolve()
            wheels.mkdir(exist_ok=True)
            env = {**os.environ, "HOME": str(work), "PYTHONPATH": "", "PYTHONDONTWRITEBYTECODE": "1",
                   "UV_TOOL_DIR": str(work / "tools"), "UV_TOOL_BIN_DIR": str(work / "bin"),
                   "SETUPTOOLS_SCM_PRETEND_VERSION": version, "LINEAR_API_TOKEN": "release-smoke"}
            env.pop("VIRTUAL_ENV", None)

            def run(*args, success=True):
                result = subprocess.run(args, cwd=work, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
                return result

            paths = {}
            for package, (source, command, dependency) in PROJECTS.items():
                if "BATTUTA_RELEASE_WHEELS" not in os.environ:
                    run("uv", "build", str(ROOT / source), "--wheel", "--out-dir", str(wheels))
                    run("uv", "export", "--project", str(ROOT / source), "--frozen", "--no-dev",
                        "--no-emit-project", "--no-emit-package", "battuta-project", "--no-emit-package",
                        "battuta-bot-setup", "--no-hashes", "--format", "requirements-txt",
                        "--output-file", str(wheels / f"{package}-constraints.txt"))
                path, = wheels.glob(f"{package.replace('-', '_')}-*.whl")
                with ZipFile(path) as archive:
                    metadata, = (name for name in archive.namelist() if name.endswith(".dist-info/METADATA"))
                    info = BytesParser().parsebytes(archive.read(metadata))
                    self.assertEqual(info["Name"], package)
                    self.assertEqual(info["Version"], version)
                    self.assertIn(version, path.name)
                    self.assertNotIn("file:", "\n".join(info.get_all("Requires-Dist", [])))
                paths[package] = path

            # Explicit incompatible/missing candidates must fail, not use an installed global tool.
            run("uv", "tool", "install", "--python", "3.12", "--no-index", "--no-cache",
                "--with", "battuta-project==0.0.0", str(paths["battuta-artifacts"]), success=False)
            for package, (source, command, dependency) in PROJECTS.items():
                args = ["uv", "tool", "install", "--python", "3.12", "--no-build",
                        "--constraint", str(wheels / f"{package}-constraints.txt"), str(paths[package])]
                if dependency:
                    args.extend(["--with", str(paths[dependency])])
                run(*args)
                run(str(work / "bin" / command), "--help")

            python = work / "tools/battuta-artifacts/bin/python"
            run(str(python), "-c", "from importlib.resources import files; from battuta_artifacts.bundles import load_bundle; p=files('battuta_artifacts'); assert (p/'assets/catalog.js').is_file(); assert (p/'templates/index.html').is_file(); [load_bundle(n) for n in ('report','slides','live-panel')]")
            project_python = work / "tools/battuta-project/bin/python"
            run(str(project_python), "-c", "from battuta_project.registry import ProjectRegistry; from battuta_project.presentation import render; r=ProjectRegistry(); r.init('release-smoke'); assert render('summary.md.j2', r.current()).startswith('# Project Summary: release-smoke')")
            database = work / ".battuta/artifacts/registry.sqlite3"
            env["BATTUTA_ARTIFACT_DB"] = str(database)
            run(str(work / "bin/battuta-artifact"), "setup")
            before = run(str(work / "bin/battuta-artifact"), "list", "--json").stdout
            # Replacing a tool must not replace its user's data/configuration.
            run("uv", "tool", "install", "--reinstall", "--python", "3.12", str(paths["battuta-artifacts"]),
                "--with", str(paths["battuta-project"]), "--constraint", str(wheels / "battuta-artifacts-constraints.txt"))
            self.assertEqual(run(str(work / "bin/battuta-artifact"), "list", "--json").stdout, before)
            self.assertTrue(database.is_file())
            if os.environ.get("BATTUTA_NATIVE_SMOKE") == "1":
                run(str(work / "tools/battuta-memory/bin/python"), "-c", "import sqlite3, sqlite_vec, onnxruntime, tokenizers; c=sqlite3.connect(':memory:'); c.enable_load_extension(True); sqlite_vec.load(c); c.enable_load_extension(False); c.close(); assert 'CPUExecutionProvider' in onnxruntime.get_available_providers()")


if __name__ == "__main__":
    unittest.main()
