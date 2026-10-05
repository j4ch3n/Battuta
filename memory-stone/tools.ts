import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryRuntime } from "./lifecycle.ts";
import { registerSearch } from "./tools/search.ts";
import { registerList } from "./tools/list.ts";
import { registerOpen } from "./tools/open.ts";
import { registerRemember } from "./tools/remember.ts";
import { registerForget } from "./tools/forget.ts";

export function registerTools(pi: ExtensionAPI, runtime: MemoryRuntime) {
  for (const register of [
    registerSearch,
    registerList,
    registerOpen,
    registerRemember,
    registerForget,
  ])
    register(pi, runtime);
}
