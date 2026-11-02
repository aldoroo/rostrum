"""The fragment shader of the table: two faults that turn the whole table black or differ between GPUs"""
from __future__ import annotations

import re
from pathlib import Path

SCENE = Path(__file__).resolve().parents[1] / "scene.js"


def _fragment() -> str:
    match = re.search(r"const SCENE_FRAGMENT = `(.*?)`;", SCENE.read_text(encoding="utf-8"), re.S)
    assert match, "scene.js has no SCENE_FRAGMENT"
    return match.group(1)


def test_smoothstep_edges_rise():
    # GLSL leaves smoothstep undefined when the first edge is not below the second
    literal = re.compile(r"smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,")
    found = literal.findall(_fragment())
    assert found, "no literal smoothstep left to check, the test lost its target"
    assert not [pair for pair in found if float(pair[0]) >= float(pair[1])]
    assert "smoothstep(blur,-blur" not in _fragment()


def test_exponents_of_distances_cannot_overflow():
    # exp of a large positive value is infinity, infinity times a mask of zero is NaN, and NaN paints the pixel black.
    # A distance measured to one side goes negative on the other, so it has to be clamped first
    shader = _fragment()
    unguarded = [call for call in re.findall(r"exp\(([^;]*?)\)", shader) if "fromLeft" in call and "max(" not in call]
    assert not unguarded
    assert "exp(min(d,0.)" in shader
