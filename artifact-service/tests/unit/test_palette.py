import pytest

from battuta_artifacts.palette import PALETTE, project_colour


def contrast(paint: str, ink: str) -> float:
    def luminance(colour):
        channels = [int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        r, g, b = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    light, dark = sorted((luminance(paint), luminance(ink)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


@pytest.mark.parametrize("project", [None, ""], ids=["none", "empty"])
def test_unassigned_work_is_black(project):
    assert project_colour(project) == {"paint": "#000000", "ink": "#FFFFFF"}


def test_colour_is_stable_and_drawn_from_the_palette():
    assert project_colour("Battuta") == project_colour("Battuta")
    picks = {project_colour(f"project-{n}")["paint"] for n in range(200)}
    assert picks == {paint for paint, _ in PALETTE}


@pytest.mark.parametrize(("paint", "ink"), PALETTE)
def test_every_paint_keeps_small_text_readable(paint, ink):
    assert contrast(paint, ink) >= 4.5
