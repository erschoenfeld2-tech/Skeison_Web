"""Tests mit ECHTEM Blender (bpy-Modul oder blender-Programm); ohne Blender werden sie uebersprungen.
Pruefen: Schrift als Boolean-Operand wirkt, Boolean ohne Wirkung wird gemeldet, Vorschau ist farbig (Blender 5.3: leerer Materialplatz).
Aufruf: python test_blender.py  (BLENDER_BIN=... nutzt blender.exe, sonst ein installiertes bpy: pip install bpy)
Wird auch von test_worker.py aufgerufen."""
import json
import os
import subprocess
import sys
import tempfile
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
CAD = os.path.join(HERE, "blender", "cadmodel.py")
FAILED = []
# ohne Vorschau-Einstellungen aus anderen Tests (test_worker.py setzt BLENDER_PREVIEW_ENGINE=Workbench, SAMPLES=abc)
ENV = {k: v for k, v in os.environ.items() if not k.startswith("BLENDER_PREVIEW")}


def check(label, cond):
    print(("  ok    " if cond else "  FEHLER ") + label)
    if not cond:
        FAILED.append(label)


def blender_cmd(script, out):
    args = ["--script", script, "--out-glb", out + ".glb", "--preview", out + ".png", "--settings", "{}"]
    exe = os.environ.get("BLENDER_BIN")
    if exe:
        return [exe, "-b", "--factory-startup", "-noaudio", "-P", CAD, "--"] + args
    shim = ("import os, runpy, sys\nsys.argv = ['blender', '--'] + sys.argv[1:]\n"
            "try:\n    runpy.run_path(%r, run_name='__main__')\nexcept SystemExit as e:\n    os._exit(e.code if isinstance(e.code, int) else 1)\n"
            "sys.stdout.flush()\nos._exit(0)\n" % CAD)
    return [sys.executable, "-c", shim] + args


def run(tmp, name, source):
    script = os.path.join(tmp, name + ".py")
    open(script, "w", encoding="utf-8").write(textwrap.dedent(source))
    r = subprocess.run(blender_cmd(script, os.path.join(tmp, name)), capture_output=True, text=True, timeout=600, env=ENV)
    lines = [l for l in r.stdout.splitlines() if l.startswith("SKEISON_RESULT")]
    return (json.loads(lines[-1][len("SKEISON_RESULT "):]) if lines else {}), os.path.join(tmp, name)


def available():
    if os.environ.get("BLENDER_BIN"):
        return True
    # In einem eigenen Prozess pruefen: test_worker.py legt im eigenen Prozess ein Fake-bpy ab, das hier nicht zaehlt
    r = subprocess.run([sys.executable, "-c", "import bpy; print(bpy.app.version_string)"], capture_output=True, text=True)
    return r.returncode == 0 and bool(r.stdout.strip())


BODY = """
import bmesh, math
from mathutils import Vector
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=40, radius2=40, depth=90)
bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0, 0, 45)))
body = mesh_object("koerper", bm)
"""


def main():
    if not available():
        print("== 5. Echter Blender: uebersprungen (weder BLENDER_BIN noch bpy vorhanden)")
        return
    print("== 5. Echter Blender")
    tmp = tempfile.mkdtemp(prefix="skeison-bl-")
    res, base = run(tmp, "schrift", BODY + """
txt = text_object("txt", "SKEISON", size=9, depth=2.4)
txt.rotation_euler = (math.pi / 2, 0, 0)
txt.location = (0, -40, 55)
boolean(body, txt, "UNION")
""")
    print("  Blender", res.get("blender"))
    size = res.get("size_mm") or [0, 0, 0]
    check("Schrift (Kurve) als Boolean-Operand: ragt 1,2 mm aus der Wand (Tiefe 81,2 statt 80,0)", abs(size[1] - 81.2) < 0.3)
    check("Schrift: keine Warnung, Modell geschlossen", not res.get("warnings") and res.get("exact") is True)
    res, _ = run(tmp, "innen", BODY + """
bm2 = bmesh.new(); bmesh.ops.create_cube(bm2, size=5)
bmesh.ops.translate(bm2, verts=bm2.verts, vec=Vector((0, 0, 45)))
boolean(body, mesh_object("innen", bm2), "UNION")
""")
    check("Boolean ohne Wirkung (Operand ganz im Koerper) wird als Warnung gemeldet",
          any("KEINE Wirkung" in w for w in res.get("warnings", [])))
    res, base = run(tmp, "farben", BODY + """
bm2 = bmesh.new(); bmesh.ops.create_cube(bm2, size=10)
bmesh.ops.translate(bm2, verts=bm2.verts, vec=Vector((0, 0, 20)))
boolean(body, mesh_object("kante", bm2), "DIFFERENCE")
""")
    pngs = sorted(p for p in os.listdir(tmp) if p.startswith("farben_") and p.endswith(".png"))
    px = None
    if not pngs:
        check("Vorschaubild wurde erzeugt", False)
        return
    try:
        from PIL import Image
        im = Image.open(os.path.join(tmp, pngs[0])).convert("RGB")
        px = [(r / 255, g / 255, b / 255) for r, g, b in im.getdata()]
    except ImportError:
        try:
            import bpy
            img = bpy.data.images.load(os.path.join(tmp, pngs[0]))
            f = list(img.pixels)
            px = [(f[i], f[i + 1], f[i + 2]) for i in range(0, len(f), 4)]
        except Exception:  # noqa: BLE001
            pass
    if px is None:
        print("  --    Farbpruefung uebersprungen (weder Pillow noch bpy zum Lesen des Bildes)")
    else:
        gold = sum(1 for r, g, b in px if r > b * 1.6 and g > b * 1.3)
        check("Vorschau ist golden (nicht weiss/grau wie unter Blender 5.3 ohne materials.clear())", gold > len(px) * 0.02)


main()
if __name__ == "__main__":
    print("\nERGEBNIS:", "alle Pruefungen bestanden" if not FAILED else f"{len(FAILED)} FEHLER: " + "; ".join(FAILED))
    sys.exit(1 if FAILED else 0)
