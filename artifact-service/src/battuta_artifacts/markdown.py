"""Render extension-identified Markdown without allowing embedded raw HTML."""

from markdown_it import MarkdownIt


def render_markdown(source: bytes) -> str:
    return MarkdownIt("js-default").render(source.decode("utf-8"))
