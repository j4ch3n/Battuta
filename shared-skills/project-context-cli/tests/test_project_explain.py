"""Documentation indexes are recursive; directory presentation is bounded."""

from unittest.mock import patch

import click

from battuta_project.explain import explain_project
from battuta_project.models import GithubConfig
from battuta_project.presentation import render
from project_fixtures import ProjectTestCase


class ExplainTests(ProjectTestCase):
    def test_overview_reports_workspace_paths_without_spec_fields_or_creating_files(self):
        before = sorted(path.name for path in self.project.root.iterdir())
        output = render("explain.md.j2", explain_project(self.project))
        self.assertIn("Managed Project Directory: ~/.battuta/projects/atlas-api", output)
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", output)
        self.assertNotIn("Specs Root:", output)
        self.assertIn("Summary: ~/.battuta/projects/atlas-api/SUMMARY.md", output)
        self.assertNotIn("Constitution:", output)
        self.assertEqual(sorted(path.name for path in self.project.root.iterdir()), before)
        self.assertFalse((self.project.root / "specs").exists())

    def test_summary_preserves_multiline_markdown_from_managed_root(self):
        summary = "# Atlas\n\nPurpose: import maps.\n\n- **Current:** CSV imports\n- Proposed: offline use\n"
        path = self.project.root / "SUMMARY.md"
        path.write_text(summary, encoding="utf-8")
        self.file("SUMMARY.md", "Wrong checkout summary")
        result = explain_project(self.project)
        output = render("explain.md.j2", result)
        self.assertIn(summary, output)
        self.assertNotIn("Wrong checkout summary", output)
        self.assertEqual(path.read_text(encoding="utf-8"), summary)
        self.assertEqual(result.summary, summary)

    def test_missing_and_blank_summaries_are_reported_without_writing(self):
        path = self.project.root / "SUMMARY.md"
        for content in (None, "", " \t\n"):
            with self.subTest(content=content):
                if path.exists():
                    path.unlink()
                if content is not None:
                    path.write_text(content, encoding="utf-8")
                output = render("explain.md.j2", explain_project(self.project))
                self.assertIn("Project summary: not written yet", output)
                self.assertEqual(path.exists(), content is not None)
                if content is not None:
                    self.assertEqual(path.read_text(encoding="utf-8"), content)

    def test_invalid_summary_files_report_the_path(self):
        path = self.project.root / "SUMMARY.md"
        if path.exists():
            path.unlink()
        path.mkdir()
        with self.assertRaisesRegex(click.ClickException, "SUMMARY.md"):
            explain_project(self.project)
        path.rmdir()
        path.write_bytes(b"\xff")
        with self.assertRaisesRegex(click.ClickException, "SUMMARY.md"):
            explain_project(self.project)
        self.assertEqual(path.read_bytes(), b"\xff")
        path.unlink()
        outside = self.home / "outside-summary.md"
        outside.write_text("Outside project")
        path.symlink_to(outside)
        with self.assertRaisesRegex(click.ClickException, "SUMMARY.md"):
            explain_project(self.project)
        self.assertEqual(outside.read_text(), "Outside project")

    def test_summary_read_failure_preserves_content_and_selection(self):
        path = self.project.root / "SUMMARY.md"
        path.write_bytes(b"# Atlas\n\nMap imports.\n")
        original = path.read_bytes()
        selection = self.registry.state_path.read_bytes()
        with patch("pathlib.Path.read_text", side_effect=PermissionError("access denied")):
            with self.assertRaisesRegex(click.ClickException, "SUMMARY.md.*access denied"):
                explain_project(self.project)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(self.registry.state_path.read_bytes(), selection)

    def test_index_finds_deep_docs_but_limits_tree_to_two_directory_levels(self):
        for path in ("README.md", "AGENTS.md", "docs/README.md", "src/AGENTS.md", "src/api/README.md", "src/api/internal/AGENTS.md"):
            self.file(path)
        self.file("src/api/deep_file.py")
        result = explain_project(self.project)
        self.assertEqual(result.readme, "README.md")
        self.assertEqual(result.agents, "AGENTS.md")
        self.assertEqual(result.sub_readmes, ["docs/README.md", "src/api/README.md"])
        self.assertEqual(result.sub_agents, ["src/AGENTS.md", "src/api/internal/AGENTS.md"])
        self.assertEqual(result.tree, [
            "code/", "|-- AGENTS.md", "|-- README.md", "|-- docs/", "|   `-- README.md",
            "`-- src/", "    |-- AGENTS.md", "    `-- api/",
        ])

    def test_generated_and_symlink_content_is_excluded(self):
        for path in (".git/README.md", "node_modules/pkg/AGENTS.md", ".venv/lib/README.md", "dist/README.md", "__pycache__/README.md"):
            self.file(path)
        outside = self.home / "outside"
        outside.mkdir()
        (outside / "AGENTS.md").write_text("outside")
        (self.project.code / "linked").symlink_to(outside, target_is_directory=True)
        (self.project.code / "README.md").symlink_to(outside / "AGENTS.md")
        result = explain_project(self.project)
        self.assertIsNone(result.readme)
        self.assertEqual(result.sub_readmes, [])
        self.assertEqual(result.sub_agents, [])
        self.assertEqual(result.tree, ["code/"])

    def test_render_exposes_context_without_internal_registry_files(self):
        self.file("README.md")
        output = render("explain.md.j2", explain_project(self.project))
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", output)
        self.assertIn("- README.md: README.md", output)
        self.assertIn("- AGENTS.md: not found", output)
        self.assertIn("none found", output)
        self.assertNotIn("MEMORY.md", output)
        self.assertNotIn("project.yaml", output)
        self.assertNotIn(".config.json", output)

    def test_missing_repository_is_reported_without_inventing_a_url(self):
        project = self.project.model_copy(update={
            "config": self.project.config.model_copy(update={"github": GithubConfig()}),
        })
        output = render("explain.md.j2", explain_project(project))
        self.assertIn("Repository URL: no GitHub repository linked yet", output)
