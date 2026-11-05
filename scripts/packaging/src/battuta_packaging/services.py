"""Install owned user units; replacement requires explicit operator approval."""

import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import click


def install_services(root: Path, *, replace: bool = False) -> None:
    root = root.resolve()
    home = Path.home()
    try:
        tool_bin = subprocess.check_output(["uv", "tool", "dir", "--bin"], text=True).strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise click.ClickException("uv tool dir --bin must succeed before installing services") from error
    uv_bin = str(Path(shutil.which("uv")).parent)
    if not Path(tool_bin).is_absolute() or any(re.search(r"[^a-zA-Z0-9_./-]", str(path)) for path in (root, home, tool_bin, uv_bin)):
        raise click.ClickException("Install path must not contain spaces or systemd special characters")
    service_path = f'{tool_bin}:{uv_bin}:/usr/local/bin:/usr/bin:/bin'
    directory = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "systemd/user"
    units = {}
    for role in ("cos", "manager", "worker"):
        bot_dir = root / ("bots/worker" if role == "worker" else f"bots/{role}-bot")
        command = f"{root}/bin/battuta {role}"
        if role == "worker":
            command += f" --bot-dir {bot_dir}"
        units[f"battuta-{role}.service"] = f'''[Unit]
Description=Battuta {role.upper()} bot
After=network-online.target battuta-memory.service
Wants=network-online.target battuta-memory.service

[Service]
Type=simple
WorkingDirectory={bot_dir}
Environment="PATH={service_path}"
UMask=0077
# Pi needs a terminal even when supervised by systemd.
ExecStart=/usr/bin/script -q -e -c "{command}" /dev/null
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
'''
    units["battuta-memory.service"] = f'''[Unit]
Description=Battuta shared memory MCP
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={root}
Environment="PATH={service_path}"
Environment=HOME={home}
Environment=MCP_MEMORY_ONNX_ALLOW_DOWNLOAD=false
UMask=0077
ExecStart={root}/bin/battuta memory
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
'''
    units["battuta-artifacts.service"] = f'''[Unit]
Description=Battuta artifact catalog
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={root}
Environment="PATH={service_path}"
Environment=HOME={home}
Environment=PYTHONDONTWRITEBYTECODE=1
UMask=0077
ExecStart={root}/bin/battuta artifacts
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=default.target
'''
    for name, content in units.items():
        path = directory / name
        if path.is_symlink() or (path.exists() and (not path.is_file() or (not replace and path.read_text() != content))):
            raise click.ClickException(f"{path} already exists with different contents; move it aside before reinstalling")
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in units.items():
        path = directory / name
        if replace:
            with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as output:
                temporary = Path(output.name)
                try:
                    output.write(content)
                    output.close()
                    temporary.replace(path)
                finally:
                    temporary.unlink(missing_ok=True)
            click.echo(path)
            continue
        try:
            with path.open("x") as output:
                output.write(content)
        except FileExistsError:
            if path.is_symlink() or path.read_text() != content:
                raise click.ClickException(f"Refusing to replace existing service: {path}")
        click.echo(path)
    click.echo("Run systemctl --user daemon-reload, then enable the services you want.")
