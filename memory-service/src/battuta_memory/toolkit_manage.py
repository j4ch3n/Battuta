"""Serve the run-scoped Manage review toolkit over stdio with Battuta's store rules and our embedder."""
import sys

from agent_memory.core import manage_toolkit
from agent_memory.mcp import manage_session

from .toolkit_store import battuta_store_factory

if __name__ == "__main__":
    manage_toolkit.Store = battuta_store_factory
    sys.exit(manage_session.main())
