"""Artifact, publish and website requests route through the artifacts workflow."""

import re
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
COS = ROOT / "bots/cos-bot/AGENTS_dedicated.md"
WORKER = ROOT / "bots/worker/AGENTS_dedicated.md"
ASSIGNMENTS = ROOT / "skills-hub/define-assignments/SKILL.md"
ARTIFACTS = ROOT / "skills-hub/artifacts/SKILL.md"
EDITED = [
    COS,
    WORKER,
    ASSIGNMENTS,
    ARTIFACTS,
    ROOT / "skills-hub/artifacts/references/verification.md",
    ROOT / "skills-hub/artifacts/references/commands.md",
]


def frontmatter(path):
    return dict(line.split(": ", 1) for line in path.read_text().split("---")[1].strip().splitlines())


def paragraphs(path):
    return [" ".join(block.split()) for block in re.split(r"\n\s*\n", path.read_text())]


def test_worker_selects_artifacts_skill():
    skills = tomllib.loads((ROOT / "bots/worker/bot.toml").read_text())["skills"]["include"]
    assert "artifacts" in skills


@pytest.mark.parametrize("trigger", ["HTML page", "web page", "website", "publish", "self-contained HTML file"])
def test_artifacts_skill_triggers_on_page_and_publish_requests(trigger):
    assert trigger in frontmatter(ARTIFACTS)["description"]


def test_assignment_briefs_require_artifacts_workflow():
    rule = next(p for p in paragraphs(ASSIGNMENTS) if "`artifacts` skill" in p)
    assert "must not ask for a standalone or self-contained HTML file" in rule
    assert "local_url" in rule and "not checked" in rule


def test_cos_routes_artifact_requests_to_manager_with_publish_authority():
    text = COS.read_text()
    rule = next(line for line in text.splitlines() if "artifact-build request" in line)
    assert "Manager" in rule and '"draft only"' in rule and '"publish approved"' in rule
    assert "`artifacts`" not in text and "local_url" not in text


@pytest.mark.parametrize("path", EDITED, ids=lambda path: str(path.relative_to(ROOT)))
def test_public_url_checks_are_reported_not_checked(path):
    # Paragraph-level so that rules wrapped across lines are still covered.
    for paragraph in paragraphs(path):
        if re.search(r"public URL|artifact\.url", paragraph) and re.search(r"fetch|check|confirm", paragraph):
            assert "not checked" in paragraph, paragraph
