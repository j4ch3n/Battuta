"""Render extension-identified Markdown without allowing embedded raw HTML."""

import re

from markdown_it import MarkdownIt


def render_markdown(source: bytes) -> tuple[str, list[dict]]:
    """Return the HTML and its h2/h3 headings, each given a unique anchor id."""
    parser = MarkdownIt("js-default")
    tokens = parser.parse(source.decode("utf-8"))
    headings, used = [], set()
    for index, token in enumerate(tokens):
        if token.type != "heading_open" or token.tag not in ("h2", "h3"):
            continue
        title = tokens[index + 1].content
        base = re.sub(r"[^\w]+", "-", title.lower()).strip("-") or "section"
        anchor, suffix = base, 1
        while anchor in used:
            suffix += 1
            anchor = f"{base}-{suffix}"
        used.add(anchor)
        token.attrSet("id", anchor)
        headings.append({"id": anchor, "text": title, "level": int(token.tag[1])})
    return parser.renderer.render(tokens, parser.options, {}), headings
