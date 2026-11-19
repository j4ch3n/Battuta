"""Worktree commands against a real temporary git checkout."""

from click.testing import CliRunner
import json
import os
import subprocess
from unittest.mock import patch

from battuta_project.cli import main
from project_fixtures import ProjectTestCase


class WorktreeTests(ProjectTestCase):
    def setUp(self):
        super().setUp()
        self.clone_patch.stop()  # these tests run real git
        # Git hooks export GIT_DIR/GIT_INDEX_FILE, which would redirect these tests' own repositories.
        env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        token = patch.dict(os.environ, {**env, "LINEAR_API_TOKEN": "test-token"}, clear=True)
        token.start()
        self.addCleanup(token.stop)
        git = ["git", "-C", str(self.project.code), "-c", "user.name=t", "-c", "user.email=t@t"]
        subprocess.run([*git, "init", "-q", "-b", "main"], check=True)
        subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "init"], check=True)

    def run_cli(self, *args, ok=True):
        result = CliRunner().invoke(main, ["worktree", *args])
        self.assertEqual(result.exit_code == 0, ok, result.output)
        return result.output

    def test_create_places_worktree_under_project_on_agent_branch(self):
        self.run_cli("create", "atlas-api", "fix-login")
        path = self.project.root / "worktrees" / "fix-login"
        self.assertTrue((path / ".git").exists())
        branch = subprocess.run(["git", "-C", str(path), "branch", "--show-current"], capture_output=True, text=True).stdout
        self.assertEqual(branch.strip(), "agent/fix-login")
        status = subprocess.run(["git", "-C", str(self.project.code), "status", "--porcelain"], capture_output=True, text=True).stdout
        self.assertEqual(status, "")

    def test_create_rejects_bad_names_and_existing_worktrees(self):
        for name in ("../escape", "Upper", "a b", "-lead", "double--hyphen"):
            with self.subTest(name=name):
                self.run_cli("create", "atlas-api", "--", name, ok=False)
        self.run_cli("create", "atlas-api", "one")
        self.run_cli("create", "atlas-api", "one", ok=False)

    def test_list_reports_only_managed_worktrees_with_dirty_state(self):
        self.run_cli("create", "atlas-api", "clean-one")
        self.run_cli("create", "atlas-api", "dirty-one", "--branch", "custom/dirty")
        (self.project.root / "worktrees" / "dirty-one" / "x.txt").write_text("x")
        listed = {w["name"]: w for w in json.loads(self.run_cli("list", "atlas-api", "--json"))["worktrees"]}
        self.assertEqual(set(listed), {"clean-one", "dirty-one"})
        self.assertEqual((listed["clean-one"]["dirty"], listed["dirty-one"]["dirty"]), (False, True))
        self.assertEqual(listed["dirty-one"]["branch"], "custom/dirty")

    def test_delete_refuses_dirty_unless_forced_and_keeps_branch(self):
        self.run_cli("create", "atlas-api", "wip")
        path = self.project.root / "worktrees" / "wip"
        (path / "x.txt").write_text("x")
        self.run_cli("delete", "atlas-api", "wip", ok=False)
        self.assertTrue(path.exists())
        self.run_cli("delete", "atlas-api", "wip", "--force")
        self.assertFalse(path.exists())
        branches = subprocess.run(["git", "-C", str(self.project.code), "branch", "--list", "agent/wip"], capture_output=True, text=True).stdout
        self.assertIn("agent/wip", branches)
        self.assertEqual(json.loads(self.run_cli("list", "atlas-api", "--json")), {"worktrees": []})

    def test_unknown_project_and_missing_worktree_fail(self):
        self.run_cli("create", "missing", "x", ok=False)
        self.run_cli("delete", "atlas-api", "nothing", ok=False)
