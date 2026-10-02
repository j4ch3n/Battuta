#!/usr/bin/env python3
"""Explicit project registry and shared memory helper."""
import argparse
from pathlib import Path
import sys

# Release builds place locked third-party dependencies here; no installation is
# needed on the bot host.
_VENDOR = Path(__file__).resolve().parent / "vendor"
if _VENDOR.is_dir():
    sys.path.insert(0, str(_VENDOR))

from project_context_lib import load_project, read_memory, write_memory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    show = sub.add_parser("show")
    show.add_argument("name")
    show.add_argument("checkout", nargs="?", type=Path)
    read = sub.add_parser("read")
    read.add_argument("name")
    write = sub.add_parser("write")
    write.add_argument("name")
    write.add_argument("text")
    args = parser.parse_args()
    project = load_project(args.name, getattr(args, "checkout", None))
    if args.command == "show":
        print(project)
    elif args.command == "read":
        print(read_memory(project), end="")
    else:
        print(write_memory(project, args.text))


if __name__ == "__main__":
    main()
