"""Generate explicit user units without starting or enabling any service."""

import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile

import click
from bot_setup.env import read_env
from bot_setup.instances import worker_names

from .runtime import check_node


def install_services(root: Path, *, env_file: Path, node: Path, replace: bool = False) -> None:
    root, env_file, node = root.resolve(), env_file.resolve(), node.resolve()
    workers = worker_names(read_env(env_file), env_file)
    check_node(root, node)
    try:
        tools = Path(subprocess.check_output(["uv", "tool", "dir", "--bin"], text=True).strip())
        uv = shutil.which("uv")
        if not uv or not tools.is_absolute():
            raise ValueError("uv")
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise click.ClickException("Resolve uv and its tool directory before installing services") from error
    for path in (root, env_file, node, tools, Path(uv).parent, Path.home()):
        if re.search(r"[^a-zA-Z0-9_./-]", str(path)):
            raise click.ClickException("Service paths must not contain spaces or systemd special characters")
    active = subprocess.run(["systemctl", "--user", "list-units", "battuta-worker@*.service", "--all", "--plain", "--no-legend"], capture_output=True, text=True)
    if active.returncode:
        raise click.ClickException("Cannot inspect existing worker services")
    expected = {f"battuta-worker@{name.removeprefix('worker-')}.service" for name in workers}
    for line in active.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 3 and fields[2] in {"active", "activating", "deactivating"} and fields[0] not in expected:
            raise click.ClickException("A running worker is outside WORKER_BOT_COUNT; ask the owner before changing services")
    path_value = os.pathsep.join(map(str, (node.parent, tools, Path(uv).parent, Path("/usr/local/bin"), Path("/usr/bin"), Path("/bin"))))
    executable = tools / "battuta-packaging"
    units = {}
    for name, bot, profile in (("cos", "cos-bot", "cos-bot"), ("manager", "manager-bot", "manager-bot"), ("worker@", "worker-%i", "worker")):
        command = shlex.join([str(executable), "run-bot", "--root", str(root), "--bot", bot, "--env-file", str(env_file), "--node", str(node), "--mode", "service"])
        units[f"battuta-{name}.service"] = f'''[Unit]
Description=Battuta {name} bot
After=network-online.target battuta-memory.service
Wants=network-online.target battuta-memory.service

[Service]
Type=simple
WorkingDirectory={root}/bots/{profile}
Environment="PATH={path_value}"
UMask=0077
ExecStart=/usr/bin/script -q -e -c "{command}" /dev/null
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
'''
    for component in ("memory", "artifacts", "speech"):
        extra = "Environment=MCP_MEMORY_ONNX_ALLOW_DOWNLOAD=false\n" if component == "memory" else "NoNewPrivileges=true\nProtectSystem=strict\nProtectHome=read-only\n"
        preflight = f"ExecStartPre={executable} verify-speech\n" if component == "speech" else ""
        units[f"battuta-{component}.service"] = f'''[Unit]
Description=Battuta {component}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment="PATH={path_value}"
Environment=HOME={Path.home()}
Environment=PYTHONDONTWRITEBYTECODE=1
UMask=0077
{preflight}ExecStart={executable} run-component --component {component} --env-file {env_file}
Restart=on-failure
RestartSec=5
{extra}
[Install]
WantedBy=default.target
'''
    directory = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd/user"
    for parent in (directory.parent.parent, directory.parent, directory):
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise click.ClickException(f"Unsafe service directory: {parent}")
    for name, content in units.items():
        target = directory / name
        if target.is_symlink() or (target.exists() and (not target.is_file() or (not replace and target.read_text() != content))):
            raise click.ClickException(f"Conflicting service file: {target}; ask the owner before replacement")
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in units.items():
        with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as output:
            temporary = Path(output.name)
            try:
                output.write(content)
                output.close()
                temporary.replace(directory / name)
            finally:
                temporary.unlink(missing_ok=True)
    selected = ["battuta-memory.service", "battuta-artifacts.service", "battuta-speech.service", "battuta-cos.service", "battuta-manager.service", *sorted(expected)]
    click.echo("Installed units without activation. After owner approval:\nsystemctl --user daemon-reload\nsystemctl --user enable --now " + " ".join(selected))
