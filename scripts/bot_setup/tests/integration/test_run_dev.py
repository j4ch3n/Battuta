"""Launcher orchestration, independent of Telegram refresh implementation."""

import json
import os
import re
import shutil
import subprocess
import sys

import pytest

from fixtures import ROOT

pytestmark = pytest.mark.integration


def run_pane(command, *, shell="bash", env=None):
    """Execute a tmux pane command the way tmux would, capturing its output."""
    return subprocess.run([shell, "-c", command], env=env, capture_output=True, text=True)


def write_pi(env, role, body):
    """Replace a bot's `pi` stub with a Python script."""
    (env.root / f"bots/{role}-bot/node_modules/.bin/pi").write_text(f"#!{sys.executable}\n{body}")


def agent_panes(env):
    return [call[-1] for call in env.commands() if "AGENT_ROLE=" in call[-1]]


def test_shared_launcher_rejects_invalid_mode_from_an_unrelated_cwd(tmp_path):
    result = subprocess.run(
        ["bash", str(ROOT / "scripts/bot_setup/run-dev.sh"), "invalid"],
        cwd=tmp_path, capture_output=True, text=True,
    )
    assert result.returncode == 2
    assert "dev|prod" in result.stderr


def test_manager_manifest_controls_private_directory_and_missing_defaults(launcher_env):
    env = launcher_env
    profile = env.root / "bots/manager-bot"
    manifest = profile / "bot.toml"
    manifest.write_text(manifest.read_text().replace('pi_coding_agent_dir = "manager-bot/.pi"', 'pi_coding_agent_dir = "custom-manager/.pi"'))
    private = env.home / ".battuta/pi-bots/custom-manager"
    (env.home / ".battuta/pi-bots/manager-bot").rename(private)
    write_pi(env, "manager", "import os\nprint(os.environ['PI_CODING_AGENT_DIR'])\n")
    result = env.run_launcher("prod", existing=False)
    assert result.returncode == 0, result.stderr
    command = next(call[-1] for call in env.commands() if "AGENT_ROLE=manager" in call[-1])
    pane = run_pane(command)
    assert pane.returncode == 0, pane.stderr
    assert pane.stdout.strip() == str(private / ".pi")
    settings = private / ".pi/settings.json"
    assert json.loads(settings.read_text())["defaultThinkingLevel"] == "medium"
    settings.write_text("{}")
    again = run_pane(command)
    assert again.returncode == 0, again.stderr
    assert settings.read_text() == "{}"


@pytest.mark.parametrize("count", [0, 1, 3], ids=["none", "one", "three"])
def test_selected_workers_control_distinct_panes(launcher_env, count):
    env = launcher_env
    path = env.root / ".env"
    path.write_text(re.sub(r"BATTUTA_WORKER_[0-9]+_TYPE=.*\n", "", path.read_text())
                    + "".join(f"BATTUTA_WORKER_{n}_TYPE=general\n" for n in range(1, count + 1)))
    result = env.run_launcher("dev", existing=False)
    assert result.returncode == 0, result.stderr
    workers = [c for c in env.commands() if c[0] == "split-window" and "--bot-dir" in c[-1]]
    assert len(workers) == count
    for number, call in enumerate(workers, 1):
        assert f".battuta/pi-bots/worker-{number}" in call[-1]


def test_invalid_selection_fails_before_reattach(launcher_env):
    path = launcher_env.root / ".env"
    path.write_text(path.read_text().replace("BATTUTA_WORKER_1_TYPE=general", "BATTUTA_WORKER_0_TYPE=general"))
    result = launcher_env.run_launcher("dev", existing=True)
    assert result.returncode != 0
    assert not launcher_env.log.exists()


def test_manager_and_memory_panes_keep_tool_path_with_stale_tmux_environment(launcher_env):
    env = launcher_env
    env.executable("battuta-project", "")
    env.executable("battuta-memory", "print('installed-memory')\n")
    launcher = env.root / "memory-service/.venv/bin/battuta-memory"
    launcher.parent.mkdir(parents=True)
    launcher.write_text('#!/bin/sh\nexec battuta-memory\n')
    launcher.chmod(0o700)
    write_pi(env, "manager", "import shutil\nprint(shutil.which('battuta-project'))\n")
    result = env.run_launcher("prod", existing=False)
    assert result.returncode == 0, result.stderr
    panes = {}
    for call in env.commands():
        if "AGENT_ROLE=manager" not in call[-1] and call[0] != "new-window":
            continue
        pane = run_pane(call[-1], env={**os.environ, "PATH": "/usr/bin:/bin"})
        assert pane.returncode == 0, pane.stderr
        panes["manager" if "AGENT_ROLE=manager" in call[-1] else "memory"] = pane.stdout.strip()
    assert panes == {"manager": str(env.bin / "battuta-project"), "memory": "installed-memory"}


