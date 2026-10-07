import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import type {
  SessionInfo as NativeSession,
  SessionMessageInfo,
  SessionInboxInfo,
} from "@opencode/client";
import { initialPromptId, validateTaskRow } from "../supabase/functions/_shared/task-contracts.ts";
import type { TaskRow, TerminalReport } from "../supabase/functions/_shared/task-contracts.ts";
import type { WorkerConfig } from "./config.ts";
import { validateWorktreeLocation } from "./worktree.ts";
import { buildPrompt, parseReport } from "./prompt.ts";

const VERSION = "2.0.24";
const ADMISSION_BLOCKER =
  "NEEDS_CONTEXT: effective unrestricted permissions including Console policies cannot be established by the supported 2.0.24 API";
type NativeClient = ReturnType<typeof OpenCode.make>;
type ClientOptions = Parameters<typeof OpenCode.make>[0];
export interface AdapterDependencies {
  service: Pick<typeof Service, "discover" | "ensure" | "headers">;
  makeClient: (options: ClientOptions) => NativeClient;
}
export interface SessionInfo {
  id: string;
  directory: string;
  metadata: unknown;
}
export interface ExecutionSnapshot {
  session: SessionInfo;
  valid: boolean;
  validationError?: string;
  permissionsConcern?: string;
  active: boolean;
  pendingInputs: unknown[];
  pendingForms: unknown[];
  pendingPermissions: unknown[];
  initialInputAdmitted: boolean;
  report?: TerminalReport;
  reportError?: string;
}
export interface OpenCodeAdapter {
  /** Check before claiming new work; inspection of existing bound work remains available. */
  readonly admissionBlocker: string | null;
  listSessions(): Promise<SessionInfo[]>;
  create(task: TaskRow, directory: string): Promise<SessionInfo>;
  admit(task: TaskRow, sessionId: string): Promise<void>;
  inspect(task: TaskRow): Promise<ExecutionSnapshot>;
  events(signal: AbortSignal): AsyncIterable<unknown>;
  close(): Promise<void>;
}
function info(session: NativeSession): SessionInfo {
  if (!session || typeof session.id !== "string" || typeof session.location?.directory !== "string")
    throw new Error("Invalid native session response");
  return { id: session.id, directory: session.location.directory, metadata: session.metadata };
}
function metadata(task: TaskRow, config: WorkerConfig) {
  return {
    battuta: {
      schema_version: 1,
      task_id: task.id,
      worker_id: config.workerId,
      delegator_role: task.delegator_role,
    },
  };
}
function owned(task: TaskRow, config: WorkerConfig): void {
  validateTaskRow(task);
  if (
    task.claimed_by !== config.workerId ||
    task.terminal_report !== null ||
    !Object.hasOwn(config.projects, task.project)
  )
    throw new Error("Task ownership or project mismatch");
}
function binding(task: TaskRow, session: NativeSession, config: WorkerConfig): void {
  const actual: unknown = session.metadata?.battuta;
  if (!actual || typeof actual !== "object" || Array.isArray(actual))
    throw new Error("Session metadata mismatch");
  const values = actual as Record<string, unknown>;
  const expected = metadata(task, config).battuta;
  if (
    Object.keys(values).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => values[key] !== value)
  )
    throw new Error("Session metadata mismatch");
  if (
    session.agent !== "build" ||
    session.parentID !== undefined ||
    (task.opencode_session_id !== null && session.id !== task.opencode_session_id)
  )
    throw new Error("Session binding or agent mismatch");
  if (
    config.model &&
    (session.model?.id !== config.model.modelID ||
      session.model.providerID !== config.model.providerID)
  )
    throw new Error("Session model mismatch");
}
export async function createOpenCodeAdapter(
  config: WorkerConfig,
  dependencies: AdapterDependencies = { service: Service, makeClient: OpenCode.make },
): Promise<OpenCodeAdapter> {
  const lifetime = new AbortController();
  async function bounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    write = false,
  ): Promise<T> {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, lifetime.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("request interrupted")), {
        once: true,
      });
      timer = setTimeout(() => controller.abort(), write ? 30000 : 10000);
    });
    try {
      signal.throwIfAborted();
      return await Promise.race([operation(signal), aborted]);
    } catch {
      throw new Error(
        write
          ? "OpenCode write uncertain; preserve task binding and inspect before any retry"
          : "OpenCode read unavailable; pause admission and inspect service",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const endpoint = await bounded(async () => {
    const discovered = await dependencies.service.discover({ version: () => true });
    if (discovered) return discovered;
    // 2.0.24 ensure can terminate incompatible/unresponsive registrations. Throw at its
    // pre-mutation onStart hook, including 'missing', rather than risk a later replacement.
    // Service lifecycle is human-owned; this adapter can only ensure/reuse an existing service.
    return dependencies.service.ensure({
      version: VERSION,
      onStart() {
        throw new Error("Human/operator must start or inspect the shared OpenCode service");
      },
    });
  }).catch(() => {
    throw new Error(
      "Human/operator must supply a healthy shared OpenCode service; no service was intentionally started or replaced",
    );
  });
  const client = dependencies.makeClient({
    baseUrl: endpoint.url,
    headers: dependencies.service.headers(endpoint),
  });
  const server = await bounded((signal) => client.server.info({ signal }));
  if (server?.version !== VERSION)
    throw new Error(
      `OpenCode server version must match pinned client ${VERSION}; operator upgrade required (service left untouched)`,
    );
  const read = <T>(operation: (signal: AbortSignal) => Promise<T>) => bounded(operation);
  async function pages<T>(
    fetchPage: (cursor?: string) => Promise<{ data: T[]; cursor: { next?: string | null } }>,
  ): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await fetchPage(cursor);
      if (!page || !Array.isArray(page.data) || !page.cursor)
        throw new Error("Invalid native pagination response");
      items.push(...page.data);
      cursor = page.cursor.next ?? undefined;
      if (cursor && seen.has(cursor))
        throw new Error("Repeated native pagination cursor; operator inspection required");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }
  async function permissionsConcern(session: NativeSession): Promise<string> {
    const rules = session.permissions;
    if (
      !rules ||
      rules.length !== 1 ||
      rules[0].action !== "*" ||
      rules[0].resource !== "*" ||
      rules[0].effect !== "allow"
    )
      return "NEEDS_CONTEXT: returned session permissions are not unrestricted";
    const location = { directory: session.location.directory };
    const [entries, agent] = await Promise.all([
      read((signal) => client.config.get({ location }, { signal })),
      read((signal) => client.agent.get({ agentID: "build", location }, { signal })),
    ]);
    if (!Array.isArray(entries) || !agent?.data?.permissions)
      return "NEEDS_CONTEXT: native permission configuration is unavailable";
    if (
      entries.some(
        (entry) =>
          entry.type === "document" &&
          entry.info.experimental?.policies?.some(
            (policy) => policy.action === "permission" && policy.effect === "deny",
          ),
      )
    )
      return "NEEDS_CONTEXT: configured permission hard-deny policy prevents establishing unrestricted execution";
    // Config entries expose authored policies, not a documented effective policy evaluation
    // including Console authority. An empty list is NOT proof that no hard deny is enforced.
    return ADMISSION_BLOCKER;
  }
  async function get(task: TaskRow): Promise<NativeSession> {
    owned(task, config);
    if (!task.opencode_session_id)
      throw new Error("Task session binding missing; operator inspection required");
    return read((signal) =>
      client.session.get({ sessionID: task.opencode_session_id! }, { signal }),
    );
  }
  async function validate(task: TaskRow, session: NativeSession): Promise<void> {
    binding(task, session, config);
    await validateWorktreeLocation(task, config, session.location.directory);
  }
  return {
    admissionBlocker: ADMISSION_BLOCKER,
    async listSessions() {
      return (
        await pages((cursor) =>
          read((signal) => client.session.list({ order: "asc", cursor }, { signal })),
        )
      ).map(info);
    },
    async create(task, directory) {
      owned(task, config);
      if (task.opencode_session_id !== null) throw new Error("Fresh unbound task required");
      await validateWorktreeLocation(task, config, directory);
      const session = await bounded(
        (signal) =>
          client.session.create(
            {
              agent: "build",
              ...(config.model
                ? { model: { providerID: config.model.providerID, id: config.model.modelID } }
                : {}),
              location: { directory },
              metadata: metadata(task, config),
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
            },
            { signal },
          ),
        true,
      );
      // A rejected/malformed response may still have created a session; never create again blindly.
      try {
        await validate(task, session);
      } catch {
        throw new Error(
          "Session create response uncertain; inspect native sessions before retrying",
        );
      }
      return info(session);
    },
    async admit(task, sessionId) {
      owned(task, config);
      if (task.opencode_session_id !== sessionId)
        throw new Error("Persisted session binding required before admission");
      const session = await get(task);
      await validate(task, session);
      // No permission bypass/approval or mutation of global configuration is permitted.
      throw new Error(await permissionsConcern(session));
    },
    async inspect(task) {
      const session = await get(task);
      const snapshot: ExecutionSnapshot = {
        session: info(session),
        valid: false,
        active: false,
        pendingInputs: [],
        pendingForms: [],
        pendingPermissions: [],
        initialInputAdmitted: false,
      };
      try {
        await validate(task, session);
        snapshot.valid = true;
      } catch (error) {
        snapshot.validationError =
          error instanceof Error ? error.message : "Invalid binding/location";
        return snapshot;
      }
      snapshot.permissionsConcern = await permissionsConcern(session);
      const sessionID = session.id;
      const [active, inbox, forms, pendingPermissions, messages] = await Promise.all([
        read((signal) => client.session.active({ signal })),
        read((signal) => client.session.inbox.list({ sessionID }, { signal })),
        read((signal) => client.session.form.list({ sessionID }, { signal })),
        read((signal) => client.permission.list({ sessionID }, { signal })),
        pages((cursor) =>
          read((signal) => client.message.list({ sessionID, order: "asc", cursor }, { signal })),
        ),
      ]);
      snapshot.active = Object.hasOwn(active, sessionID);
      snapshot.pendingInputs = inbox;
      snapshot.pendingForms = forms;
      snapshot.pendingPermissions = pendingPermissions;
      const promptID = initialPromptId(task.id);
      const originals = messages.filter((message) => message.id === promptID);
      const queued = inbox.filter((input: SessionInboxInfo) => input.id === promptID);
      if (
        originals.length > 1 ||
        queued.length > 1 ||
        originals.some((m) => m.type !== "user" || m.text !== buildPrompt(task)) ||
        queued.some(
          (m) =>
            m.type !== "user" || m.sessionID !== sessionID || m.payload.text !== buildPrompt(task),
        )
      ) {
        snapshot.reportError = "Original input identity is ambiguous; operator inspection required";
        return snapshot;
      }
      snapshot.initialInputAdmitted = originals.length === 1 || queued.length === 1;
      if (snapshot.active || inbox.length || forms.length || pendingPermissions.length)
        return snapshot;
      const original = originals[0];
      if (!original) {
        snapshot.reportError =
          "Original input is not durably admitted; operator inspection required";
        return snapshot;
      }
      const assistants = messages.filter(
        (message): message is Extract<SessionMessageInfo, { type: "assistant" }> =>
          message.type === "assistant" && message.time.created > original.time.created,
      );
      assistants.sort((a, b) => b.time.created - a.time.created);
      const latest = assistants[0];
      if (
        latest &&
        (assistants[1]?.time.created === latest.time.created ||
          messages.some(
            (message) => message.type === "user" && message.time.created >= latest.time.created,
          ))
      ) {
        snapshot.reportError =
          "Latest assistant ordering/input is ambiguous; operator inspection required";
        return snapshot;
      }
      if (
        !latest ||
        !latest.time.completed ||
        latest.finish !== "stop" ||
        latest.error ||
        latest.retry ||
        latest.content.some(
          (content) =>
            content.type === "tool" &&
            (content.state.status === "running" || content.state.status === "streaming"),
        )
      ) {
        if (session.outcome || latest)
          snapshot.reportError =
            "Runtime outcome or unfinished assistant output without a final stop report; operator inspection required";
        return snapshot;
      }
      try {
        snapshot.report = parseReport(
          latest.content
            .filter((content) => content.type === "text")
            .map((content) => content.text)
            .join("\n"),
          task.instruction,
        );
      } catch (error) {
        snapshot.reportError = error instanceof Error ? error.message : "Invalid terminal report";
      }
      return snapshot;
    },
    events(signal) {
      return client.event.subscribe({ signal: AbortSignal.any([signal, lifetime.signal]) });
    },
    close() {
      lifetime.abort();
      return Promise.resolve();
    },
  };
}
