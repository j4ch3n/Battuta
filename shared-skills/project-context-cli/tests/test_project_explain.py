"""Documentation indexes are recursive; directory presentation is bounded."""

from battuta_project.explain import explain_project
from battuta_project.presentation import render
from project_fixtures import ProjectTestCase


class ExplainTests(ProjectTestCase):
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

    def test_render_only_exposes_checkout_and_doc_index(self):
        self.file("README.md")
        output = render("explain.md.j2", explain_project(self.project))
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", output)
        self.assertIn("- README.md: README.md", output)
        self.assertIn("- AGENTS.md: not found", output)
        self.assertIn("none found", output)
        self.assertNotIn("MEMORY.md", output)
        self.assertNotIn("project.yaml", output)
        self.assertNotIn(".config.json", output)
