"""Serve the run-scoped Write toolkit over stdio with Battuta's store rules and our embedder."""
import sys

from agent_memory.core import toolkit
from agent_memory.mcp import write_session

from .toolkit_store import battuta_store_factory

if __name__ == "__main__":
    toolkit.Store = battuta_store_factory
    sys.exit(write_session.main())
