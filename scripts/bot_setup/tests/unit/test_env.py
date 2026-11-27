"""Environment-file syntax supported by bot configuration commands."""

import click
import pytest

from bot_setup.env import read_env


@pytest.mark.parametrize("assignment,expected", [
    ("TOKEN=abc # rotated", "abc"),
    ('TOKEN="abc # literal" # comment', "abc # literal"),
    ("TOKEN='abc#literal'", "abc#literal"),
    ("TOKEN=abc#literal", "abc#literal"),
    ("export TOKEN='abc def'", "abc def"),
    ("TOKEN= # unset", ""),
], ids=["trailing-comment", "quoted-hash-then-comment", "single-quoted-hash", "unquoted-hash", "export-quoted-space", "empty-with-comment"])
def test_assignment_quotes_exports_and_comment_handling(tmp_path, assignment, expected):
    path = tmp_path / ".env"
    path.write_text("# heading\n\n" + assignment + "\n")
    assert read_env(path) == {"TOKEN": expected}


def test_invalid_quoting_reports_file_without_echoing_secret(tmp_path):
    path = tmp_path / ".env"
    path.write_text('TOKEN="private-token\n')
    with pytest.raises(click.ClickException) as caught:
        read_env(path)
    assert str(path) in str(caught.value)
    assert "private-token" not in str(caught.value)
