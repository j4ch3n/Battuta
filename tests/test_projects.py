import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch
from pathlib import Path

import click

from scripts.bot_setup.skills import link_project_context
import sys

SKILL_SCRIPTS = Path(__file__).resolve().parents[1] / "bots/shared-skills/project-context/scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))
from project_context_lib import ProjectRegistry, read_memory, write_memory

# Ensure skill-local dependencies and implementation load exactly as packaged.
from project_context_lib import registry as project_registry_module



class ProjectRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "projects"

    def test_shared_skill_link_is_relative_idempotent_and_collision_safe(self):
        root = Path(self.temporary.name)
        (root / "bots/shared-skills/project-context").mkdir(parents=True)
        bot = root / "bots/pm-bot"
        bot.mkdir()
        link_project_context(bot)
        link = bot / ".pi/skills/project-context"
        self.assertEqual(link.readlink(), Path("../../../shared-skills/project-context"))
        self.assertTrue(link.resolve().is_dir())
        link_project_context(bot)
        self.assertEqual(link.readlink(), Path("../../../shared-skills/project-context"))

        other = root / "bots/tech-lead-bot"
        other.mkdir()
        skills = other / ".pi/skills"
        skills.mkdir(parents=True)
        collision = skills / "project-context"
        collision.mkdir()
        with self.assertRaises(click.ClickException):
            link_project_context(other)
        self.assertTrue(collision.is_dir())

    def test_default_registry_root_is_battuta_projects_under_home(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            home = Path(directory).resolve() / "home"
            with patch.object(project_registry_module.Path, "home", return_value=home):
                registry = ProjectRegistry()
            self.assertEqual(registry.root, home / ".battuta" / "projects")

    def test_load_lazily_creates_versioned_config_and_defaults(self):
        registry = ProjectRegistry(self.root)
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            checkout = Path(directory).resolve() / "checkout"
            config = registry.load("demo", checkout)
        self.assertEqual(config.name, "demo")
        self.assertEqual(config.path, checkout)
        self.assertEqual(config.roles.engineer, "Engineer")
        self.assertEqual(config.roles.reviewer, "Reviewer")
        self.assertIsNone(config.linear_project_id)
        self.assertIsNone(config.linear_team_id)
        self.assertIsNone(config.github_repository)
        self.assertTrue((self.root / "demo" / "project.yaml").is_file())
        self.assertFalse((self.root / "demo" / "MEMORY.md").exists())
        with self.assertRaises(click.ClickException):
            registry.load("demo", Path(self.temporary.name) / "other")

    def test_dot_only_names_cannot_create_configs_at_registry_root_or_parent(self):
        registry = ProjectRegistry(self.root)
        for name in (".", ".."):
            with self.subTest(name=name):
                with self.assertRaises(click.ClickException):
                    registry.load(name, Path(self.temporary.name) / "checkout")
                with self.assertRaises(click.ClickException):
                    registry.load(name)
        self.assertFalse((self.root / "project.yaml").exists())
        self.assertFalse((self.root.parent / "project.yaml").exists())

    def test_linux_filename_project_names(self):
        registry = ProjectRegistry(self.root)
        for name in ("my project", "project:alpha", "équipe", ".hidden", "three...dots"):
            with self.subTest(name=name):
                self.assertEqual(registry.load(name, Path(self.temporary.name)).name, name)
                self.assertEqual(registry.load(name).name, name)
        for name in ("", "a/b", "a\x00b", ".", ".."):
            with self.subTest(name=name):
                with self.assertRaises(click.ClickException):
                    registry.load(name, Path(self.temporary.name))

    def test_rejects_unsupported_version_and_fields(self):
        directory = self.root / "bad"
        directory.mkdir(parents=True)
        config_path = directory / "project.yaml"
        config_path.write_text("version: 2\n")
        with self.assertRaises(click.ClickException):
            ProjectRegistry(self.root).load("bad")

        config_path.write_text(
            "version: 1\nproject: {name: bad, path: /tmp}\n"
            "linear: {project_id: null, team_id: null}\n"
            "github: {repository: null}\n"
            "roles: {engineer: Engineer, reviewer: Reviewer}\n"
            "ticket_id: ABC-123\n"
        )
        with self.assertRaises(click.ClickException):
            ProjectRegistry(self.root).load("bad")

    def test_rejects_config_name_that_does_not_match_registry_name(self):
        directory = self.root / "registered-name"
        directory.mkdir(parents=True)
        (directory / "project.yaml").write_text(
            "version: 1\nproject: {name: different-name, path: /tmp/project}\n"
            "linear: {project_id: null, team_id: null}\n"
            "github: {repository: null}\n"
            "roles: {engineer: Engineer, reviewer: Reviewer}\n"
        )
        with self.assertRaisesRegex(click.ClickException, "does not match registry name"):
            ProjectRegistry(self.root).load("registered-name")

    def test_loads_typed_project_refs_and_custom_role_names(self):
        directory = self.root / "configured"
        directory.mkdir(parents=True)
        (directory / "project.yaml").write_text(
            "version: 1\nproject: {name: configured, path: /tmp/project}\n"
            "linear: {project_id: proj-id, team_id: team-id}\n"
            "github: {repository: owner/repo}\n"
            "roles: {engineer: Implementer, reviewer: Code Reviewer}\n"
        )
        config = ProjectRegistry(self.root).load("configured")
        self.assertEqual(config.linear_project_id, "proj-id")
        self.assertEqual(config.linear_team_id, "team-id")
        self.assertEqual(config.github_repository, "owner/repo")
        self.assertEqual(config.roles.engineer, "Implementer")
        self.assertEqual(config.roles.reviewer, "Code Reviewer")

    def test_memory_is_explicitly_read_and_written_per_project(self):
        registry = ProjectRegistry(self.root)
        project = registry.load("demo", Path(self.temporary.name))
        self.assertEqual(read_memory(project), "")
        memory_path = write_memory(project, "Decisions and durable context.\n")
        self.assertEqual(memory_path.name, "MEMORY.md")
        self.assertEqual(read_memory("demo", root=self.root), "Decisions and durable context.\n")
        self.assertFalse((self.root / "other" / "MEMORY.md").exists())

    def test_rejects_symlinked_project_directory_and_config(self):
        outside = Path(self.temporary.name) / "outside"
        outside.mkdir()
        self.root.mkdir(parents=True)
        (self.root / "linked").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(click.ClickException):
            ProjectRegistry(self.root).load("linked", Path(self.temporary.name))

        directory = self.root / "config-link"
        directory.mkdir()
        target = outside / "project.yaml"
        target.write_text("version: 1\n")
        (directory / "project.yaml").symlink_to(target)
        with self.assertRaises(click.ClickException):
            ProjectRegistry(self.root).load("config-link")

    def test_generated_yaml_quotes_arbitrary_paths_and_normalizes_path(self):
        registry = ProjectRegistry(self.root)
        checkout = Path(self.temporary.name) / "colon: # [project]"
        config = registry.load("quoted", checkout)
        self.assertEqual(config.path, checkout.resolve())
        self.assertEqual(registry.load("quoted").path, checkout.resolve())

    def test_memory_rejects_symlinks_for_read_and_write(self):
        registry = ProjectRegistry(self.root)
        project = registry.load("demo", Path(self.temporary.name))
        outside = Path(self.temporary.name) / "outside-memory"
        outside.write_text("do not read or overwrite")
        memory = project.config_path.parent / "MEMORY.md"
        memory.symlink_to(outside)
        with self.assertRaises(click.ClickException):
            read_memory(project)
        with self.assertRaises(click.ClickException):
            write_memory(project, "unsafe")
        self.assertEqual(outside.read_text(), "do not read or overwrite")

    def test_memory_rejects_config_paths_outside_registry(self):
        project = ProjectRegistry(self.root).load("demo", Path(self.temporary.name))
        outside = Path(self.temporary.name) / "outside" / "project.yaml"
        forged = replace(project, config_path=outside)
        with self.assertRaises(click.ClickException):
            read_memory(forged)
        with self.assertRaises(click.ClickException):
            write_memory(forged, "unsafe")
        self.assertFalse(outside.parent.joinpath("MEMORY.md").exists())

    def test_forged_project_name_cannot_redirect_memory_to_another_project(self):
        registry = ProjectRegistry(self.root)
        project_a = registry.load("project-a", Path(self.temporary.name) / "a")
        project_b = registry.load("project-b", Path(self.temporary.name) / "b")
        write_memory(project_b, "B stays unchanged\n")
        forged = replace(project_a, name="project-b")

        with self.assertRaises(click.ClickException):
            read_memory(forged)
        with self.assertRaises(click.ClickException):
            write_memory(forged, "redirected\n")
        self.assertEqual(read_memory(project_b), "B stays unchanged\n")
        self.assertFalse((project_a.config_path.parent / "MEMORY.md").exists())

    def test_private_config_and_memory_files_have_mode_0600(self):
        project = ProjectRegistry(self.root).load("private", Path(self.temporary.name))
        write_memory(project, "private context\n")
        for path in (project.config_path, project.config_path.parent / "MEMORY.md"):
            with self.subTest(path=path.name):
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
