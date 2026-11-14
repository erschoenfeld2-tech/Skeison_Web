"""Mesh-Dateien schreiben (STL binaer, 3MF) ohne externe Abhaengigkeiten.

Wird vom Backend (Demo-Modus) UND vom Blender-Skript genutzt,
deshalb nur Python-Standardbibliothek.
Einheit ueberall: Millimeter.
"""
from __future__ import annotations

import math
import struct
import zipfile
from typing import Iterable, Sequence

Vec = Sequence[float]
Tri = Sequence[int]


def _normal(a: Vec, b: Vec, c: Vec) -> tuple[float, float, float]:
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return nx / ln, ny / ln, nz / ln


def write_stl(path: str, verts: Sequence[Vec], tris: Iterable[Tri], name: str = "skeison") -> None:
    tris = list(tris)
    with open(path, "wb") as f:
        header = f"Skeison 3D | {name}".encode("ascii", "replace")[:80]
        f.write(header.ljust(80, b" "))
        f.write(struct.pack("<I", len(tris)))
        for i, j, k in tris:
            a, b, c = verts[i], verts[j], verts[k]
            f.write(struct.pack("<3f", *_normal(a, b, c)))
            f.write(struct.pack("<3f", *a))
            f.write(struct.pack("<3f", *b))
            f.write(struct.pack("<3f", *c))
            f.write(b"\x00\x00")


_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    "</Types>"
)
_RELS = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
    'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    "</Relationships>"
)


def _xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def write_3mf(path: str, verts: Sequence[Vec], tris: Iterable[Tri], name: str = "skeison") -> None:
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="de-DE" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        f'<metadata name="Title">{_xml_escape(name)}</metadata>'
        '<metadata name="Application">Skeison 3D</metadata>'
        f'<resources><object id="1" type="model" name="{_xml_escape(name)}"><mesh><vertices>'
    ]
    parts.extend(f'<vertex x="{v[0]:.4f}" y="{v[1]:.4f}" z="{v[2]:.4f}"/>' for v in verts)
    parts.append("</vertices><triangles>")
    parts.extend(f'<triangle v1="{i}" v2="{j}" v3="{k}"/>' for i, j, k in tris)
    parts.append('</triangles></mesh></object></resources><build><item objectid="1"/></build></model>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("3D/3dmodel.model", "".join(parts))


def demo_vase(size_mm: float = 80.0, segments: int = 64, rings: int = 48):
    """Geschlossene, wasserdichte Demo-Form (gedrehte Vase) fuer den Demo-Modus."""
    h = size_mm
    verts: list[tuple[float, float, float]] = []
    tris: list[tuple[int, int, int]] = []
    for r in range(rings + 1):
        t = r / rings
        z = t * h
        radius = h * (0.22 + 0.10 * math.sin(t * math.pi * 1.6) + 0.04 * math.sin(t * math.pi * 6))
        for s in range(segments):
            a = 2 * math.pi * s / segments
            twist = 0.06 * math.sin(a * 5 + t * 4)
            verts.append(((radius + h * twist * 0.2) * math.cos(a), (radius + h * twist * 0.2) * math.sin(a), z))
    for r in range(rings):
        for s in range(segments):
            a = r * segments + s
            b = r * segments + (s + 1) % segments
            c = a + segments
            d = b + segments
            tris.append((a, b, d))
            tris.append((a, d, c))
    bottom = len(verts)
    verts.append((0.0, 0.0, 0.0))
    top = len(verts)
    verts.append((0.0, 0.0, h))
    last = rings * segments
    for s in range(segments):
        tris.append((bottom, (s + 1) % segments, s))
        tris.append((top, last + s, last + (s + 1) % segments))
    return verts, tris
