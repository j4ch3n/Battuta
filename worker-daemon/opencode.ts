import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
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
type NativeClient = ReturnType<typeof OpenCode.make>;
type ClientOptions = Parameters<typeof OpenCode.make>[0];
export interface AdapterDependencies {
  service: Pick<typeof Service, "discover" | "ensure" | "headers">;
  makeClient: (options: ClientOptions) => NativeClient;
  /** Explicit native registration path; tests must use an isolated path. */
  serviceFile?: string;
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
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validRules(
  value: unknown,
): value is { action: string; resource: string; effect: "allow" | "deny" | "ask" }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (rule: unknown) =>
        record(rule) &&
        Object.keys(rule).sort().join(",") === "action,effect,resource" &&
        typeof rule.action === "string" &&
        typeof rule.resource === "string" &&
        typeof rule.effect === "string" &&
        ["allow", "deny", "ask"].includes(rule.effect),
    )
  );
}
function unrestricted(value: unknown): boolean {
  return (
    validRules(value) &&
    value.length === 1 &&
    value[0].action === "*" &&
    value[0].resource === "*" &&
    value[0].effect === "allow"
  );
}
function matchesMetadata(actual: unknown, task: TaskRow, config: WorkerConfig): boolean {
  if (!record(actual) || !record(actual.battuta)) return false;
  const values = actual.battuta;
  const expected = metadata(task, config).battuta;
  return (
    Object.keys(values).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => values[key] === value)
  );
}
function configurationConcern(entries: unknown): string | undefined {
  const unsupported = "NEEDS_CONTEXT: unsupported native permission configuration response";
  if (!Array.isArray(entries)) return unsupported;
  for (const entry of entries as unknown[]) {
    if (!record(entry)) return unsupported;
    if (entry.type === "directory") {
      if (typeof entry.path !== "string") return unsupported;
      continue;
    }
    if (entry.type !== "document" || !record(entry.info)) return unsupported;
    const document = entry.info;
    const rules: unknown[] = [document.permissions];
    if (document.agents !== undefined) {
      if (!record(document.agents)) return unsupported;
      if (document.agents.build !== undefined) {
        if (!record(document.agents.build)) return unsupported;
        rules.push(document.agents.build.permissions);
      }
    }
    for (const value of rules) {
      if (value === undefined) continue;
      if (!validRules(value)) return unsupported;
      const restricted = value.find((rule) => rule.effect !== "allow");
      if (restricted)
        return `Observed authored permission ${restricted.effect}; operator inspection required`;
    }
    if (document.experimental !== undefined) {
      if (!record(document.experimental)) return unsupported;
      const policies: unknown = document.experimental.policies;
      if (policies === undefined) continue;
      if (!Array.isArray(policies)) return unsupported;
      for (const policy of policies as unknown[]) {
        if (
          !record(policy) ||
          typeof policy.action !== "string" ||
          !["permission", "provider.use"].includes(policy.action) ||
          typeof policy.resource !== "string" ||
          typeof policy.effect !== "string" ||
          !["allow", "deny"].includes(policy.effect)
        )
          return unsupported;
        if (policy.action === "permission" && policy.effect === "deny")
          return "Observed configured permission hard-deny policy; operator inspection required";
      }
    }
  }
}
function registrationExists(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("Service registration cannot be inspected; operator inspection required", {
      cause: error,
    });
  }
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
  if (!matchesMetadata(session.metadata, task, config))
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
  // Pinned 2.0.24 Service fallback path, passed explicitly to both lifecycle calls.
  const serviceFile =
    dependencies.serviceFile ??
    join(
      process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
      "opencode",
      "service.json",
    );
  if (!isAbsolute(serviceFile)) throw new Error("Service registration path must be absolute");
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
    const discovered = await dependencies.service.discover({
      file: serviceFile,
      version: () => true,
    });
    if (discovered) return discovered;
    if (registrationExists(serviceFile))
      throw new Error("Existing service requires operator inspection");
    // Refuse observed existing registrations without reading their contents. The
    // synchronous hook rechecks absence before native ensure's first startup announcement.
    return dependencies.service.ensure({
      file: serviceFile,
      // Throw rather than return false: ensure interprets false as replacement, and its
      // onStart callback is invoked only once even across later polling iterations.
      version(version) {
        if (version !== VERSION)
          throw new Error("Incompatible service version; operator inspection required");
        return true;
      },
      onStart(reason) {
        if (reason !== "missing" || registrationExists(serviceFile))
          throw new Error("Existing service requires operator inspection");
      },
    });
  }).catch(() => {
    throw new Error(
      "OpenCode service discovery/start unavailable; operator inspection required (refusing observed existing registrations)",
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
  async function permissionsConcern(session: NativeSession): Promise<string | undefined> {
    const rules = session.permissions;
    if (!unrestricted(rules))
      return "NEEDS_CONTEXT: returned session permissions are not unrestricted";
    const location = { directory: session.location.directory };
    const entries = await read((signal) => client.config.get({ location }, { signal }));
    // Observations are not universal policy proof. Dynamic Console restrictions remain
    // enforced by OpenCode; absence of observable denies is sufficient for admission.
    return configurationConcern(entries);
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
        if (!unrestricted(session.permissions))
          throw new Error("Returned permissions not unrestricted");
      } catch {
        throw new Error(
          "Session create response or permissions uncertain; inspect native sessions before retrying",
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
      const concern = await permissionsConcern(session);
      if (concern) throw new Error(concern);
      const pending = await read((signal) =>
        client.permission.list({ sessionID: sessionId }, { signal }),
      );
      if (!Array.isArray(pending))
        throw new Error("Unsupported native pending permission response");
      if (pending.length)
        throw new Error("Native permission requests pending; human/operator decision required");
      const text = buildPrompt(task);
      const id = initialPromptId(task.id);
      const admitted = await bounded(
        (signal) =>
          client.session.prompt(
            {
              sessionID: sessionId,
              id,
              text,
              delivery: "queue",
              resume: true,
              metadata: metadata(task, config),
            },
            { signal },
          ),
        true,
      );
      if (
        !admitted ||
        admitted.id !== id ||
        admitted.sessionID !== sessionId ||
        admitted.type !== "user" ||
        admitted.delivery !== "queue" ||
        admitted.payload?.text !== text ||
        !matchesMetadata(admitted.payload.metadata, task, config)
      )
        throw new Error(
          "Prompt admission response uncertain; inspect inbox/history before retrying",
        );
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
      if (
        !record(active) ||
        !Array.isArray(inbox) ||
        !Array.isArray(forms) ||
        !Array.isArray(pendingPermissions)
      )
        throw new Error(
          "Unsupported native execution state response; operator inspection required",
        );
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
        originals.some(
          (m) =>
            m.type !== "user" ||
            m.text !== buildPrompt(task) ||
            (m.metadata !== undefined && !matchesMetadata(m.metadata, task, config)),
        ) ||
        queued.some(
          (m) =>
            m.type !== "user" ||
            m.sessionID !== sessionID ||
            m.delivery !== "queue" ||
            m.payload.text !== buildPrompt(task) ||
            (m.payload.metadata !== undefined &&
              !matchesMetadata(m.payload.metadata, task, config)),
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
