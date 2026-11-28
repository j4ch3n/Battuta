/** The longest shell sleep a worker may take while a Claude run is active. */
export const MAX_SLEEP_SECONDS = 60;

export const LONG_SLEEP = `While a Claude run is active, sleep at most ${MAX_SLEEP_SECONDS} seconds at a time: Claude's requests and the run's result reach you only after this command ends. End your turn to wait, or repeat short sleeps, and never send delegate_status alongside a sleep.`;

const SLEEP = /(?:^|[;&|(\n]|\bdo\b|\bthen\b|\belse\b)\s*sleep\b([^;&|)\n]*)/g;
const UNIT: Record<string, number> = { "": 1, s: 1, m: 60, h: 3600, d: 86400 };

/** Seconds one `sleep` operand asks for, as GNU and BSD `sleep` read it; unreadable operands count as forever. */
function seconds(operand: string): number {
  const match = /^(\d+(?:\.\d*)?|\.\d+)([smhd]?)$/.exec(operand);
  return match ? Number(match[1]) * UNIT[match[2]] : Infinity;
}

/** True when the command runs a `sleep` longer than the limit; GNU `sleep` adds up several operands. */
export function isLongSleep(command: string): boolean {
  for (const [, args] of command.matchAll(SLEEP)) {
    const operands = args.trim().split(/\s+/).filter(Boolean);
    if (operands.reduce((total, operand) => total + seconds(operand), 0) > MAX_SLEEP_SECONDS)
      return true;
  }
  return false;
}
