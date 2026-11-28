"""Stable paint colours for projects, shared by every page and new bundles."""

from hashlib import sha256

# (paint, ink): each ink keeps small text at 4.5:1 or better on its paint.
PALETTE = (
    ("#D6001C", "#FFFFFF"),  # Chili Red
    ("#F6C800", "#000000"),  # Sunny Yellow
    ("#23806F", "#FFFFFF"),  # Ocean Green
    ("#1F5BD6", "#FFFFFF"),  # Blazing Blue
    ("#D04600", "#FFFFFF"),  # Volcanic Orange
    ("#9CCC2E", "#000000"),  # Zesty Lime
    ("#E4007C", "#FFFFFF"),  # Rooftop Pink
    ("#00A3E0", "#000000"),  # Caribbean Aqua
    ("#6B3FA0", "#FFFFFF"),  # Enigmatic Violet
    ("#1E4D2B", "#FFFFFF"),  # Racing Green
    ("#8C1D40", "#FFFFFF"),  # Burgundy
    ("#A58BFF", "#000000"),  # Lilac
)


def project_colour(project: str | None) -> dict[str, str]:
    if not project:
        return {"paint": "#000000", "ink": "#FFFFFF"}
    # Python's hash() is salted per process; colours must survive restarts.
    index = int.from_bytes(sha256(project.encode()).digest()[:8], "big") % len(PALETTE)
    paint, ink = PALETTE[index]
    return {"paint": paint, "ink": ink}
