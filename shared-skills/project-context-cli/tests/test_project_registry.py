"""Registry contracts: fixed checkout, validated state, and failure isolation."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import click
from jinja2 import TemplateNotFound, UndefinedError
import yaml

from battuta_project.registry import ProjectRegistry
from battuta_project.memory import ProjectMemory
from battuta_project.models import LinearConfig


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "projects"
        self.registry = ProjectRegistry(self.root)
        self.clone = patch("battuta_project.registry.subprocess.run", side_effect=self.clone_repo)
        self.run = self.clone.start()
        self.addCleanup(self.clone.stop)

    @staticmethod
    def clone_repo(args, **kwargs):
        Path(args[4]).mkdir()
        return subprocess.CompletedProcess(args, 0)

    def test_init_clones_into_code_and_selects_project(self):
        project = self.registry.init("https://github.com/team/atlas-api.git")
        self.assertEqual(project.name, "atlas-api")
        self.assertEqual(project.code, self.root / "atlas-api" / "code")
        self.run.assert_called_once_with(
            ["gh", "repo", "clone", "https://github.com/team/atlas-api.git", str(project.code)],
            check=True,
        )
        self.assertEqual(json.loads((self.root / ".config.json").read_text()), {
            "currentProject": "atlas-api",
        })
        config = yaml.safe_load((self.root / "atlas-api" / "project.yaml").read_text())
        self.assertEqual(config, {
            "version": 1,
            "project": {"name": "atlas-api", "path": str(project.code)},
            "linear": {"project_id": None, "team_id": None},
            "github": {"repository": "team/atlas-api"},
        })
        self.assertEqual(self.registry.current().name, "atlas-api")

    def test_github_url_variants(self):
        for url in (
            "https://github.com/team/harbor-web", "https://github.com/team/harbor-web/",
            "git@github.com:team/harbor-web.git", "ssh://git@github.com/team/harbor-web.git",
        ):
            with self.subTest(url=url), tempfile.TemporaryDirectory() as temp:
                project = ProjectRegistry(Path(temp) / "projects").init(url)
                self.assertEqual(project.name, "harbor-web")

    def test_init_creates_summary_scaffold_beside_checkout(self):
        project = self.registry.init("https://github.com/team/atlas-api")
        summary = project.root / "SUMMARY.md"
        self.assertTrue(summary.is_file())
        content = summary.read_text(encoding="utf-8")
        self.assertIn("# Project Summary: atlas-api", content)
        for section in ("Purpose", "Users and use cases", "Scope", "Current capabilities", "Specifications"):
            self.assertIn(f"## {section}", content)
        self.assertNotIn("{{", content)
        self.assertNotIn("[replace by project name]", content)
        self.assertFalse((project.code / "SUMMARY.md").exists())
        self.assertEqual((project.root / "MEMORY.md").read_bytes(), b"")
        self.assertEqual((project.root / "specs" / "constitution.md").read_bytes(), b"")
        self.assertEqual(sorted(p.name for p in (project.root / "specs").iterdir()), ["constitution.md"])

    def test_rendering_failure_preserves_selection_and_removes_new_project(self):
        self.registry.init("https://github.com/team/atlas-api")
        for index, error in enumerate((TemplateNotFound("summary.md.j2"), UndefinedError("missing project name"))):
            with self.subTest(error=type(error).__name__):
                name = f"harbor-web-{index}"
                with patch("battuta_project.registry.render", side_effect=error):
                    with self.assertRaisesRegex(click.ClickException, "summary"):
                        self.registry.init(f"https://github.com/team/{name}")
                self.assertEqual(self.registry.current().name, "atlas-api")
                self.assertFalse((self.root / name).exists())

    def test_scaffold_write_failure_preserves_selection_and_removes_new_project(self):
        self.registry.init("https://github.com/team/atlas-api")
        from battuta_project.storage import atomic_write

        for filename in ("MEMORY.md", "constitution.md"):
            with self.subTest(filename=filename):
                name = f"harbor-{filename.removesuffix('.md').lower()}"
                def write(path, text):
                    if path.name == filename:
                        raise OSError("scaffold disk full")
                    atomic_write(path, text)

                with patch("battuta_project.registry.atomic_write", side_effect=write):
                    with self.assertRaisesRegex(click.ClickException, "scaffold disk full"):
                        self.registry.init(f"https://github.com/team/{name}")
                self.assertEqual(self.registry.current().name, "atlas-api")
                self.assertFalse((self.root / name).exists())

    def test_specs_directory_failure_preserves_selection_and_removes_new_project(self):
        self.registry.init("https://github.com/team/atlas-api")
        mkdir = Path.mkdir

        def create(path, *args, **kwargs):
            if path.name == "specs":
                raise PermissionError("cannot create specs")
            return mkdir(path, *args, **kwargs)

        with patch("pathlib.Path.mkdir", new=create):
            with self.assertRaisesRegex(click.ClickException, "cannot create specs"):
                self.registry.init("https://github.com/team/harbor-web")
        self.assertEqual(self.registry.current().name, "atlas-api")
        self.assertFalse((self.root / "harbor-web").exists())

    def test_legacy_registration_loads_without_recreating_artifacts(self):
        project = self.registry.init("https://github.com/team/atlas-api")
        for path in (project.root / "SUMMARY.md", project.root / "MEMORY.md", project.root / "specs" / "constitution.md"):
            path.unlink()
        (project.root / "specs").rmdir()
        self.assertEqual(self.registry.switch("atlas-api").code, project.code)
        self.assertEqual(sorted(p.name for p in project.root.iterdir()), ["code", "project.yaml"])

    def test_summary_creation_failure_preserves_selection_and_removes_new_project(self):
        self.registry.init("https://github.com/team/atlas-api")
        from battuta_project.storage import atomic_write

        def write(path, text):
            if path.name == "SUMMARY.md":
                raise OSError("summary disk full")
            atomic_write(path, text)

        with patch("battuta_project.registry.atomic_write", side_effect=write):
            with self.assertRaisesRegex(click.ClickException, "summary disk full"):
                self.registry.init("https://github.com/team/harbor-web")
        self.assertEqual(self.registry.current().name, "atlas-api")
        self.assertFalse((self.root / "harbor-web").exists())

    def test_init_records_optional_linear_metadata(self):
        for fields in ({}, {"project_id": "project-1"}, {"team_id": "team-1"},
                       {"project_id": "project-1", "team_id": "team-1"}):
            with self.subTest(fields=fields), tempfile.TemporaryDirectory() as temp:
                registry = ProjectRegistry(Path(temp) / "projects")
                project = registry.init("https://github.com/team/atlas-api", linear=LinearConfig(**fields))
                config = yaml.safe_load((project.root / "project.yaml").read_text())
                self.assertEqual(config["linear"], {
                    "project_id": fields.get("project_id"), "team_id": fields.get("team_id"),
                })
                self.assertEqual(json.loads(registry.state_path.read_text()), {
                    "currentProject": "atlas-api",
                })

    def test_link_updates_captured_project_and_preserves_latest_metadata(self):
        project = self.registry.init("https://github.com/team/atlas-api")
        self.registry.init("https://github.com/team/harbor-web")
        path = project.root / "project.yaml"
        config = yaml.safe_load(path.read_text())
        config["github"]["repository"] = "other/atlas-api"
        path.write_text(yaml.safe_dump(config))
        linked = self.registry.link_linear(project, LinearConfig(project_id=" project-1 ", team_id=" team-1 "))
        self.assertEqual(linked.config.linear.project_id, "project-1")
        self.assertEqual(yaml.safe_load(path.read_text())["linear"], {
            "project_id": "project-1", "team_id": "team-1",
        })
        self.assertEqual(self.registry.load("atlas-api").config.github.repository, "other/atlas-api")
        self.assertEqual(self.registry.current().name, "harbor-web")
        self.assertIsNone(self.registry.current().config.linear.project_id)
        self.registry.link_linear(project, LinearConfig(project_id="project-2", team_id="team-2"))
        self.assertEqual(self.registry.load("atlas-api").config.linear.project_id, "project-2")

    def test_failed_link_write_preserves_existing_project_configuration(self):
        project = self.registry.init("https://github.com/team/atlas-api")
        path = project.root / "project.yaml"
        original = path.read_text()
        original_files = sorted(p.name for p in project.root.iterdir())
        with patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(click.ClickException, "disk full"):
                self.registry.link_linear(project, LinearConfig(project_id="project-1", team_id="team-1"))
        self.assertEqual(path.read_text(), original)
        self.assertEqual(sorted(p.name for p in project.root.iterdir()), original_files)

    def test_invalid_urls_do_not_create_registry(self):
        for url in (
            "https://gitlab.com/team/repo", "https://github.com/team/repo/tree/main",
            "https://github.com/team/repo?token=secret", "https://github.com/team/..",
            "https://github.com/team/.hidden", "https://github.com/team/a%2Fb",
            "https://github.com/team/repo#readme", "--help", "team/repo",
        ):
            with self.subTest(url=url), self.assertRaises(click.ClickException):
                self.registry.init(url)
        self.assertFalse(self.root.exists())
        self.run.assert_not_called()

    def test_switch_matches_exact_folder_and_preserves_other_state_on_error(self):
        self.registry.init("https://github.com/team/atlas-api")
        self.registry.init("https://github.com/team/harbor-web")
        self.registry.switch("atlas-api")
        for name in ("atlas", "Atlas-api", "missing", "../atlas-api", ".config.json"):
            with self.subTest(name=name), self.assertRaises(click.ClickException):
                self.registry.switch(name)
            self.assertEqual(self.registry.current().name, "atlas-api")

    def test_collision_does_not_overwrite_existing_project(self):
        self.registry.init("https://github.com/team/atlas-api")
        marker = self.root / "atlas-api" / "code" / "work.txt"
        marker.write_text("uncommitted work")
        with self.assertRaises(click.ClickException):
            self.registry.init("https://github.com/other/atlas-api")
        self.assertEqual(marker.read_text(), "uncommitted work")
        self.assertEqual(self.run.call_count, 1)

    def test_clone_failures_remove_only_new_project_and_preserve_selection(self):
        self.registry.init("https://github.com/team/atlas-api")
        for error in (FileNotFoundError("gh"), subprocess.CalledProcessError(1, ["gh"])):
            with self.subTest(error=type(error).__name__):
                self.run.side_effect = error
                with self.assertRaises(click.ClickException):
                    self.registry.init("https://github.com/team/harbor-web")
                self.assertFalse((self.root / "harbor-web").exists())
                self.assertEqual(self.registry.current().name, "atlas-api")

    def test_missing_selection_has_actionable_error(self):
        with self.assertRaisesRegex(click.ClickException, "init|switch"):
            self.registry.current()

    def test_invalid_current_state_is_rejected_without_overwriting(self):
        self.registry.init("https://github.com/team/atlas-api")
        state = self.root / ".config.json"
        for value in ('not json', '{"currentProject": 3}', '{"currentProject": "../outside"}'):
            with self.subTest(value=value):
                state.write_text(value)
                with self.assertRaisesRegex(click.ClickException, r"\.config\.json"):
                    self.registry.current()
                self.assertEqual(state.read_text(), value)

    def test_absent_and_nullable_state_have_no_selection(self):
        self.assertIsNone(self.registry.state().current_project)
        self.assertFalse(self.root.exists())
        self.root.mkdir()
        for value in ('{}', '{"currentProject": null}'):
            with self.subTest(value=value):
                self.registry.state_path.write_text(value)
                self.assertIsNone(self.registry.state().current_project)
                with self.assertRaisesRegex(click.ClickException, "init|switch"):
                    self.registry.current()

    def test_selection_preserves_unrelated_state_and_per_project_linear_ids(self):
        atlas = LinearConfig(project_id="project-1", team_id="team-1")
        harbor = LinearConfig(project_id="project-2", team_id="team-2")
        self.registry.init("https://github.com/team/atlas-api", linear=atlas)
        self.registry.state_path.write_text(json.dumps({
            "currentProject": "atlas-api", "custom": {"keep": True},
        }))
        self.registry.init("https://github.com/team/harbor-web", linear=harbor)
        self.assertEqual(json.loads(self.registry.state_path.read_text()), {
            "currentProject": "harbor-web", "custom": {"keep": True},
        })
        self.registry.switch("atlas-api")
        self.assertEqual(json.loads(self.registry.state_path.read_text()), {
            "currentProject": "atlas-api", "custom": {"keep": True},
        })
        self.assertEqual(self.registry.load("atlas-api").config.linear, atlas)
        self.assertEqual(self.registry.load("harbor-web").config.linear, harbor)

    def test_invalid_project_config_is_rejected(self):
        self.registry.init("https://github.com/team/atlas-api")
        config = self.root / "atlas-api" / "project.yaml"
        original = yaml.safe_load(config.read_text())
        variants = [dict(original, version=2), dict(original, project={"name": "other", "path": "code"}),
                    dict(original, unexpected=True)]
        for value in variants:
            with self.subTest(value=value):
                config.write_text(yaml.safe_dump(value))
                with self.assertRaisesRegex(click.ClickException, "project.yaml"):
                    self.registry.switch("atlas-api")

    def test_checkout_path_outside_registration_is_rejected(self):
        self.registry.init("https://github.com/team/atlas-api")
        config = self.root / "atlas-api" / "project.yaml"
        data = yaml.safe_load(config.read_text())
        data["project"]["path"] = str(Path(self.temp.name) / "external")
        config.write_text(yaml.safe_dump(data))
        with self.assertRaisesRegex(click.ClickException, "relocat|code"):
            self.registry.switch("atlas-api")

    def test_symlink_state_and_project_files_cannot_redirect_access(self):
        self.registry.init("https://github.com/team/atlas-api")
        outside = Path(self.temp.name) / "outside"
        outside.write_text("preserve me")
        for file in (self.root / ".config.json", self.root / "atlas-api" / "project.yaml"):
            with self.subTest(file=file):
                content = file.read_text()
                file.unlink()
                file.symlink_to(outside)
                with self.assertRaises(click.ClickException):
                    self.registry.switch("atlas-api")
                self.assertEqual(outside.read_text(), "preserve me")
                file.unlink()
                file.write_text(content)

    def test_project_and_checkout_symlinks_are_rejected(self):
        self.registry.init("https://github.com/team/atlas-api")
        (self.root / "alias").symlink_to(self.root / "atlas-api", target_is_directory=True)
        with self.assertRaises(click.ClickException):
            self.registry.switch("alias")
        code = self.root / "atlas-api" / "code"
        code.rmdir()
        code.symlink_to(Path(self.temp.name), target_is_directory=True)
        with self.assertRaises(click.ClickException):
            self.registry.switch("atlas-api")

    def test_symlink_registry_and_owned_parent_cannot_redirect_operations(self):
        for component in ("projects", ".battuta"):
            with self.subTest(component=component), tempfile.TemporaryDirectory() as temp:
                base = Path(temp)
                registry = ProjectRegistry(base / ".battuta" / "projects")
                project = registry.init("https://github.com/team/atlas-api")
                memory = ProjectMemory(project)
                memory.append("Preserve me")
                link = registry.root if component == "projects" else registry.root.parent
                outside = base / "external"
                link.rename(outside)
                link.symlink_to(outside, target_is_directory=True)
                for action in (registry.current, lambda: registry.switch("atlas-api"),
                               lambda: registry.init("https://github.com/team/harbor-web"),
                               memory.get, lambda: memory.append("Wrong place")):
                    with self.assertRaises(click.ClickException):
                        action()
                redirected_root = outside if component == "projects" else outside / "projects"
                self.assertEqual((redirected_root / "atlas-api" / "MEMORY.md").read_text(), "Preserve me\n")
                self.assertFalse((redirected_root / "harbor-web").exists())
