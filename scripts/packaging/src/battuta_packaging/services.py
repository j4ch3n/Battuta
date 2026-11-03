"""Install owned user units without overwriting custom service definitions."""

import os
from pathlib import Path
import re

import click


def install_services(root: Path) -> None:
    root = root.resolve()
    home = Path.home()
    if any(re.search(r"[^a-zA-Z0-9_./-]", str(path)) for path in (root, home)):
        raise click.ClickException("Install path must not contain spaces or systemd special characters")
    directory = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "systemd/user"
    units = {}
    for role in ("cos", "manager"):
        units[f"battuta-{role}.service"] = f'''[Unit]
Description=Battuta {role.upper()} bot
After=network-online.target battuta-memory.service
Wants=network-online.target battuta-memory.service

[Service]
Type=simple
WorkingDirectory={root}/bots/{role}-bot
# Pi needs a terminal to keep its interactive Telegram session running.
ExecStart=/usr/bin/script -q -e -c "{root}/bin/battuta {role}" /dev/null
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
        if path.is_symlink() or (path.exists() and (not path.is_file() or path.read_text() != content)):
            raise click.ClickException(f"{path} already exists with different contents; move it aside before reinstalling")
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in units.items():
        path = directory / name
        try:
            with path.open("x") as output:
                output.write(content)
        except FileExistsError:
            if path.is_symlink() or path.read_text() != content:
                raise click.ClickException(f"Refusing to replace existing service: {path}")
        click.echo(path)
    click.echo("Run systemctl --user daemon-reload, then enable the services you want.")
