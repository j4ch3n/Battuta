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


def test_supabase_dry_runs_on_main_and_deploys_only_on_release():
    ci_jobs = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())["jobs"]
    release_jobs = yaml.safe_load((ROOT / ".github/workflows/release.yml").read_text())["jobs"]
    supabase_wf = yaml.safe_load((ROOT / ".github/workflows/supabase-deploy.yml").read_text())

    triggers = supabase_wf.get("on") or supabase_wf[True]
    dry_run_input = triggers["workflow_call"]["inputs"]["dry-run"]
    assert dry_run_input["type"] == "boolean"
    assert dry_run_input["default"] is False

    ci_supabase_calls = [
        job for job in ci_jobs.values() if job.get("uses") == "./.github/workflows/supabase-deploy.yml"
    ]
    assert len(ci_supabase_calls) == 1
    assert ci_supabase_calls[0].get("with") == {"dry-run": True}

    steps = supabase_wf["jobs"]["deploy"]["steps"]
    dry_steps = [s for s in steps if "supabase db push --dry-run" in s.get("run", "")]
    assert len(dry_steps) == 1
    assert "inputs.dry-run" in dry_steps[0].get("if", "") and "!inputs.dry-run" not in dry_steps[0].get("if", "")

    for cmd in ("supabase db push --yes", "supabase secrets set", "supabase functions deploy"):
        mutating = [s for s in steps if cmd in s.get("run", "")]
        assert len(mutating) == 1
        assert "!inputs.dry-run" in mutating[0].get("if", "")

    deploy_job = release_jobs["deploy-supabase"]
    assert deploy_job["uses"] == "./.github/workflows/supabase-deploy.yml"
    assert not deploy_job.get("with", {}).get("dry-run", False)
    assert deploy_job.get("secrets") == "inherit"
    assert "verify-install" in deploy_job["needs"]
    assert "deploy-supabase" in release_jobs["promote"]["needs"]

