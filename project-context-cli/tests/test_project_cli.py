"""CLI argument contracts and end-to-end current-project workflows."""

from click.testing import CliRunner
import os
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

    def test_init_and_switch_outputs_use_bundled_templates(self):
        output = self.invoke("init", "harbor-web", "--github", "https://github.com/team/harbor-web")
        self.assertIn("Initialized project: harbor-web", output)
        self.assertIn("~/.battuta/projects/harbor-web/code", output)
        self.assertIn("Current project: harbor-web", output)
        self.assertIn("Summary: ~/.battuta/projects/harbor-web/SUMMARY.md", output)
        self.assertNotIn("Specs Root:", output)
        self.assertNotIn("Constitution:", output)
        self.assertNotIn("Memory:", output)
        output = self.invoke("switch", "atlas-api")
        self.assertIn("Current project: atlas-api", output)
        self.assertIn("~/.battuta/projects/atlas-api/code", output)

    def test_memory_command_is_removed_without_touching_legacy_private_content(self):
        memory = self.project.root / "MEMORY.md"
        memory.write_text("Private legacy content")
        state = self.registry.state_path.read_bytes()
        with linear_http() as requests:
            result = self.runner.invoke(main, ["memory", "get"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No such command 'memory'", result.output)
        self.assertEqual(memory.read_text(), "Private legacy content")
        self.assertEqual(self.registry.state_path.read_bytes(), state)
        self.assertEqual(requests, [])

    def test_explain_rejects_project_argument_and_uses_current_checkout(self):
        self.file("README.md")
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", self.invoke("explain"))
        result = self.runner.invoke(main, ["explain", "atlas-api"])
        self.assertNotEqual(result.exit_code, 0)

    def test_explain_displays_selected_project_summary_after_switching(self):
        atlas = self.project.root / "SUMMARY.md"
        atlas.write_text("# Atlas\n\nMap imports.\n", encoding="utf-8")
        self.invoke("init", "harbor-web", "--github", "https://github.com/team/harbor-web")
        harbor = self.registry.current().root / "SUMMARY.md"
        harbor.write_text("# Harbor\n\nHarbor scheduling.\n", encoding="utf-8")
        for name, included, excluded in (
            ("atlas-api", "Map imports.", "Harbor scheduling."),
            ("harbor-web", "Harbor scheduling.", "Map imports."),
        ):
            with self.subTest(project=name):
                self.invoke("switch", name)
                output = self.invoke("explain")
                self.assertIn(included, output)
                self.assertNotIn(excluded, output)
                self.assertNotIn("Specs Root:", output)

    def test_explain_prints_repository_and_unlinked_linear_without_http(self):
        with linear_http() as requests:
            output = self.invoke("explain")
        self.assertIn("Repository URL: https://github.com/team/atlas-api", output)
        self.assertIn("Linear Project URL: not linked", output)
        self.assertEqual(requests, [])

    def test_explain_fetches_linked_linear_url_without_changing_local_state(self):
        self.invoke("linear", "link", "project-1,team-1")
        original = (self.project.root / "project.yaml").read_text()
        state = self.registry.state_path.read_text()
        with linear_http(PROJECT) as requests:
            output = self.invoke("explain")
        self.assertIn("Repository URL: https://github.com/team/atlas-api", output)
        self.assertIn("Linear Project URL: https://linear.app/team/project/atlas", output)
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", output)
        self.assertEqual(len(requests), 1)
        self.assertEqual(payload(requests[0])["variables"], {"id": "project-1"})
        self.assertEqual((self.project.root / "project.yaml").read_text(), original)
        self.assertEqual(self.registry.state_path.read_text(), state)

    def test_explain_reports_lookup_failure_without_rendering_misleading_url(self):
        self.invoke("linear", "link", "project-1,team-1")
        for response, message in (
            ({"errors": [{"message": "Not authenticated"}]}, "Not authenticated"),
            ({"data": {"project": None}}, "Linear project"),
        ):
            with self.subTest(response=response), linear_http(response):
                result = self.runner.invoke(main, ["explain"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn(message, result.output)
                self.assertNotIn("Linear Project URL:", result.output)

    def test_missing_current_project_reports_a_readable_error(self):
        self.registry.state_path.unlink()
        result = self.runner.invoke(main, ["explain"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("Error:", result.output)
        self.assertIn("switch", result.output)
        self.invoke("switch", "atlas-api")

    def test_all_invocations_require_token_before_any_side_effect(self):
        args_list = (
            (), ("--help",), ("init", "--help"), ("linear", "--help"),
            ("linear", "create", "--help"),
            ("switch", "atlas-api"), ("list",), ("current",), ("explain",),
            ("init", "harbor-web"), ("github", "link", "https://github.com/team/harbor-web"),
            ("linear", "link", "project-1,team-1"),
             ("linear", "create", "Atlas", "--team-id", "team-1"), ("unknown",),
        )
        original = self.registry.state_path.read_text()
        for value in (None, "", " \t\n"):
            for args in args_list:
                with self.subTest(value=value, args=args), patch.dict(os.environ, {}, clear=True), linear_http() as requests:
                    if value is not None:
                        os.environ["LINEAR_API_TOKEN"] = value
                    result = self.runner.invoke(main, args)
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn("LINEAR_API_TOKEN", result.output)
                    self.assertEqual(requests, [])
                    self.assertEqual(self.registry.state_path.read_text(), original)
                    self.assertFalse((self.registry.root / "harbor-web").exists())

    def test_bare_invocation_help_and_local_commands_do_not_contact_linear(self):
        with linear_http() as requests:
            for args in ((), ("--help",), ("init", "--help"), ("linear", "create", "--help")):
                with self.subTest(args=args):
                    self.assertIn("Usage:", self.invoke(*args))
            self.invoke("switch", "atlas-api")
            self.invoke("explain")
            self.invoke("linear", "link", " project-1 , team-1 ")
            self.invoke("init", "harbor-web", "--github", "https://github.com/team/harbor-web",
                        "--linear", " project-2 , team-2 ")
            self.assertEqual(requests, [])
        self.assertEqual(self.registry.load("atlas-api").config.linear.project_id, "project-1")
        self.assertEqual(self.registry.current().config.linear.team_id, "team-2")

    def test_removed_refresh_command_is_rejected_without_http_or_state_changes(self):
        original = self.registry.state_path.read_text()
        with linear_http(PROJECT) as requests:
            result = self.runner.invoke(main, ["linear", "refresh"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No such command 'refresh'", result.output)
        self.assertEqual(requests, [])
        self.assertEqual(self.registry.state_path.read_text(), original)

    def test_document_authoring_is_not_exposed_as_cli_commands(self):
        state = self.registry.state_path.read_bytes()
        for name in ("spec", "decision"):
            with self.subTest(command=name), linear_http() as requests:
                result = self.runner.invoke(main, [name, "--help"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn(f"No such command '{name}'", result.output)
                self.assertEqual(requests, [])
                self.assertEqual(self.registry.state_path.read_bytes(), state)

    def test_blank_linear_options_are_rejected_before_cloning_or_http(self):
        for args in (
            ["init", "harbor-web", "--linear", " "],
            ["linear", "link", " ,team-1"],
            ["linear", "link", "project-1, "],
            ["linear", "create", " ", "--team-id", "team-1"],
            ["linear", "create", "Atlas", "--team-id", " "],
            ["linear", "create", "Atlas"],
        ):
            with self.subTest(args=args), linear_http() as requests:
                result = self.runner.invoke(main, args)
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("Error:", result.output)
                self.assertFalse((self.registry.root / "harbor-web").exists())
                self.assertEqual(requests, [])

    def test_create_links_remote_project_using_explicit_team_id(self):
        with linear_http(CREATED_PROJECT) as requests:
            output = self.invoke("linear", "create", "Atlas", "--team-id", "team-1")
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
            result = self.runner.invoke(main, ["linear", "create", "Atlas", "--team-id", "team-1"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("Invalid team", result.output)
        self.assertEqual(path.read_text(), original)

    def test_create_requires_valid_local_project_before_http(self):
        for state in ("missing", "null", "invalid-project"):
            with self.subTest(state=state), linear_http() as requests:
                if state == "missing":
                    self.registry.state_path.unlink()
                elif state == "null":
                    self.registry.state_path.write_text('{"currentProject": null}')
                else:
                    self.registry.state_path.write_text('{"currentProject": "atlas-api"}')
                    (self.project.root / "project.yaml").write_text("invalid yaml config")
                result = self.runner.invoke(main, ["linear", "create", "Atlas", "--team-id", "team-1"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("Error:", result.output)
                self.assertEqual(requests, [])

    def test_create_save_failure_reports_remote_success_and_recovery(self):
        path = self.project.root / "project.yaml"
        original = path.read_text()
        with linear_http(CREATED_PROJECT) as requests, patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")):
            result = self.runner.invoke(main, ["linear", "create", "Atlas", "--team-id", "team-1"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("created", result.output.lower())
        self.assertIn("project-1", result.output)
        self.assertIn("https://linear.app/team/project/atlas", result.output)
        self.assertIn("linear link project-1,team-1", result.output)
        self.assertIn("disk full", result.output)
        self.assertEqual(path.read_text(), original)
        self.assertEqual(len(requests), 1)

    def test_create_unreadable_local_config_reports_remote_success_and_recovery(self):
        def created(request):
            (self.project.root / "project.yaml").write_bytes(b"\xff")
            return CREATED_PROJECT

        with linear_http(created) as requests:
            result = self.runner.invoke(main, ["linear", "create", "Atlas", "--team-id", "team-1"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("project.yaml", result.output)
        self.assertIn("project-1", result.output)
        self.assertIn("https://linear.app/team/project/atlas", result.output)
        self.assertIn("battuta-project switch atlas-api", result.output)
        self.assertIn("linear link project-1,team-1", result.output)
        self.assertEqual(len(requests), 1)

    def test_name_only_init_selects_discoverable_project_without_github(self):
        with linear_http() as requests:
            output = self.invoke("init", "linth")
            self.assertIn("Initialized project: linth", output)
            self.assertEqual(self.invoke("current").strip(), "Current Project: linth")
            self.assertIn("**linth**", self.invoke("list"))
            self.assertIn("Repository URL: no GitHub repository linked yet", self.invoke("explain"))
            self.assertEqual(requests, [])
        project = self.registry.current()
        self.assertTrue(project.code.is_dir())
        self.assertEqual(list(project.code.iterdir()), [])
        self.assertIn("# Project Summary: linth", (project.root / "SUMMARY.md").read_text())
        self.assertIsNone(project.config.github.repository)

    def test_init_uses_explicit_name_with_different_repository_basename(self):
        self.invoke("init", "linth", "--github", "https://github.com/team/other.git")
        project = self.registry.current()
        self.assertEqual(project.name, "linth")
        self.assertEqual(project.config.github.repository, "team/other")
        self.assertEqual(project.code.name, "code")

    def test_linear_pair_is_required_and_trimmed_for_both_commands(self):
        for args in (("init", "linth", "--linear", " project-1 , team-1 "),
                     ("linear", "link", " project-2 , team-2 ")):
            with self.subTest(args=args), linear_http() as requests:
                self.invoke(*args)
                self.assertEqual(requests, [])
        self.assertEqual(self.registry.current().config.linear.project_id, "project-2")
        self.assertEqual(self.registry.current().config.linear.team_id, "team-2")

    def test_malformed_linear_pairs_leave_configuration_and_selection_unchanged(self):
        config = (self.project.root / "project.yaml").read_bytes()
        state = self.registry.state_path.read_bytes()
        for value in ("", " ", "project-1", "project-1,", ",team-1", " , ",
                      "project-1,team-1,extra", "project-1,,team-1"):
            for args in (("init", "linth", "--linear", value), ("linear", "link", value)):
                with self.subTest(args=args), linear_http() as requests:
                    result = self.runner.invoke(main, args)
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn("<project-id>,<team-id>", result.output)
                    self.assertEqual(requests, [])
                    self.assertEqual((self.project.root / "project.yaml").read_bytes(), config)
                    self.assertEqual(self.registry.state_path.read_bytes(), state)
                    self.assertFalse((self.registry.root / "linth").exists())

    def test_github_link_preserves_workspace_summary_and_linear_metadata(self):
        self.invoke("init", "linth", "--linear", "project-1,team-1")
        project = self.registry.current()
        marker = project.code / "notes.txt"
        marker.write_text("Keep my work")
        spec = project.root / "specs" / "api" / "v1" / "spec.md"
        spec.parent.mkdir(parents=True)
        spec.write_text("# Existing requirements\n")
        metadata = project.root / "specs" / ".config.json"
        metadata.write_text('{"specs": [{"name": "API", "versions": ["v1"]}]}')
        artifacts = {path: path.read_bytes() for path in (spec, metadata)}
        summary = (project.root / "SUMMARY.md").read_bytes()
        state = self.registry.state_path.read_bytes()
        with linear_http() as requests, patch("battuta_project.registry.subprocess.run", side_effect=AssertionError("link must not run subprocesses")):
            self.assertIn("https://github.com/team/other", self.invoke("github", "link", "git@github.com:team/other.git"))
            self.assertEqual(requests, [])
        linked = self.registry.current()
        self.assertEqual(linked.name, "linth")
        self.assertEqual(linked.config.github.repository, "team/other")
        self.assertEqual(linked.config.linear.project_id, "project-1")
        self.assertEqual(linked.config.linear.team_id, "team-1")
        self.assertEqual(marker.read_text(), "Keep my work")
        self.assertEqual((project.root / "SUMMARY.md").read_bytes(), summary)
        self.assertEqual(self.registry.state_path.read_bytes(), state)
        for path, original in artifacts.items():
            self.assertEqual(path.read_bytes(), original)

    def test_github_link_invalid_url_or_write_failure_preserves_configuration(self):
        path = self.project.root / "project.yaml"
        config = path.read_bytes()
        for url in ("not-a-url", "https://gitlab.com/team/repo", "https://github.com/team/repo/tree/main"):
            with self.subTest(url=url):
                result = self.runner.invoke(main, ["github", "link", url])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("GitHub", result.output)
                self.assertEqual(path.read_bytes(), config)
        with patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")):
            result = self.runner.invoke(main, ["github", "link", "https://github.com/team/other"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("disk full", result.output)
        self.assertEqual(path.read_bytes(), config)