def test_dev_groups_bots_and_services_in_two_horizontal_windows(launcher_env):
    result = launcher_env.run_launcher("dev", existing=False)
    assert result.returncode == 0, result.stderr
    commands = launcher_env.commands()
    assert len([c for c in commands if c[0] in ("new-session", "new-window")]) == 2
    splits = [c for c in commands if c[0] == "split-window"]
    assert len(splits) == 3
    assert all("-h" in c for c in splits)
    assert "AGENT_ROLE=manager" in splits[0][-1]
    assert "--bot-dir" in splits[2][-1]
    assert len([c for c in commands if c[0] == "select-layout"]) == 2


@pytest.mark.parametrize("ready", [False, True], ids=["not-ready", "ready"])
def test_dev_worker_command_requires_readiness_and_passes_private_paths(launcher_env, ready):
    env = launcher_env
    result = env.run_launcher("dev", existing=False)
    assert result.returncode == 0, result.stderr
    command = next(c[-1] for c in env.commands() if c[0] == "split-window" and "--bot-dir" in c[-1])
    (env.root / "scripts/bot_setup/run-worker.sh").write_text('printf "%s\\n" "$@"\n')
    (env.root / "scripts/bot_setup/wait-for-assignments.mjs").write_text(f"process.exit({0 if ready else 1});\n")
    pane = run_pane(command, shell=shutil.which("zsh") or "sh")
    assert pane.returncode == (0 if ready else 1), pane.stderr
    assert pane.stdout.splitlines() == (
        ["--bot-dir", str(env.worker), "--env-file", str(env.root / ".env")] if ready else []
    )
    assert "supabase-test" not in pane.stdout + pane.stderr


def test_dev_missing_worker_prerequisite_fails_before_creating_session(launcher_env):
    env = launcher_env
    (env.root / "assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js").unlink()
    result = env.run_launcher("dev", existing=False)
    assert result.returncode != 0
    assert not any(c[0] == "new-session" for c in env.commands())
    assert "supabase-test" not in result.stdout + result.stderr


def test_dev_launch_accepts_worker_without_private_configuration(launcher_env):
    env = launcher_env
    shutil.rmtree(env.worker)
    result = env.run_launcher("dev", existing=False)
    assert result.returncode == 0, result.stderr
    assert env.worker.is_dir(), "tmux requires its pane cwd to exist"
    assert not (env.worker / ".pi").exists()
    assert any("--bot-dir" in call[-1] for call in env.commands())


def test_manager_pane_scrubs_credentials_under_non_bash_tmux_shell(launcher_env):
    env = launcher_env
    write_pi(env, "manager", 'import json, os\nprint(json.dumps({"telegram": any("TELEGRAM" in key for key in os.environ)}))\n')
    result = env.run_launcher("prod", existing=False)
    assert result.returncode == 0, result.stderr
    command = next(call[-1] for call in env.commands() if "AGENT_ROLE=manager" in call[-1])
    pane = run_pane(command, shell=shutil.which("zsh") or shutil.which("sh"), env={**os.environ, "COS_TELEGRAM_TOKEN": "private-parent"})
    assert pane.returncode == 0, pane.stderr
    assert not json.loads(pane.stdout)["telegram"]


@pytest.mark.parametrize("text", [None, "broken"], ids=["missing", "corrupt"])
def test_missing_or_corrupt_store_blocks_new_session_without_replacing_it(launcher_env, text):
    env = launcher_env
    if text is None:
        env.scheduler.unlink()
    else:
        env.scheduler.write_text(text)
    result = env.run_launcher("prod", existing=False)
    assert result.returncode != 0
    assert not any(c[0] == "new-session" for c in env.commands())
    assert (env.scheduler.read_text() if env.scheduler.exists() else None) == text


