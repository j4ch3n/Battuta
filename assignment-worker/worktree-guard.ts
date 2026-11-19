import { basename } from "node:path";

const MENTIONS_WORKTREE = /(?:^|[;&|(\n])\s*git(?:\s+-C\s+\S+)?\s+worktree\b/;
const SHELL_SYNTAX = /[;&|<>`$()\\"'\n]/;
const SAFE_TOKEN = /^[\w./@:+~-]+$/;
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type WorktreeGuard = { rewrite: string } | { block: string } | undefined;

const quote = (value: string) =>
  /^[\w.-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;

const use =
  "Use `battuta-project worktree create|list|delete <project> ...` (see the `project-management` skill)";

/**
 * Turns a plain `git worktree add|remove|list` into the matching `battuta-project worktree` command so
 * worktrees land under the project's managed folder; anything else that touches `git worktree` is blocked
 * with guidance. Commands that do not mention `git worktree` pass through (`undefined`).
 */
export function guardWorktreeCommand(
  command: string,
  boundProject: string | undefined,
): WorktreeGuard {
  const project = boundProject && quote(boundProject);
  if (!MENTIONS_WORKTREE.test(command)) return undefined;
  if (!project) return { block: `${use}; this session is not bound to a project.` };
  const tokens = command.trim().split(/\s+/);
  if (SHELL_SYNTAX.test(command) || !tokens.every((token) => SAFE_TOKEN.test(token)))
    return { block: `${use}. Run it as its own simple command; \`git worktree\` is not allowed.` };
  if (tokens[0] === "git" && tokens[1] === "-C") tokens.splice(1, 2); // the project is the session's, not -C's
  const [git, worktree, action, ...args] = tokens;
  if (git !== "git" || worktree !== "worktree" || !["add", "remove", "list"].includes(action ?? ""))
    return { block: `${use}; only create, list and delete are supported.` };

  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-b" && action === "add" && i + 1 < args.length) flags.set("branch", args[++i]);
    else if ((arg === "-f" || arg === "--force") && action === "remove") flags.set("force", true);
    else if (arg.startsWith("-"))
      return { block: `${use}; \`git worktree ${action} ${arg}\` has no equivalent.` };
    else positional.push(arg);
  }

  const name = positional[0] === undefined ? "" : basename(positional[0]);
  if (action === "list")
    return positional.length
      ? { block: `${use}.` }
      : { rewrite: `battuta-project worktree list ${project}` };
  if (!NAME.test(name) || positional.length > (action === "add" ? 2 : 1))
    return {
      block: `${use}; name the worktree in lowercase kebab-case, for example \`... ${project} fix-login\`.`,
    };
  if (action === "remove")
    return {
      rewrite: `battuta-project worktree delete ${project} ${name}${flags.has("force") ? " --force" : ""}`,
    };
  const branch = flags.has("branch") ? ` --branch ${String(flags.get("branch"))}` : "";
  const base = positional[1] ? ` --base ${positional[1]}` : "";
  return { rewrite: `battuta-project worktree create ${project} ${name}${branch}${base}` };
}
