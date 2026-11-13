"""Profile extension selections must be safe and reproducible."""

from pathlib import Path

import click
import pytest

from bot_setup.extensions import prepare_source_extensions, profile_settings
from bot_setup.manifest import Extension, parse_manifest


def test_prepares_and_reconciles_only_owned_links(tmp_path: Path):
    source = tmp_path / "mail/index.ts"
    source.parent.mkdir()
    source.write_text("export default () => {}")
    bot = tmp_path / "bots/manager-bot"
    entry = Extension(name="mail", source="mail/index.ts")
    prepare_source_extensions(tmp_path, bot, [entry])
    link = bot / ".pi/extensions/mail.ts"
    assert link.is_symlink()
    assert link.resolve() == source
    prepare_source_extensions(tmp_path, bot, [entry])
    custom = link.parent / "custom.ts"
    custom.write_text("custom")
    prepare_source_extensions(tmp_path, bot, [])
    assert not link.exists()
    assert custom.read_text() == "custom"


def test_conflicting_file_is_not_overwritten(tmp_path: Path):
    source = tmp_path / "mail/index.ts"
    source.parent.mkdir()
    source.write_text("source")
    bot = tmp_path / "bots/manager-bot"
    target = bot / ".pi/extensions/mail.ts"
    target.parent.mkdir(parents=True)
    target.write_text("custom")
    with pytest.raises(click.ClickException):
        prepare_source_extensions(tmp_path, bot, [Extension(name="mail", source="mail/index.ts")])
    assert target.read_text() == "custom"


def test_matching_unowned_link_is_not_adopted(tmp_path: Path):
    source = tmp_path / "mail/index.ts"
    source.parent.mkdir()
    source.write_text("source")
    bot = tmp_path / "bots/manager-bot"
    link = bot / ".pi/extensions/mail.ts"
    link.parent.mkdir(parents=True)
    link.symlink_to("../../../../mail/index.ts")
    with pytest.raises(click.ClickException):
        prepare_source_extensions(tmp_path, bot, [Extension(name="mail", source="mail/index.ts")])
    assert link.resolve() == source
    assert not (bot / ".pi/battuta-extensions.json").exists()


def test_manifest_source_edit_updates_only_the_unchanged_managed_link(tmp_path: Path):
    source = tmp_path / "mail/index.ts"
    source.parent.mkdir()
    source.write_text("source")
    other = source.with_name("other.ts")
    other.write_text("other")
    bot = tmp_path / "bots/manager-bot"
    prepare_source_extensions(tmp_path, bot, [Extension(name="mail", source="mail/index.ts")])
    prepare_source_extensions(tmp_path, bot, [Extension(name="mail", source="mail/other.ts")])
    link = bot / ".pi/extensions/mail.ts"
    assert link.resolve() == other
    link.unlink()
    link.symlink_to(source)
    with pytest.raises(click.ClickException):
        prepare_source_extensions(tmp_path, bot, [Extension(name="mail", source="mail/index.ts")])
    assert link.resolve() == source


def test_undiscoverable_mjs_source_is_rejected():
    with pytest.raises(ValueError):
        Extension(name="mail", source="mail/index.mjs")


def test_missing_selection_does_not_remove_previously_owned_link(tmp_path: Path):
    source = tmp_path / "mail/index.ts"
    source.parent.mkdir()
    source.write_text("source")
    bot = tmp_path / "bots/manager-bot"
    prepare_source_extensions(tmp_path, bot, [Extension(name="mail", source="mail/index.ts")])
    with pytest.raises(click.ClickException):
        prepare_source_extensions(tmp_path, bot, [Extension(name="other", source="missing.ts")])
    assert (bot / ".pi/extensions/mail.ts").resolve() == source


@pytest.mark.parametrize("name", ["../escape", "Upper", "space name"])
def test_invalid_extension_names_are_rejected(name):
    with pytest.raises(ValueError):
        Extension(name=name, source="mail/index.ts")


def test_duplicate_names_are_rejected():
    with pytest.raises(click.ClickException):
        parse_manifest(
            '[skills]\ninclude=[]\n'
            '[[extensions]]\nname="mail"\nsource="mail/index.ts"\n'
            '[[extensions]]\nname="mail"\nsource="other/index.ts"\n',
            Path("bot.toml"),
        )


@pytest.mark.parametrize("role", ["cos", "manager", "worker"])
def test_generated_settings_use_only_manifest_and_role_defaults(role):
    manifest = parse_manifest(
        f'[bot]\nrole="{role}"\nenv_prefix="BOT"\n'
        '[skills]\ninclude=[]\n[packages]\npi=["npm:example@1"]\n',
        Path("bot.toml"),
    )
    settings = profile_settings(manifest, browser=role != "manager")
    assert settings["packages"] == manifest.packages.pi
    assert settings["battutaMemoryCapture"]["enabled"] == (role == "cos")
    assert ("pi-browser-use" in settings) == (role != "manager")
    assert not {"extensions", "defaultModel", "deviceId"} & settings.keys()


@pytest.mark.parametrize("source", ["../other.ts", "/tmp/other.ts", "missing.ts"])
def test_invalid_sources_do_not_create_extension_directory(tmp_path: Path, source: str):
    bot = tmp_path / "bots/manager-bot"
    with pytest.raises((click.ClickException, ValueError)):
        prepare_source_extensions(tmp_path, bot, [Extension(name="mail", source=source)])
    assert not (bot / ".pi/extensions").exists()
