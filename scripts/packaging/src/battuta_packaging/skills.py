"""Copy complete selected skills into disposable release staging."""

from pathlib import Path
import shutil

from bot_setup.skills import load_selection


def stage_skills(root: Path) -> None:
    selections = [(root / f"bots/{bot}", load_selection(root / f"bots/{bot}/skills.json", root / "skills-hub")) for bot in ("pm-bot", "tl-bot")]
    for bot, names in selections:
        skills = bot / ".pi/skills"
        if skills.is_symlink():
            skills.unlink()
        elif skills.exists():
            shutil.rmtree(skills)
        skills.mkdir(parents=True)
        for name in names:
            shutil.copytree(root / "skills-hub" / name, skills / name, symlinks=False)
