"""Documentation indexes are recursive; directory presentation is bounded."""

from battuta_project.explain import explain_project
from battuta_project.models import GithubConfig
from battuta_project.presentation import render


def test_overview_reports_workspace_paths_without_creating_files(project):
    before = sorted(path.name for path in project.root.iterdir())
    output = render("explain.md.j2", explain_project(project))
    assert "Managed Project Directory: ~/.battuta/projects/atlas-api" in output
    assert "Project Root: ~/.battuta/projects/atlas-api/code" in output
    assert "## Project overview" in output
    assert sorted(path.name for path in project.root.iterdir()) == before


def test_index_finds_deep_docs_but_limits_tree_to_two_directory_levels(project, project_file):
    for path in ("README.md", "AGENTS.md", "docs/README.md", "src/AGENTS.md", "src/api/README.md", "src/api/internal/AGENTS.md"):
        project_file(path)
    project_file("src/api/deep_file.py")
    result = explain_project(project)
    assert result.readme == "README.md"
    assert result.agents == "AGENTS.md"
    assert result.sub_readmes == ["docs/README.md", "src/api/README.md"]
    assert result.sub_agents == ["src/AGENTS.md", "src/api/internal/AGENTS.md"]
    assert result.tree == [
        "code/", "|-- AGENTS.md", "|-- README.md", "|-- docs/", "|   `-- README.md",
        "`-- src/", "    |-- AGENTS.md", "    `-- api/",
    ]


def test_generated_and_symlink_content_is_excluded(project, project_file, home):
    for path in (".git/README.md", "node_modules/pkg/AGENTS.md", ".venv/lib/README.md", "dist/README.md", "__pycache__/README.md"):
        project_file(path)
    outside = home / "outside"
    outside.mkdir()
    (outside / "AGENTS.md").write_text("outside")
    (project.code / "linked").symlink_to(outside, target_is_directory=True)
    (project.code / "README.md").symlink_to(outside / "AGENTS.md")
    result = explain_project(project)
    assert result.readme is None
    assert result.sub_readmes == []
    assert result.sub_agents == []
    assert result.tree == ["code/"]


def test_render_exposes_context_without_internal_registry_files(project, project_file):
    project_file("README.md")
    output = render("explain.md.j2", explain_project(project))
    assert "Project Root: ~/.battuta/projects/atlas-api/code" in output
    assert "- README.md: README.md" in output
    assert "- AGENTS.md: not found" in output
    assert "none found" in output
    for internal in ("MEMORY.md", "project.yaml", ".config.json"):
        assert internal not in output


def test_missing_repository_is_reported_without_inventing_a_url(project):
    unlinked = project.model_copy(update={
        "config": project.config.model_copy(update={"github": GithubConfig()}),
    })
    output = render("explain.md.j2", explain_project(unlinked))
    assert "Repository URL: no GitHub repository linked yet" in output
