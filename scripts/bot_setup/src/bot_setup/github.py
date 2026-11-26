"""Check that Manager's host GitHub CLI is signed in for merging."""

import shutil
import subprocess

import click


def check_github(gh: str = "gh") -> None:
    executable = shutil.which(gh)
    if executable is None:
        raise click.ClickException("GitHub CLI `gh` is not on PATH; install it for Manager merges")
    # gh prints account details, so its output stays private.
    if subprocess.run([executable, "auth", "status", "--hostname", "github.com"], capture_output=True, check=False).returncode != 0:
        raise click.ClickException("GitHub CLI is not signed in; run `gh auth login` as the Manager host user")
