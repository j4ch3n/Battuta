"""Install real release wheels outside the checkout, using isolated uv tools."""

from email.parser import BytesParser
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from zipfile import ZipFile

from fixtures import ROOT, copy_scheduler_runtime
from skill_fixtures import skill_catalog

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

            def install_tools(candidates, expected_version):
                for package, (source, command, dependency) in PROJECTS.items():
                    args = ["uv", "tool", "install", "--managed-python", "--python", "3.12", "--no-build",
                            "--constraint", str(wheels / f"{package}-constraints.txt"), str(candidates[package])]
                    if dependency:
                        args.extend(["--with", str(candidates[dependency])])
                    run(*args)
                    installed = run(str(work / "tools" / package / "bin/python"), "-c",
                                    f"from importlib.metadata import version; print(version({package!r}))")
                    self.assertEqual(installed.stdout.strip(), expected_version)
                    run(str(work / "bin" / command), "--help")

            # Use current code with earlier distribution metadata, not legacy data fixtures.
            previous_version = "0.1.0+g0000000"
            self.assertNotEqual(previous_version, version)
            previous = {}
            env["SETUPTOOLS_SCM_PRETEND_VERSION"] = previous_version
            for package, (source, command, dependency) in PROJECTS.items():
                run("uv", "build", str(ROOT / source), "--wheel", "--out-dir", str(work / "previous-wheels"))
                previous[package], = (work / "previous-wheels").glob(f"{package.replace('-', '_')}-*.whl")
            env["SETUPTOOLS_SCM_PRETEND_VERSION"] = version
            install_tools(previous, previous_version)

            # A real incompatible wheel must fail with third-party dependencies still resolvable.
            env["SETUPTOOLS_SCM_PRETEND_VERSION"] = "0.0.0+g0000000"
            run("uv", "build", str(ROOT / "project-context-cli"), "--wheel", "--out-dir", str(work / "incompatible"))
            env["SETUPTOOLS_SCM_PRETEND_VERSION"] = version
            incompatible, = (work / "incompatible").glob("*.whl")
            failed = run("uv", "tool", "install", "--managed-python", "--python", "3.12", "--no-build",
                         "--with", str(incompatible), str(paths["battuta-artifacts"]), success=False)
            self.assertIn("battuta-project", failed.stderr)
            self.assertIn("depends on battuta-project", failed.stderr)
            self.assertIn("No solution found", failed.stderr)
            missing = work / "missing" / previous["battuta-project"].name
            failed = run("uv", "tool", "install", "--managed-python", "--python", "3.12", "--no-build",
                         "--with", str(missing), str(paths["battuta-artifacts"]), success=False)
            self.assertIn(str(missing), failed.stderr)

            python = work / "tools/battuta-artifacts/bin/python"
            project_python = work / "tools/battuta-project/bin/python"
            run(str(project_python), "-c", "from battuta_project.registry import ProjectRegistry; from battuta_project.presentation import render; r=ProjectRegistry(); r.init('release-smoke'); assert render('summary.md.j2', r.current()).startswith('# Project Summary: release-smoke')")
            database = work / ".battuta/artifacts/registry.sqlite3"
            env["BATTUTA_ARTIFACT_DB"] = str(database)
            run(str(work / "bin/battuta-artifact"), "setup")
            run(str(work / "bin/battuta-artifact"), "init", "release-smoke", "--project", "release-smoke",
                "--template", "report", "--title", "Release smoke", "--description", "Disposable install check", "--json")
            before = run(str(work / "bin/battuta-artifact"), "list", "--json").stdout
            self.assertEqual(run(str(python), "-c", "from importlib.metadata import version; print(version('battuta-artifacts'))").stdout.strip(), previous_version)
            # Replacing a tool must not replace its user's data/configuration.
            private = work / "private-bot/.pi"
            private.mkdir(parents=True)
            (private / "auth.json").write_text('{"provider":"private-sentinel"}\n')
            (private / "settings.json").write_text('{"theme":"custom"}\n')
            preserved = {path.name: path.read_bytes() for path in private.iterdir()}
            install_tools(paths, version)
            self.assertEqual(run(str(work / "bin/battuta-artifact"), "list", "--json").stdout, before)
            self.assertEqual({path.name: path.read_bytes() for path in private.iterdir()}, preserved)
            self.assertTrue(database.is_file())
            run(str(python), "-c", "from importlib.resources import files; from battuta_artifacts.bundles import load_bundle; p=files('battuta_artifacts'); assert (p/'assets/catalog.js').is_file(); assert (p/'templates/index.html').is_file(); [load_bundle(n) for n in ('report','slides','live-panel')]")
            run(str(project_python), "-c", "from battuta_project.registry import ProjectRegistry; from battuta_project.presentation import render; assert render('summary.md.j2', ProjectRegistry().current()).startswith('# Project Summary: release-smoke')")
            release = work / "release"
            if archive := os.environ.get("BATTUTA_RELEASE_ARCHIVE"):
                release.mkdir()
                run("tar", "-xzf", archive, "--strip-components=1", "-C", str(release))
                self.assertEqual((release / "python-tools-version.txt").read_text().strip(), version)
                self.assertFalse(list(release.rglob("*.whl")))
            else:
                (release / "bin").mkdir(parents=True)
                shutil.copy2(ROOT / "scripts/packaging/battuta", release / "bin/battuta")
                (release / "bin/node").symlink_to(shutil.which("node"))
                copy_scheduler_runtime(release)
                for role in ("cos", "manager"):
                    skill_catalog(release, role)
                    (release / f"bots/{role}-bot/AGENTS_dedicated.md").write_text(role)
                (release / "bots/AGENTS_shared.md").write_text("Shared")
            (release / ".env.prod").write_text(f"LINEAR_API_TOKEN=release-smoke\nSUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=release-smoke\nTELEGRAM_ALLOWED_USER_ID=123\nCOS_TELEGRAM_TOKEN=101:release-smoke\nPI_SCHEDULER_STATE_FILE={work / 'schedule.json'}\n")
            env.update(PATH=f"{work / 'bin'}:{os.environ['PATH']}", XDG_CONFIG_HOME=str(work / "config"))
            for _ in range(2):
                run("bash", str(release / "bin/battuta"), "configure")
                run("bash", str(release / "bin/battuta"), "install-services")
            if archive:
                run("bash", str(release / "bin/battuta"), "configure-worker")
            self.assertEqual(len(list((work / "config/systemd/user").glob("*.service"))), 5)
            self.assertFalse((release / "scripts/packaging").exists())
            self.assertFalse((release / "project-context-cli").exists())
            self.assertFalse((release / "memory-service").exists())
            self.assertFalse((release / "artifact-service").exists())
            if os.environ.get("BATTUTA_NATIVE_SMOKE") == "1":
                run(str(work / "tools/battuta-memory/bin/python"), "-c", "import sqlite3, sqlite_vec, onnxruntime, tokenizers; c=sqlite3.connect(':memory:'); c.enable_load_extension(True); sqlite_vec.load(c); c.enable_load_extension(False); c.close(); assert 'CPUExecutionProvider' in onnxruntime.get_available_providers()")


if __name__ == "__main__":
    unittest.main()
