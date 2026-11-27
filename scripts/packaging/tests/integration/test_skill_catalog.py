"""Every bot manifest's skill selection validates against the real catalog."""

from pathlib import Path
import shutil

import pytest

from bot_setup.skills import check_manifests

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[4]
HUB = ROOT / "skills-hub"


def test_bot_selections_validate_without_discovery_output(tmp_path):
    shutil.copytree(HUB, tmp_path / "skills-hub")
    for manifest in (ROOT / "bots").glob("*/bot.toml"):
        target = tmp_path / manifest.relative_to(ROOT)
        target.parent.mkdir(parents=True)
        shutil.copy2(manifest, target)
    check_manifests(tmp_path)
    assert not any((tmp_path / "bots").glob("*/.pi"))