def test_production_pane_commands_pass_runtime_environment_to_bots(launcher_env):
    env = launcher_env
    for role in ("cos", "manager"):
        write_pi(env, role, '''import json, os
print(json.dumps({"role": os.environ["AGENT_ROLE"], "token": os.environ.get("LINEAR_API_TOKEN"),
    "telegram": any("TELEGRAM" in key for key in os.environ),
    "memory": os.environ.get("BATTUTA_MEMORY_URL"), "scheduler": os.environ.get("PI_SCHEDULER_STATE_FILE"),
    "catchup": os.environ.get("PI_SCHEDULER_CATCHUP_MAX"), "browser": os.environ.get("CHROME_PATH"),
    "agentDir": os.environ.get("PI_CODING_AGENT_DIR"), "umask": os.umask(0)}))
''')
    result = env.run_launcher("prod", existing=False)
    assert result.returncode == 0, result.stderr
    pane_env = {key: value for key, value in os.environ.items() if key != "LINEAR_API_TOKEN"}
    outputs = []
    for command in agent_panes(env):
        pane = run_pane(command, env=pane_env)
        assert pane.returncode == 0, pane.stderr
        outputs.append(json.loads(pane.stdout))
    cos, manager = outputs
    assert [cos["role"], manager["role"]] == ["cos", "manager"]
    for item in outputs:
        assert item["token"] == "linear-test"
        assert item["umask"] == 0o77
    assert cos["scheduler"] == str(env.scheduler)
    assert cos["catchup"] == "0"
    assert cos["browser"] == str(env.bin / "chromium-browser")
    assert cos["agentDir"] == str(env.home / ".battuta/pi-bots/cos-bot/.pi")
    assert cos["telegram"]
    assert not manager["telegram"]
    assert manager["scheduler"] is None
    assert manager["agentDir"] == str(env.home / ".battuta/pi-bots/manager-bot/.pi")


@pytest.mark.parametrize("override", [None, "http://127.0.0.1:8989/mcp"], ids=["default", "override"])
def test_shared_memory_endpoint_reaches_both_processes(launcher_env, override):
    env = launcher_env
    if override:
        with (env.root / ".env.prod").open("a") as output:
            output.write(f'BATTUTA_MEMORY_URL="{override}"\n')
    for role in ("cos", "manager"):
        write_pi(env, role, "import os\nprint(os.environ['BATTUTA_MEMORY_URL'])\n")
    result = env.run_launcher("prod", existing=False)
    assert result.returncode == 0, result.stderr
    panes = agent_panes(env)
    assert len(panes) == 2
    urls = set()
    for command in panes:
        pane = run_pane(command)
        assert pane.returncode == 0, pane.stderr
        urls.add(pane.stdout.strip())
    assert len(urls) == 1
    url = urls.pop()
    assert url.startswith("http://127.0.0.1:")
    if override:
        assert url == override


@pytest.mark.parametrize("existing", [True, False], ids=["attach", "fresh"])
@pytest.mark.parametrize("mode", ["dev", "prod"])
def test_launch_does_not_refresh_telegram_configuration(launcher_env, mode, existing):
    env = launcher_env
    before = env.config_path("cos").read_bytes()
    result = env.run_launcher(mode, existing=existing)
    assert result.returncode == 0, result.stderr
    assert env.config_path("cos").read_bytes() == before
    assert not env.config_path("manager").exists()
    assert not env.respawn_targets()


@pytest.mark.parametrize("mode,filename,expected_splits", [("dev", ".env", 3), ("prod", ".env.prod", 2)])
def test_fresh_launch_uses_selected_environment_and_expected_panes(launcher_env, mode, filename, expected_splits):
    env = launcher_env
    with (env.root / filename).open("a") as output:
        output.write(f"BATTUTA_TEST_MODE={mode}\n")
    for role in ("cos", "manager"):
        write_pi(env, role, 'import json, os, sys\nprint(json.dumps({"mode": os.environ["BATTUTA_TEST_MODE"], "agentDir": os.environ["PI_CODING_AGENT_DIR"], "args": sys.argv[1:]}))\n')
    result = env.run_launcher(mode, existing=False)
    assert result.returncode == 0, result.stderr
    assert len([c for c in env.commands() if c[0] == "split-window"]) == expected_splits
    panes = agent_panes(env)
    assert len(panes) == 2
    for command in panes:
        pane = run_pane(command)
        assert pane.returncode == 0, pane.stderr
        output = json.loads(pane.stdout)
        assert output["mode"] == mode
        if "AGENT_ROLE=manager" in command:
            private_pi = str(env.home / ".battuta/pi-bots/manager-bot/.pi")
            assert output["agentDir"] == private_pi
            assert output["args"][output["args"].index("--session-dir") + 1] == f"{private_pi}/mail-sessions"
        assert "--extension" not in output["args"]
    assert env.commands()[-1] == ["attach-session", "-t", f"=battuta-{mode}"]


@pytest.mark.parametrize("mode", ["dev", "prod"])
def test_existing_session_only_attaches(launcher_env, mode):
    result = launcher_env.run_launcher(mode)
    assert result.returncode == 0, result.stderr
    assert launcher_env.commands() == [
        ["has-session", "-t", f"=battuta-{mode}"],
        ["attach-session", "-t", f"=battuta-{mode}"],
    ]
