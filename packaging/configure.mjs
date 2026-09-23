import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shared = readFileSync(join(root, 'bots/AGENTS_shared.md'), 'utf8');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env.prod`);
  return value;
}

const owner = Number(required('TELEGRAM_ALLOWED_USER_ID'));
if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('Invalid TELEGRAM_ALLOWED_USER_ID');
required('LINEAR_API_KEY');
required('SUPABASE_URL');
required('SUPABASE_SECRET_KEY');

for (const [role, prefix] of [['pm-bot', 'PM'], ['tech-lead-bot', 'TECH_LEAD']]) {
  const dir = join(root, 'bots', role);
  const token = required(`${prefix}_TELEGRAM_TOKEN`);
  const [id, secret] = token.split(':');
  const botId = Number(id);
  if (!secret || !Number.isSafeInteger(botId) || botId <= 0) throw new Error(`Invalid ${prefix}_TELEGRAM_TOKEN`);
  const username = (process.env[`${prefix}_TELEGRAM_BOT_USERNAME`] || '').replace(/^@/, '');
  if (username && !/^[a-zA-Z0-9_]+$/.test(username)) throw new Error(`Invalid ${prefix}_TELEGRAM_BOT_USERNAME`);
  const telegram = { profiles: { default: { botToken: token, allowedUserId: owner, botId } } };
  if (username) telegram.profiles.default.botUsername = username;
  writeFileSync(join(dir, '.pi/telegram.json'), JSON.stringify(telegram, null, 2), { mode: 0o600 });
  writeFileSync(join(dir, '.pi/mcp.json'), JSON.stringify({ mcpServers: { linear: {
    url: 'https://mcp.linear.app/mcp', auth: 'bearer', bearerTokenEnv: 'LINEAR_API_KEY',
  } } }, null, 2), { mode: 0o600 });
  writeFileSync(join(dir, 'AGENTS.md'), shared + '\n' + readFileSync(join(dir, 'AGENTS_dedicated.md'), 'utf8'));
}
console.log('Configured both bots. Run bin/battuta start-prod.');
