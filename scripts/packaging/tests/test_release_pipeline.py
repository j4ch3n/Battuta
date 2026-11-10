"""Release promotion waits for a target-userspace installation of the actual assets."""

from pathlib import Path
import yaml


ROOT = Path(__file__).resolve().parents[3]


def test_release_promotion_is_gated_by_oracle_installation():
    jobs = yaml.safe_load((ROOT / ".github/workflows/release.yml").read_text())["jobs"]
    assert "verify-install" in jobs
    assert "verify-install" in jobs["promote"]["needs"]
    assert jobs["build"]["runs-on"] == "ubuntu-24.04-arm"
    assert "prepare" in jobs["build"]["needs"]
    assert "prerelease" in jobs
