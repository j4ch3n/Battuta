"""Small filesystem catalogs and bundles for packaging contract tests."""

import json
from pathlib import Path


def manifest_text(role: str, names: list[str]) -> str:
    profile = "worker" if role == "worker" else f"{role}-bot"
    source = Path(__file__).parents[3] / "bots" / profile / "bot.toml"
    return source.read_text().split("[skills]")[0] + "[skills]\ninclude = " + json.dumps(names)


def skill_catalog(root: Path, role: str, names=None) -> list[str]:
    (root / "skills-hub").mkdir(parents=True, exist_ok=True)
    if names is None:
        names = ["project-management", "todo", "note-taking", "research"]
        if role == "cos":
            names.append("draft-writing")
    for name in names:
        source = root / "skills-hub" / name
        (source / "references").mkdir(parents=True, exist_ok=True)
        (source / "SKILL.md").write_text(f"---\nname: {name}\n---\n")
        (source / "references/tools.md").write_text(f"{name} tools")
    bot = root / f"bots/{role}-bot"
    bot.mkdir(parents=True, exist_ok=True)
    (bot / "bot.toml").write_text(manifest_text(role, names))
    return names
