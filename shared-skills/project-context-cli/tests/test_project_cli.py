"""CLI argument contracts and end-to-end current-project workflows."""

from click.testing import CliRunner
import json
import os
from unittest.mock import patch

import yaml

from battuta_project.cli import main
from project_fixtures import ProjectTestCase
from linear_fixtures import CREATED_PROJECT, PROJECT, linear_http, payload, team_page


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
        output = self.invoke("init", "https://github.com/team/harbor-web")
        self.assertIn("Initialized project: harbor-web", output)
        self.assertIn("~/.battuta/projects/harbor-web/code", output)
        self.assertIn("Current project: harbor-web", output)
        output = self.invoke("switch", "atlas-api")
        self.assertIn("Current project: atlas-api", output)
        self.assertIn("~/.battuta/projects/atlas-api/code", output)

    def test_memory_workflow_uses_current_project_and_indexes(self):
        self.assertIn("line 1", self.invoke("memory", "append", "  First  "))
        self.invoke("memory", "append", "Second")
        self.assertEqual(self.invoke("memory", "get"), "1: First\n2: Second\n")
        self.invoke("memory", "replace", "2", " Revised ")
        self.assertEqual(self.invoke("memory", "get"), "1: First\n2: Revised\n")
        self.invoke("memory", "replaceAll", " Clean \n\n Reconciled ")
        self.assertEqual(self.invoke("memory", "get"), "1: Clean\n2: Reconciled\n")
        self.invoke("init", "https://github.com/team/harbor-web")
        self.assertIn("No memory", self.invoke("memory", "get"))
        self.invoke("memory", "append", "Harbor")
        self.invoke("switch", "atlas-api")
        self.assertEqual(self.invoke("memory", "get"), "1: Clean\n2: Reconciled\n")

    def test_explain_rejects_project_argument_and_uses_current_checkout(self):
        self.file("README.md")
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", self.invoke("explain"))
        result = self.runner.invoke(main, ["explain", "atlas-api"])
        self.assertNotEqual(result.exit_code, 0)

    def test_explain_prints_repository_and_unlinked_linear_without_http(self):
        with linear_http() as requests:
            output = self.invoke("explain")
        self.assertIn("Repository URL: https://github.com/team/atlas-api", output)
        self.assertIn("Linear Project URL: not linked", output)
        self.assertEqual(requests, [])

    def test_explain_fetches_linked_linear_url_without_changing_local_state(self):
        self.invoke("linear", "link", "--project-id", "project-1", "--team-id", "team-1")
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
        self.invoke("linear", "link", "--project-id", "project-1", "--team-id", "team-1")
        for response, message in (
            ({"errors": [{"message": "Not authenticated"}]}, "Not authenticated"),
            ({"data": {"project": None}}, "Linear project"),
        ):
            with self.subTest(response=response), linear_http(response):
                result = self.runner.invoke(main, ["explain"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn(message, result.output)
                self.assertNotIn("Linear Project URL:", result.output)

    def test_missing_current_project_and_invalid_indexes_are_readable_errors(self):
        self.registry.state_path.unlink()
        for args in (["explain"], ["memory", "get"], ["memory", "append", "entry"]):
            with self.subTest(args=args):
                result = self.runner.invoke(main, args)
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("Error:", result.output)
                self.assertIn("switch", result.output)
        self.invoke("switch", "atlas-api")
        self.invoke("memory", "append", "First")
        for index in ("0", "2", "not-a-number"):
            result = self.runner.invoke(main, ["memory", "replace", index, "changed"])
            self.assertNotEqual(result.exit_code, 0)
        self.assertEqual(self.invoke("memory", "get"), "1: First\n")

    def test_all_invocations_require_token_before_any_side_effect(self):
        args_list = (
            (), ("--help",), ("init", "--help"), ("memory", "--help"), ("linear", "--help"),
            ("linear", "create", "--help"), ("memory", "get", "--help"),
            ("switch", "atlas-api"), ("explain",), ("memory", "get"),
            ("init", "https://github.com/team/harbor-web"), ("linear", "refresh"),
            ("linear", "link", "--project-id", "project-1", "--team-id", "team-1"),
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
            self.invoke("memory", "get")
            self.invoke("linear", "link", "--project-id", " project-1 ", "--team-id", " team-1 ")
            self.invoke("init", "https://github.com/team/harbor-web",
                        "--linear-project-id", " project-2 ", "--linear-team-id", " team-2 ")
            self.assertEqual(requests, [])
        self.assertEqual(self.registry.load("atlas-api").config.linear.project_id, "project-1")
        self.assertEqual(self.registry.current().config.linear.team_id, "team-2")

    def test_refresh_without_selection_creates_cache_and_prints_teams(self):
        self.registry.state_path.unlink()
        with linear_http(
            team_page([{"id": "team-1", "name": "Engineering"}], more=True, cursor="next"),
            team_page([{"id": "team-2", "name": "Design"}]),
        ):
            output = self.invoke("linear", "refresh")
        self.assertIn("Engineering", output)
        self.assertIn("team-1", output)
        self.assertIn("Design", output)
        self.assertEqual(json.loads(self.registry.state_path.read_text()), {
            "currentProject": None,
            "linear": {"teams": [{"id": "team-1", "name": "Engineering"}, {"id": "team-2", "name": "Design"}]},
        })

    def test_failed_refresh_preserves_cache_and_selection(self):
        self.registry.state_path.write_text(json.dumps({
            "currentProject": "atlas-api", "linear": {"teams": [{"id": "old", "name": "Old"}]},
        }))
        original = self.registry.state_path.read_text()
        with linear_http(team_page(more=True, cursor="next"), {"errors": [{"message": "Unavailable"}]}):
            result = self.runner.invoke(main, ["linear", "refresh"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("Unavailable", result.output)
        self.assertEqual(self.registry.state_path.read_text(), original)

    def test_refresh_empty_teams_preserves_selection(self):
        with linear_http(team_page()):
            output = self.invoke("linear", "refresh")
        self.assertIn("0", output)
        self.assertEqual(self.registry.current().name, "atlas-api")
        self.assertEqual(self.registry.state().linear.teams, [])

    def test_blank_linear_options_are_rejected_before_cloning_or_http(self):
        for args in (
            ["init", "https://github.com/team/harbor-web", "--linear-project-id", " "],
            ["init", "https://github.com/team/harbor-web", "--linear-team-id", " "],
            ["linear", "link", "--project-id", " ", "--team-id", "team-1"],
            ["linear", "link", "--project-id", "project-1", "--team-id", " "],
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

    def test_create_links_remote_project_without_refresh(self):
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
        self.assertIn("linear link --project-id project-1 --team-id team-1", result.output)
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
        self.assertIn("linear link --project-id project-1 --team-id team-1", result.output)
        self.assertEqual(len(requests), 1)
