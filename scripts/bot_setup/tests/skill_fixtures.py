"""Small source catalogs for development setup tests."""

import json
from pathlib import Path


def manifest_text(role: str, names: list[str]) -> str:
    profile = "worker" if role == "worker" else f"{role}-bot"
    source = Path(__file__).parents[3] / "bots" / profile / "bot.toml"
    return source.read_text().split("[skills]")[0] + "[skills]\ninclude = " + json.dumps(names)


def skill_catalog(root: Path, role: str, names=None) -> list[str]:
    (root / "skills-hub").mkdir(parents=True, exist_ok=True)
    names = names if names is not None else ["project-management", "todo", "note-taking", "research", *(["draft-writing"] if role == "cos" else [])]
    for name in names:
        source = root / "skills-hub" / name
        (source / "references").mkdir(parents=True, exist_ok=True)
        (source / "SKILL.md").write_text(f"---\nname: {name}\n---\n")
        (source / "references/tools.md").write_text(f"{name} tools")
    bot = root / f"bots/{role}-bot"
    bot.mkdir(parents=True, exist_ok=True)
    (bot / "bot.toml").write_text(manifest_text(role, names))
    for source in ("agent-mail/index.ts", "project-spec/index.ts", "memory-client/index.ts", "memory-client/dream-extension.ts", "assignment-worker/index.ts", "cos-extension/index.ts"):
        path = root / source
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("export default () => {}")
    return names
