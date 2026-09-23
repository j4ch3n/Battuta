import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const unitDir = join(configHome, 'systemd/user');
// systemd unit values do not support shell quoting; refuse paths requiring escaping.
if (/[^a-zA-Z0-9_./-]/.test(root)) throw new Error('Install path must not contain spaces or systemd special characters');

const units = [['pm', 'PM'], ['tech-lead', 'tech-lead']].map(([role, description]) => {
  const path = join(unitDir, `battuta-${role}.service`);
  const content = `[Unit]
Description=Battuta ${description} bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${root}/bots/${role}-bot
# Pi needs a terminal to keep its interactive Telegram session running.
ExecStart=/usr/bin/script -q -e -c "${root}/bin/battuta ${role}" /dev/null
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
  return { path, content };
});

// Check both units before changing either one.
for (const { path, content } of units) {
  try {
    const current = readFileSync(path, 'utf8');
    if (current !== content) throw new Error(`${path} already exists with different contents; move it aside before reinstalling`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
mkdirSync(unitDir, { recursive: true });
for (const { path, content } of units) {
  try {
    writeFileSync(path, content, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST' || readFileSync(path, 'utf8') !== content) throw error;
  }
  console.log(path);
}
console.log('Run systemctl --user daemon-reload, then enable the services you want.');
