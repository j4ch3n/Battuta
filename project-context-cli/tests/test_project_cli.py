"""CLI argument contracts and explicit-project workflows."""

from click.testing import CliRunner
import os
import shlex
from unittest.mock import patch

import yaml

from battuta_project.cli import main
from project_fixtures import ProjectTestCase
from linear_fixtures import CREATED_PROJECT, PROJECT, linear_http, payload


class CliTests(ProjectTestCase):
    def setUp(self):
        super().setUp()
        self.runner = CliRunner()
        token = patch.dict(os.environ, {"LINEAR_API_TOKEN": "test-token"})
        token.start()
        self.addCleanup(token.stop)

    def invoke(self, *args):
        result = self.runner.invoke(main, args)
        self.assertEqual(result.exit_code, 0, result.output)
        return result.output

    def test_remove_rejects_unsafe_or_unknown_project_before_artifact_access(self):
        for name in ("../other", "missing"):
            with self.subTest(name=name), patch("battuta_project.registry.subprocess.run") as run:
                result = self.runner.invoke(main, ["remove", name])
                self.assertNotEqual(result.exit_code, 0)
                run.assert_not_called()
                self.assertTrue(self.project.root.exists())

    def test_init_reports_explicit_next_command_without_selection(self):
        output = self.invoke("init", "harbor-web", "--github", "https://github.com/team/harbor-web")
        self.assertIn("Initialized project: harbor-web", output)
        self.assertIn("~/.battuta/projects/harbor-web/code", output)
        self.assertNotIn("Current project:", output)
        self.assertIn("Summary: ~/.battuta/projects/harbor-web/SUMMARY.md", output)
        self.assertNotIn("Specs Root:", output)
        self.assertNotIn("Constitution:", output)
        self.assertNotIn("Memory:", output)

    def test_init_suggests_executable_command_for_exact_name(self):
        for name in ("My 项目", "owner's $(printf injected); &", "-atlas"):
            with self.subTest(name=name):
                output = self.invoke("init", "--", name)
                command = next(line.removeprefix("Next: ") for line in output.splitlines() if line.startswith("Next: "))
                arguments = shlex.split(command)
                self.assertEqual(arguments, ["battuta-project", "explain", "--", name])
                explained = self.invoke(*arguments[1:])
                self.assertIn(f".battuta/projects/{name}/code", explained)

    def test_selection_commands_are_removed(self):
        for command in ("current", "switch"):
            with self.subTest(command=command):
                result = self.runner.invoke(main, [command])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("No such command", result.output)

    def test_memory_command_is_removed_without_touching_legacy_private_content(self):
        memory = self.project.root / "MEMORY.md"
        memory.write_text("Private legacy content")
        with linear_http() as requests:
            result = self.runner.invoke(main, ["memory", "get"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No such command 'memory'", result.output)
        self.assertEqual(memory.read_text(), "Private legacy content")
        self.assertEqual(requests, [])

    def test_explain_requires_project_argument(self):
        self.file("README.md")
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", self.invoke("explain", "atlas-api"))
        result = self.runner.invoke(main, ["explain"])
        self.assertNotEqual(result.exit_code, 0)

    def test_explain_displays_only_explicit_project_summary(self):
        atlas = self.project.root / "SUMMARY.md"
        atlas.write_text("# Atlas\n\nMap imports.\n", encoding="utf-8")
        self.invoke("init", "harbor-web", "--github", "https://github.com/team/harbor-web")
        harbor = self.registry.load("harbor-web").root / "SUMMARY.md"
        harbor.write_text("# Harbor\n\nHarbor scheduling.\n", encoding="utf-8")
        for name, included, excluded in (
            ("atlas-api", "Map imports.", "Harbor scheduling."),
            ("harbor-web", "Harbor scheduling.", "Map imports."),
        ):
            with self.subTest(project=name):
                output = self.invoke("explain", name)
                self.assertIn(included, output)
                self.assertNotIn(excluded, output)
                self.assertNotIn("Specs Root:", output)

    def test_explain_prints_repository_and_unlinked_linear_without_http(self):
        with linear_http() as requests:
            output = self.invoke("explain", "atlas-api")
        self.assertIn("Repository URL: https://github.com/team/atlas-api", output)
        self.assertIn("Linear Project URL: not linked", output)
        self.assertEqual(requests, [])

    def test_explain_fetches_linked_linear_url_without_changing_local_state(self):
        self.invoke("linear", "link", "atlas-api", "project-1,team-1")
        original = (self.project.root / "project.yaml").read_text()
        with linear_http(PROJECT) as requests:
            output = self.invoke("explain", "atlas-api")
        self.assertIn("Repository URL: https://github.com/team/atlas-api", output)
        self.assertIn("Linear Project URL: https://linear.app/team/project/atlas", output)
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", output)
        self.assertEqual(len(requests), 1)
        self.assertEqual(payload(requests[0])["variables"], {"id": "project-1"})
        self.assertEqual((self.project.root / "project.yaml").read_text(), original)

    def test_explain_reports_lookup_failure_without_rendering_misleading_url(self):
        self.invoke("linear", "link", "atlas-api", "project-1,team-1")
        for response, message in (
            ({"errors": [{"message": "Not authenticated"}]}, "Not authenticated"),
            ({"data": {"project": None}}, "Linear project"),
        ):
            with self.subTest(response=response), linear_http(response):
                result = self.runner.invoke(main, ["explain", "atlas-api"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn(message, result.output)
                self.assertNotIn("Linear Project URL:", result.output)

    def test_project_arguments_reject_missing_unknown_or_unsafe_targets_before_http(self):
        for target in (None, "missing", "../atlas-api", ".hidden"):
            for command, trailing in ((["explain"], []), (["github", "link"], ["https://github.com/team/other"]),
                                      (["linear", "link"], ["project-1,team-1"]),
                                      (["linear", "create"], ["Atlas", "--team-id", "team-1"])):
                args = command + ([target] if target is not None else []) + trailing
                with self.subTest(args=args), linear_http() as requests:
                    result = self.runner.invoke(main, args)
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn("Error:", result.output)
                    self.assertEqual(requests, [])

    def test_all_invocations_require_token_before_any_side_effect(self):
        args_list = (
            (), ("--help",), ("init", "--help"), ("linear", "--help"),
            ("linear", "create", "--help"),
            ("list",), ("explain", "atlas-api"),
            ("init", "harbor-web"), ("github", "link", "atlas-api", "https://github.com/team/harbor-web"),
            ("linear", "link", "atlas-api", "project-1,team-1"),
             ("linear", "create", "atlas-api", "Atlas", "--team-id", "team-1"), ("unknown",),
        )
        original = (self.project.root / "project.yaml").read_bytes()
        for value in (None, "", " \t\n"):
            for args in args_list:
                with self.subTest(value=value, args=args), patch.dict(os.environ, {}, clear=True), linear_http() as requests:
                    if value is not None:
                        os.environ["LINEAR_API_TOKEN"] = value
                    result = self.runner.invoke(main, args)
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn("LINEAR_API_TOKEN", result.output)
                    self.assertEqual(requests, [])
                    self.assertEqual((self.project.root / "project.yaml").read_bytes(), original)
                    self.assertFalse((self.registry.root / "harbor-web").exists())

    def test_bare_invocation_help_and_local_commands_do_not_contact_linear(self):
        with linear_http() as requests:
            for args in ((), ("--help",), ("init", "--help"), ("linear", "create", "--help")):
                with self.subTest(args=args):
                    self.assertIn("Usage:", self.invoke(*args))
            self.invoke("explain", "atlas-api")
            self.invoke("linear", "link", "atlas-api", " project-1 , team-1 ")
            self.invoke("init", "harbor-web", "--github", "https://github.com/team/harbor-web",
                        "--linear", " project-2 , team-2 ")
            self.assertEqual(requests, [])
        self.assertEqual(self.registry.load("atlas-api").config.linear.project_id, "project-1")
        self.assertEqual(self.registry.load("harbor-web").config.linear.team_id, "team-2")

    def test_removed_refresh_command_is_rejected_without_http_or_state_changes(self):
        original = (self.project.root / "project.yaml").read_bytes()
        with linear_http(PROJECT) as requests:
            result = self.runner.invoke(main, ["linear", "refresh"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No such command 'refresh'", result.output)
        self.assertEqual(requests, [])
        self.assertEqual((self.project.root / "project.yaml").read_bytes(), original)

    def test_document_authoring_is_not_exposed_as_cli_commands(self):
        config = (self.project.root / "project.yaml").read_bytes()
        for name in ("spec", "decision"):
            with self.subTest(command=name), linear_http() as requests:
                result = self.runner.invoke(main, [name, "--help"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn(f"No such command '{name}'", result.output)
                self.assertEqual(requests, [])
                self.assertEqual((self.project.root / "project.yaml").read_bytes(), config)

    def test_blank_linear_options_are_rejected_before_cloning_or_http(self):
        for args in (
            ["init", "harbor-web", "--linear", " "],
            ["linear", "link", "atlas-api", " ,team-1"],
            ["linear", "link", "atlas-api", "project-1, "],
            ["linear", "create", "atlas-api", " ", "--team-id", "team-1"],
            ["linear", "create", "atlas-api", "Atlas", "--team-id", " "],
            ["linear", "create", "atlas-api", "Atlas"],
        ):
            with self.subTest(args=args), linear_http() as requests:
                result = self.runner.invoke(main, args)
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("Error:", result.output)
                self.assertFalse((self.registry.root / "harbor-web").exists())
                self.assertEqual(requests, [])

    def test_create_links_remote_project_using_explicit_team_id(self):
        with linear_http(CREATED_PROJECT) as requests:
            output = self.invoke("linear", "create", "atlas-api", "Atlas", "--team-id", "team-1")
        self.assertIn("project-1", output)
        self.assertIn("team-1", output)
        self.assertIn("https://linear.app/team/project/atlas", output)
        config = yaml.safe_load((self.project.root / "project.yaml").read_text())
        self.assertEqual(config["linear"], {"project_id": "project-1", "team_id": "team-1"})
        self.assertEqual(payload(requests[0])["variables"]["input"], {"name": "Atlas", "teamIds": ["team-1"]})
        self.assertEqual(len(requests), 1)

    def test_create_api_failure_preserves_local_link(self):
        path = self.project.root / "project.yaml"
        original = path.read_text()
        with linear_http({"errors": [{"message": "Invalid team"}]}):
            result = self.runner.invoke(main, ["linear", "create", "atlas-api", "Atlas", "--team-id", "team-1"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("Invalid team", result.output)
        self.assertEqual(path.read_text(), original)

    def test_create_requires_valid_local_project_before_http(self):
        (self.project.root / "project.yaml").write_text("invalid yaml config")
        with linear_http() as requests:
            result = self.runner.invoke(main, ["linear", "create", "atlas-api", "Atlas", "--team-id", "team-1"])
            self.assertNotEqual(result.exit_code, 0)
            self.assertIn("project.yaml", result.output)
            self.assertEqual(requests, [])

    def test_linear_create_recovery_names_exact_project(self):
        for name in ("My 项目", "owner's $(printf injected); &", "-atlas"):
            with self.subTest(name=name):
                project = self.registry.init(name)
                path = project.root / "project.yaml"
                original = path.read_text()
                with linear_http(CREATED_PROJECT) as requests, patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")):
                    result = self.runner.invoke(main, ["linear", "create", "--team-id", "team-1", "--", name, "Atlas"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("created", result.output.lower())
                self.assertIn("project-1", result.output)
                self.assertIn("https://linear.app/team/project/atlas", result.output)
                recovery = shlex.split(result.output.strip().splitlines()[-1])
                self.assertEqual(recovery, ["battuta-project", "linear", "link", "--", name, "project-1,team-1"])
                self.assertNotIn("switch", result.output)
                self.assertIn("disk full", result.output)
                self.assertEqual(path.read_text(), original)
                self.assertEqual(len(requests), 1)
                with linear_http() as recovery_requests:
                    self.invoke(*recovery[1:])
                self.assertEqual(recovery_requests, [])
                self.assertEqual(self.registry.load(name).config.linear.project_id, "project-1")

    def test_create_unreadable_local_config_reports_remote_success_and_recovery(self):
        def created(request):
            (self.project.root / "project.yaml").write_bytes(b"\xff")
            return CREATED_PROJECT

        with linear_http(created) as requests:
            result = self.runner.invoke(main, ["linear", "create", "atlas-api", "Atlas", "--team-id", "team-1"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("project.yaml", result.output)
        self.assertIn("project-1", result.output)
        self.assertIn("https://linear.app/team/project/atlas", result.output)
        self.assertIn("linear link -- atlas-api project-1,team-1", result.output)
        self.assertEqual(len(requests), 1)

    def test_name_only_init_creates_discoverable_project_without_github(self):
        with linear_http() as requests:
            output = self.invoke("init", "linth")
            self.assertIn("Initialized project: linth", output)
            self.assertIn("**linth**", self.invoke("list"))
            self.assertIn("Repository URL: no GitHub repository linked yet", self.invoke("explain", "linth"))
            self.assertEqual(requests, [])
        project = self.registry.load("linth")
        self.assertTrue(project.code.is_dir())
        self.assertEqual(list(project.code.iterdir()), [])
        self.assertIn("# Project Summary: linth", (project.root / "SUMMARY.md").read_text())
        self.assertIsNone(project.config.github.repository)

    def test_init_uses_explicit_name_with_different_repository_basename(self):
        self.invoke("init", "linth", "--github", "https://github.com/team/other.git")
        project = self.registry.load("linth")
        self.assertEqual(project.name, "linth")
        self.assertEqual(project.config.github.repository, "team/other")
        self.assertEqual(project.code.name, "code")

    def test_linear_pair_is_required_and_trimmed_for_both_commands(self):
        for args in (("init", "linth", "--linear", " project-1 , team-1 "),
                     ("linear", "link", "linth", " project-2 , team-2 ")):
            with self.subTest(args=args), linear_http() as requests:
                self.invoke(*args)
                self.assertEqual(requests, [])
        self.assertEqual(self.registry.load("linth").config.linear.project_id, "project-2")
        self.assertEqual(self.registry.load("linth").config.linear.team_id, "team-2")

    def test_malformed_linear_pairs_leave_configuration_unchanged(self):
        config = (self.project.root / "project.yaml").read_bytes()
        for value in ("", " ", "project-1", "project-1,", ",team-1", " , ",
                      "project-1,team-1,extra", "project-1,,team-1"):
            for args in (("init", "linth", "--linear", value), ("linear", "link", "atlas-api", value)):
                with self.subTest(args=args), linear_http() as requests:
                    result = self.runner.invoke(main, args)
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn("<project-id>,<team-id>", result.output)
                    self.assertEqual(requests, [])
                    self.assertEqual((self.project.root / "project.yaml").read_bytes(), config)
                    self.assertFalse((self.registry.root / "linth").exists())

    def test_github_link_preserves_workspace_summary_and_linear_metadata(self):
        self.invoke("init", "linth", "--linear", "project-1,team-1")
        project = self.registry.load("linth")
        marker = project.code / "notes.txt"
        marker.write_text("Keep my work")
        spec = project.root / "specs" / "api" / "v1" / "spec.md"
        spec.parent.mkdir(parents=True)
        spec.write_text("# Existing requirements\n")
        metadata = project.root / "specs" / ".config.json"
        metadata.write_text('{"specs": [{"name": "API", "versions": ["v1"]}]}')
        artifacts = {path: path.read_bytes() for path in (spec, metadata)}
        summary = (project.root / "SUMMARY.md").read_bytes()
        with linear_http() as requests, patch("battuta_project.registry.subprocess.run", side_effect=AssertionError("link must not run subprocesses")):
            self.assertIn("https://github.com/team/other", self.invoke("github", "link", "linth", "git@github.com:team/other.git"))
            self.assertEqual(requests, [])
        linked = self.registry.load("linth")
        self.assertEqual(linked.name, "linth")
        self.assertEqual(linked.config.github.repository, "team/other")
        self.assertEqual(linked.config.linear.project_id, "project-1")
        self.assertEqual(linked.config.linear.team_id, "team-1")
        self.assertEqual(marker.read_text(), "Keep my work")
        self.assertEqual((project.root / "SUMMARY.md").read_bytes(), summary)
        for path, original in artifacts.items():
            self.assertEqual(path.read_bytes(), original)

    def test_github_link_invalid_url_or_write_failure_preserves_configuration(self):
        path = self.project.root / "project.yaml"
        config = path.read_bytes()
        for url in ("not-a-url", "https://gitlab.com/team/repo", "https://github.com/team/repo/tree/main"):
            with self.subTest(url=url):
                result = self.runner.invoke(main, ["github", "link", "atlas-api", url])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("GitHub", result.output)
                self.assertEqual(path.read_bytes(), config)
        with patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")):
            result = self.runner.invoke(main, ["github", "link", "atlas-api", "https://github.com/team/other"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("disk full", result.output)
        self.assertEqual(path.read_bytes(), config)
