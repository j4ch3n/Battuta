"""Small source catalogs for development setup tests."""

import json
import re
from pathlib import Path


def manifest_text(role: str, names: list[str]) -> str:
    profile = "worker" if role == "worker" else f"{role}-bot"
    source = Path(__file__).parents[3] / "bots" / profile / "bot.toml"
    head = source.read_text().split("[skills]")[0]
    # Fixture catalogs hold only the named skills (and the research fixture), so share only those with Claude Code.
    head = re.sub(r'(\[claude\]\nskills = )(\[.*?\])', lambda m: m.group(1) + json.dumps([n for n in json.loads(m.group(2)) if n in names or n == "research"]), head, flags=re.S)
    return head + "[skills]\ninclude = " + json.dumps(names)


def write_delegate_templates(profile: Path) -> None:
    """Fixture copies of the worker templates the real manifest ships into the private .pi."""
    directory = profile / ".pi/delegate/templates/claude"
    directory.mkdir(parents=True, exist_ok=True)
    for name in ("implement", "research", "review", "plan"):
        (directory / f"{name}.md").write_text(f"---\nname: {name}\n---\nfixture")


def copy_telegram_template(bot: Path) -> None:
    (bot / ".pi").mkdir(exist_ok=True)
    (bot / ".pi/telegram.json").write_bytes((Path(__file__).parents[3] / "bots/cos-bot/.pi/telegram.json").read_bytes())


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
    for source in ("agent-mail/index.ts", "project-spec/index.ts", "memory-client/index.ts", "memory-client/dream-extension.ts", "assignment-worker/index.ts"):
        path = root / source
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("export default () => {}")
    return names
