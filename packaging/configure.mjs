import { lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
// In source this is the repository root; in a release it is the archive root.
const PACKAGE_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const BOTS_DIRECTORY = join(PACKAGE_ROOT, 'bots');
const SHARED_INSTRUCTIONS_PATH = join(BOTS_DIRECTORY, 'AGENTS_shared.md');
const SHARED_SKILL_PATH = join(BOTS_DIRECTORY, 'shared-skills', 'project-context');
const SHARED_INSTRUCTIONS = await readFile(SHARED_INSTRUCTIONS_PATH, 'utf8');
const BOT_CONFIGURATIONS = [
  {
    name: 'PM',
    directory: join(BOTS_DIRECTORY, 'pm-bot'),
  },
  {
    name: 'TECH_LEAD',
    directory: join(BOTS_DIRECTORY, 'tech-lead-bot'),
  },
].map((bot) => {
  const piDirectory = join(bot.directory, '.pi');
  return {
    ...bot,
    dedicatedInstructionsPath: join(bot.directory, 'AGENTS_dedicated.md'),
    piDirectory,
    skillsDirectory: join(piDirectory, 'skills'),
    skillLinkPath: join(piDirectory, 'skills', 'project-context'),
    telegramConfigPath: join(piDirectory, 'telegram.json'),
    mcpConfigPath: join(piDirectory, 'mcp.json'),
    outputInstructionsPath: join(bot.directory, 'AGENTS.md'),
  };
});

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

for (const bot of BOT_CONFIGURATIONS) {
  await mkdir(bot.skillsDirectory, { recursive: true });
  // Keep the link relative so it still resolves after the release archive is moved.
  const skillLinkTarget = relative(bot.skillsDirectory, SHARED_SKILL_PATH);
  try {
    const stat = await lstat(bot.skillLinkPath);
    if (!stat.isSymbolicLink() || await readlink(bot.skillLinkPath) !== skillLinkTarget) {
      throw new Error(`Refusing to replace existing skill: ${bot.skillLinkPath}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(skillLinkTarget, bot.skillLinkPath, 'dir');
  }

  const token = required(`${bot.name}_TELEGRAM_TOKEN`);
  const [id, secret] = token.split(':');
  const botId = Number(id);
  if (!secret || !Number.isSafeInteger(botId) || botId <= 0) throw new Error(`Invalid ${bot.name}_TELEGRAM_TOKEN`);
  const username = (process.env[`${bot.name}_TELEGRAM_BOT_USERNAME`] || '').replace(/^@/, '');
  if (username && !/^[a-zA-Z0-9_]+$/.test(username)) throw new Error(`Invalid ${bot.name}_TELEGRAM_BOT_USERNAME`);

  const telegram = { profiles: { default: { botToken: token, allowedUserId: owner, botId } } };
  if (username) telegram.profiles.default.botUsername = username;
  const mcpConfig = {
    mcpServers: {
      linear: {
        url: 'https://mcp.linear.app/mcp',
        auth: 'bearer',
        bearerTokenEnv: 'LINEAR_API_KEY',
      },
    },
  };
  const mcpConfigJson = JSON.stringify(mcpConfig, null, 2);
  const dedicatedInstructions = await readFile(bot.dedicatedInstructionsPath, 'utf8');
  const instructions = SHARED_INSTRUCTIONS + '\n' + dedicatedInstructions;

  await writeFile(bot.telegramConfigPath, JSON.stringify(telegram, null, 2), { mode: 0o600 });
  await writeFile(bot.mcpConfigPath, mcpConfigJson, { mode: 0o600 });
  await writeFile(bot.outputInstructionsPath, instructions);
}
console.log('Configured both bots. Run bin/battuta start-prod.');
