"""Installers must obtain exact runtime requirements from wheel metadata alone."""

import click
import pytest

from battuta_packaging import wheel_metadata as wheels


def test_release_requirements_pin_closure_and_internal_urls():
    result = wheels.release_requirements('click==8.1.8\ngql[httpx]==4.4.0 ; python_version >= "3.12"\nbattuta-project==0.1\n', release_url="https://github.com/example/repo/releases/download/v1.2.3", tool_version="1.2.3+gabc1234")
    assert "click==8.1.8" in result
    assert any('gql[httpx]==4.4.0' in value and "python_version" in value for value in result)
    assert "battuta-project @ https://github.com/example/repo/releases/download/v1.2.3/battuta_project-1.2.3+gabc1234-py3-none-any.whl" in result


def test_commit_pinned_git_source_is_kept():
    line = "agent-memory-core @ git+https://github.com/tigerless-labs/agent-memory@2648ba02d3c0364f9787f0e8fb49f69f47d2e3f7#subdirectory=packages/core"
    assert wheels.release_requirements(line, release_url="https://example.com/v1.2.3", tool_version="1.2.3") == [line]


@pytest.mark.parametrize("requirement", ["click>=8", "click", "-e ../source", "thing @ file:///source", "thing @ https://example.com/unknown.whl", "click==8.*",
                                         "thing @ git+https://github.com/example/thing@main", "thing @ git+https://github.com/example/thing@2648ba02"],
                         ids=["range", "bare", "editable", "file-url", "unknown-wheel-url", "wildcard", "git-branch", "git-short-sha"])
def test_unpinned_or_local_requirements_fail(requirement):
    with pytest.raises(click.ClickException):
        wheels.release_requirements(requirement, release_url="https://example.com/v1.2.3", tool_version="1.2.3+gabc1234")


def test_internal_wheel_pin_conflicts_fail_closed():
    with pytest.raises(click.ClickException, match="lockfiles disagree"):
        wheels.check_internal_pins({"battuta-project": ["click==8.1.8"], "battuta-artifacts": ["click==8.2.0", "battuta-project @ https://example.com/project.whl"]})
