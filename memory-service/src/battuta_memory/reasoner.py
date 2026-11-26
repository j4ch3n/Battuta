"""The host's Claude Code CLI as the dream's reasoner, serving our toolkit modules instead of the library's."""
from agent_memory.executor import reasoners

WRITE_MODULE = "battuta_memory.toolkit_write"
MANAGE_MODULE = "battuta_memory.toolkit_manage"


def claude_reasoner(model: str) -> reasoners.ToolHostReasoner:
    # The worker is a short-lived process of our own, so pointing the library at our modules stays local.
    reasoners.WRITE_SESSION_MODULE = WRITE_MODULE
    reasoners.MANAGE_SESSION_MODULE = MANAGE_MODULE
    return reasoners.ToolHostReasoner.for_host("claude-code", model=model)
