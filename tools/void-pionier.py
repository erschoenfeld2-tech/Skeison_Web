"""Eigener Weltraum-Pionier (Schwarz/Blau) – prozedural in Blender gebaut.
usage: blender -b -P pionier.py -- OUTDIR [render]
Einheiten: Meter, Z oben, Figur schaut nach -Y.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '.'
DO_RENDER = 'render' in argv
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('Pionier'); scene.collection.children.link(col)

# ------------------------------------------------------------------ Materialien
def mat(name, rgb, metal=0.0, rough=0.5, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    m.diffuse_color = (*rgb, 1)
    return m

M = {
    'overall': mat('Overall', (0.018, 0.024, 0.045), 0.0, 0.82),
    'suit':    mat('Anzug', (0.008, 0.009, 0.012), 0.0, 0.55),
    'armor':   mat('Panzerung', (0.012, 0.018, 0.04), 0.55, 0.28, coat=0.6),
    'helmet':  mat('Helm', (0.02, 0.045, 0.14), 0.75, 0.22, coat=1.0),
    'metal':   mat('Metall', (0.16, 0.17, 0.2), 1.0, 0.32),
    'strap':   mat('Gurte', (0.03, 0.034, 0.045), 0.0, 0.7),
    'glove':   mat('Handschuh', (0.02, 0.022, 0.028), 0.0, 0.6),
    'sole':    mat('Sohle', (0.006, 0.006, 0.008), 0.0, 0.9),
    'glow':    mat('Leuchtblau', (0.05, 0.12, 0.6), 0.0, 0.4, emit=(0.18, 0.36, 1.0), strength=6.0),
    'glow_dim':mat('Leuchtblau_dezent', (0.04, 0.08, 0.3), 0.0, 0.4, emit=(0.18, 0.36, 1.0), strength=2.0),
    'visor':   mat('Visier', (0.004, 0.012, 0.04), 1.0, 0.04, coat=1.0),
    'stripe':  mat('Reflexstreifen', (0.25, 0.35, 0.7), 0.3, 0.3, emit=(0.18, 0.36, 1.0), strength=1.2),
}

# ------------------------------------------------------------------ Helfer
def link(ob, m=None, smooth=True):
    col.objects.link(ob)
    if m:
        ob.data.materials.append(m)
    if smooth and ob.type == 'MESH':
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob

def mesh_obj(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return bpy.data.objects.new(name, me)

def bevel(ob, w=0.006, seg=3):
    mo = ob.modifiers.new('bevel', 'BEVEL'); mo.width = w; mo.segments = seg; mo.limit_method = 'ANGLE'
    return ob

def subsurf(ob, lv=2):
    mo = ob.modifiers.new('subsurf', 'SUBSURF'); mo.levels = lv; mo.render_levels = lv
    return ob

def rbox(name, size, loc, m, rot=(0, 0, 0), bev=0.008, seg=3):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    ob = mesh_obj(name, bm); ob.location = loc; ob.rotation_euler = rot
    link(ob, m, smooth=False); bevel(ob, bev, seg)
    return ob

def cyl(name, r, h, loc, m, rot=(0, 0, 0), seg=40, bev=0.003, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    ob = mesh_obj(name, bm); ob.location = loc; ob.rotation_euler = rot
    link(ob, m, smooth=True)
    if bev:
        bevel(ob, bev, 2)
    mo = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); mo.keep_sharp = True
    return ob

def sphere(name, r, loc, m, scale=(1, 1, 1), seg=48):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    ob = mesh_obj(name, bm); ob.location = loc; ob.scale = scale
    return link(ob, m)

def torus(name, R, r, loc, m, rot=(0, 0, 0), scale=(1, 1, 1), seg=64, mseg=16):
    bm = bmesh.new()
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(mseg):
            b = 2 * math.pi * j / mseg
            bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
    bm.verts.ensure_lookup_table()
    for i in range(seg):
        for j in range(mseg):
            v = lambda ii, jj: bm.verts[(ii % seg) * mseg + (jj % mseg)]
            bm.faces.new((v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)))
    ob = mesh_obj(name, bm); ob.location = loc; ob.rotation_euler = rot; ob.scale = scale
    return link(ob, m)

def band(name, z, rx, ry, h, t, m, cx=0.0, cy=0.0, seg=64, tilt=0.0):
    """Ringband (Gurt) um eine Ellipse."""
    bm = bmesh.new()
    rows = []
    for (dz, dr) in [(-h / 2, 0), (h / 2, 0), (h / 2, t), (-h / 2, t)]:
        row = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            x, y = (rx + dr) * math.cos(a), (ry + dr) * math.sin(a)
            row.append(bm.verts.new((cx + x, cy + y, z + dz + tilt * y)))
        rows.append(row)
    for k in range(4):
        r0, r1 = rows[k], rows[(k + 1) % 4]
        for i in range(seg):
            bm.faces.new((r0[i], r0[(i + 1) % seg], r1[(i + 1) % seg], r1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm)
    return link(ob, m)

def strap(name, pts, normals, w, t, m):
    """Flacher Gurt entlang Punkten; normals = Richtung nach außen je Punkt."""
    bm = bmesh.new(); ring = []
    for i, p in enumerate(pts):
        p = Vector(p); n = Vector(normals[i]).normalized()
        tan = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        side = tan.cross(n).normalized() * (w / 2)
        nn = n * t
        ring.append([bm.verts.new(p - side), bm.verts.new(p + side), bm.verts.new(p + side + nn), bm.verts.new(p - side + nn)])
    for a, b in zip(ring[:-1], ring[1:]):
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(ring[0][::-1]); bm.faces.new(ring[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm); link(ob, m, smooth=False); bevel(ob, 0.0015, 1)
    return ob

def skin_body(name, verts, edges, radii, m, root=0, lv=2):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, edges, []); me.update()
    ob = bpy.data.objects.new(name, me); link(ob, m)
    mo = ob.modifiers.new('skin', 'SKIN'); mo.use_smooth_shade = True
    sv = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        sv[i].radius = r
    sv[root].use_root = True
    subsurf(ob, lv)
    return ob

S = 1.0  # Figurenhöhe ~1,80 m

# ------------------------------------------------------------------ Körper: Overall (Rumpf + Beine)
L, R = 1, -1
body_v = [
    (0, 0.00, 0.97),   # 0 Becken
    (0, 0.00, 1.10),   # 1 Bauch
    (0, 0.00, 1.27),   # 2 Brust
    (0, 0.005, 1.40),  # 3 obere Brust
    (0, 0.01, 1.50),   # 4 Halsansatz
    (0.105, 0, 0.93), (0.115, -0.01, 0.52), (0.122, 0.005, 0.12),    # 5,6,7 Bein L
    (-0.105, 0, 0.93), (-0.115, -0.01, 0.52), (-0.122, 0.005, 0.12), # 8,9,10 Bein R
    (0.19, 0.01, 1.43), (-0.19, 0.01, 1.43),                          # 11,12 Schulteransatz
]
body_e = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (0, 8), (8, 9), (9, 10), (3, 11), (3, 12)]
body_r = [(0.178, 0.135), (0.165, 0.128), (0.195, 0.137), (0.205, 0.137), (0.07, 0.07),
          (0.108, 0.108), (0.085, 0.088), (0.072, 0.074),
          (0.108, 0.108), (0.085, 0.088), (0.072, 0.074),
          (0.082, 0.082), (0.082, 0.082)]
skin_body('Overall', body_v, body_e, body_r, M['overall'])

# Hals (Unteranzug)
cyl('Hals', 0.058, 0.12, (0, 0.012, 1.56), M['suit'], bev=0)

# Arme (schwarzer Unteranzug), A-Pose
for s in (L, R):
    av = [(s * 0.19, 0.01, 1.44), (s * 0.25, 0.01, 1.42), (s * 0.36, 0.02, 1.18), (s * 0.46, -0.01, 0.95)]
    ae = [(0, 1), (1, 2), (2, 3)]
    ar = [(0.072, 0.072), (0.07, 0.07), (0.058, 0.058), (0.046, 0.046)]
    skin_body('Arm_' + ('L' if s > 0 else 'R'), av, ae, ar, M['suit'], root=0)

# ------------------------------------------------------------------ Helm
HZ = 1.72
sphere('Kopf', 0.11, (0, 0.0, HZ - 0.01), M['suit'], (0.9, 1.0, 1.1))
helm = sphere('Helm', 0.165, (0, 0.005, HZ), M['helmet'], (1.0, 1.05, 1.02), seg=64)
# Visier: breites Rundum-Glas (flaches Ellipsoid, wickelt sich um die Front)
VC, VA, VB, VH = (0, -0.06, HZ + 0.005), 0.156, 0.118, 0.086
sphere('Visier', 1.0, VC, M['visor'], (VA, VB, VH), seg=64)
# Leuchtlinie + Rahmen entlang Unter- und Oberkante des Visiers
def visor_edge(zf, grow, a0=-78, a1=78, n=40):
    k = math.sqrt(max(1 - zf ** 2, 0.0))
    pts, nrm = [], []
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / (n - 1))
        x, y = VA * k * grow * math.sin(a), -VB * k * grow * math.cos(a)
        pts.append((VC[0] + x, VC[1] + y, VC[2] + zf * VH))
        nrm.append((math.sin(a), -math.cos(a), 0))
    return pts, nrm
p, n = visor_edge(-0.86, 1.04); strap('Visierlicht', p, n, 0.008, 0.006, M['glow'])
p, n = visor_edge(-0.93, 1.06); strap('Visierrahmen_unten', p, n, 0.02, 0.012, M['armor'])
p, n = visor_edge(0.9, 1.08); strap('Visierrahmen_oben', p, n, 0.024, 0.014, M['armor'])
# Stirn-Kamm + Stirnlampe (Arbeiter-Look)
rbox('Helmkamm', (0.05, 0.27, 0.03), (0, 0.03, HZ + 0.165), M['armor'], rot=(math.radians(-8), 0, 0), bev=0.012)
rbox('Kammlicht', (0.008, 0.2, 0.006), (0, 0.04, HZ + 0.182), M['glow_dim'], rot=(math.radians(-8), 0, 0), bev=0.002, seg=1)
rbox('Stirnlampe', (0.075, 0.045, 0.032), (0, -0.142, HZ + 0.13), M['metal'], rot=(math.radians(-28), 0, 0), bev=0.009)
rbox('Lampenglas', (0.055, 0.006, 0.014), (0, -0.165, HZ + 0.125), M['glow'], rot=(math.radians(-28), 0, 0), bev=0.003, seg=1)
# Seitenmodule (Kommunikation) mit Leuchtring
for s in (L, R):
    cyl('Ohrmodul', 0.055, 0.045, (s * 0.162, 0.01, HZ - 0.005), M['armor'], rot=(0, math.radians(90), 0), bev=0.008)
    torus('Ohrring_Licht', 0.04, 0.0045, (s * 0.186, 0.01, HZ - 0.005), M['glow'], rot=(0, math.radians(90), 0), mseg=8)
    cyl('Ohrkappe', 0.025, 0.014, (s * 0.188, 0.01, HZ - 0.005), M['metal'], rot=(0, math.radians(90), 0), bev=0.003)
# Antenne links
cyl('Antenne', 0.004, 0.22, (0.17, 0.045, HZ + 0.13), M['metal'], rot=(math.radians(-6), math.radians(8), 0), bev=0)
sphere('Antennenspitze', 0.008, (0.185, 0.034, HZ + 0.24), M['glow'])
# Atemmodul (Kinn) – modern: flaches Gehäuse + Leuchtschlitze + 2 Filterzylinder
rbox('Atemmodul', (0.12, 0.065, 0.06), (0, -0.122, HZ - 0.11), M['armor'], rot=(math.radians(15), 0, 0), bev=0.016)
for i, dz in enumerate((-0.012, 0.0, 0.012)):
    rbox(f'Atemschlitz{i}', (0.055, 0.004, 0.004), (0, -0.157, HZ - 0.11 + dz), M['glow'], rot=(math.radians(15), 0, 0), bev=0.0015, seg=1)
for s in (L, R):
    cyl('Filter', 0.024, 0.04, (s * 0.078, -0.105, HZ - 0.12), M['metal'], rot=(math.radians(70), 0, math.radians(s * 35)), bev=0.005)
# Helmkragen (Dichtring)
torus('Helmkragen', 0.1, 0.03, (0, 0.01, 1.565), M['armor'], scale=(1.2, 1.05, 1.0))
torus('Kragenlicht', 0.1, 0.006, (0, 0.01, 1.594), M['glow_dim'], scale=(1.27, 1.12, 1.0), mseg=8)

# ------------------------------------------------------------------ Schultern, Brust, Gurtzeug
for s in (L, R):
    sh = sphere('Schulterpanzer', 0.095, (s * 0.23, 0.012, 1.45), M['armor'], (1.0, 1.05, 0.62))
    sh.rotation_euler = (0, math.radians(s * 22), 0)
    rbox('Schulterstreifen', (0.07, 0.012, 0.012), (s * 0.255, -0.07, 1.475), M['glow_dim'], rot=(0, math.radians(s * 22), 0), bev=0.003)

# Brusttaschen (Overall-Latz) + Reflexstreifen
for s in (L, R):
    rbox('Brusttasche', (0.09, 0.025, 0.075), (s * 0.088, -0.133, 1.29), M['overall'], bev=0.01)
    rbox('Taschenklappe', (0.092, 0.03, 0.022), (s * 0.088, -0.137, 1.325), M['strap'], bev=0.006)
    rbox('Reflexstreifen', (0.085, 0.006, 0.014), (s * 0.088, -0.146, 1.36), M['stripe'], bev=0.002, seg=1)

# Brustgurt horizontal (Band um den Oberkörper) + Schulter-/Frontgurte
band('Brustgurt', 1.39, 0.216, 0.147, 0.04, 0.012, M['strap'])
rbox('Brustschnalle', (0.08, 0.018, 0.05), (0, -0.16, 1.39), M['metal'], bev=0.006)
rbox('Schnallenlicht', (0.05, 0.006, 0.012), (0, -0.17, 1.39), M['glow'], bev=0.002, seg=1)
for s in (L, R):
    x0 = s * 0.1
    pts = [(x0 * 0.9, 0.13, 1.33), (x0, 0.1, 1.5), (x0, 0.0, 1.545), (x0, -0.09, 1.5),
           (x0 * 1.02, -0.145, 1.40), (x0 * 1.05, -0.142, 1.25), (x0 * 1.0, -0.132, 1.10), (x0 * 0.95, -0.137, 1.0)]
    nrm = [(0, 1, 0.2), (0, 0.6, 1), (0, 0, 1), (0, -0.6, 1), (0, -1, 0.2), (0, -1, 0), (0, -1, 0), (0, -1, 0)]
    strap('Tragegurt', pts, nrm, 0.042, 0.01, M['strap'])
    rbox('Gurtschnalle', (0.05, 0.015, 0.03), (x0 * 1.04, -0.152, 1.2), M['metal'], bev=0.004)

# Gürtel mit Front-Panel und Taschen
band('Guertel', 0.985, 0.181, 0.14, 0.065, 0.016, M['strap'])
rbox('Guertelpanel', (0.14, 0.03, 0.07), (0, -0.155, 0.985), M['armor'], bev=0.012)
rbox('Panel_Display', (0.08, 0.006, 0.014), (0, -0.171, 0.99), M['glow'], bev=0.002, seg=1)
for s in (L, R):
    rbox('Guerteltasche', (0.07, 0.05, 0.08), (s * 0.16, -0.085, 0.97), M['strap'], rot=(0, 0, math.radians(s * -35)), bev=0.01)
    rbox('Seitenplatte', (0.03, 0.08, 0.075), (s * 0.186, 0.03, 0.985), M['metal'], bev=0.008)

# Rucksack / Lebenserhaltung
rbox('Rucksack', (0.32, 0.12, 0.38), (0, 0.2, 1.27), M['armor'], bev=0.03, seg=4)
rbox('Rucksack_Deckel', (0.24, 0.03, 0.27), (0, 0.265, 1.29), M['helmet'], bev=0.012)
for s in (L, R):
    cyl('Tank', 0.045, 0.34, (s * 0.125, 0.26, 1.27), M['metal'], bev=0.01)
    torus('Tankring', 0.046, 0.005, (s * 0.125, 0.26, 1.37), M['glow_dim'], mseg=8)
    cyl('Duese', 0.03, 0.05, (s * 0.095, 0.21, 1.055), M['metal'], r2=0.04, bev=0.003)
    cyl('Duesenglut', 0.026, 0.004, (s * 0.095, 0.21, 1.028), M['glow'], bev=0)
rbox('Rucksack_Licht', (0.012, 0.006, 0.2), (0, 0.282, 1.29), M['glow'], bev=0.002, seg=1)

# ------------------------------------------------------------------ Arme: Unterarmschützer, Handschuhe
def along(a, b, t):
    return Vector(a).lerp(Vector(b), t)

for s in (L, R):
    elbow, wrist = (s * 0.36, 0.02, 1.18), (s * 0.46, -0.01, 0.95)
    d = Vector(wrist) - Vector(elbow)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    c = along(elbow, wrist, 0.55)
    cyl('Unterarmschutz', 0.06, 0.14, c, M['armor'], rot=rot, r2=0.052, bev=0.006)
    cl = along(elbow, wrist, 0.32)
    torus('Unterarmlicht', 0.06, 0.004, cl, M['glow_dim'], rot=rot, mseg=8)
    cyl('Ellbogenpad', 0.066, 0.05, along(elbow, wrist, 0.02), M['armor'], rot=rot, bev=0.012)
    # Handschuh (abgerundet)
    hand_c = Vector(wrist) + d.normalized() * 0.085
    g = rbox('Handschuh', (0.075, 0.042, 0.105), hand_c, M['glove'], rot=rot, bev=0.012, seg=2); subsurf(g, 2)
    cyl('Handgelenk', 0.052, 0.035, Vector(wrist) + d.normalized() * 0.015, M['glove'], rot=rot, bev=0.006)
    rbox('Knoechelplatte', (0.058, 0.012, 0.03), hand_c + Vector((0, -0.025, -0.01)), M['metal'], rot=rot, bev=0.004)
    th = rbox('Daumen', (0.024, 0.024, 0.055), hand_c + Vector((-s * 0.032, -0.024, 0.015)), M['glove'],
              rot=(rot.x + math.radians(-20), rot.y, rot.z), bev=0.006, seg=2); subsurf(th, 2)
# Handgelenks-Display links
rbox('Armdisplay', (0.05, 0.02, 0.06), (0.415, -0.055, 1.04), M['metal'], rot=(0, math.radians(25), 0), bev=0.005)
rbox('Armdisplay_Glas', (0.04, 0.004, 0.045), (0.415, -0.066, 1.04), M['glow'], rot=(0, math.radians(25), 0), bev=0.002, seg=1)

# ------------------------------------------------------------------ Beine: Taschen, Knieschoner, Stiefel
for s in (L, R):
    rbox('Beintasche', (0.032, 0.11, 0.13), (s * 0.208, -0.005, 0.74), M['overall'], bev=0.012)
    rbox('Beintaschenklappe', (0.036, 0.11, 0.032), (s * 0.211, -0.005, 0.805), M['strap'], bev=0.006)
    band('Oberschenkelgurt', 0.86, 0.107, 0.107, 0.03, 0.008, M['strap'], cx=s * 0.108, cy=-0.004)
    rbox('Knieschoner', (0.11, 0.04, 0.13), (s * 0.115, -0.092, 0.53), M['armor'], rot=(math.radians(-4), 0, 0), bev=0.02, seg=4)
    rbox('Kniestreifen', (0.065, 0.006, 0.01), (s * 0.115, -0.114, 0.53), M['glow_dim'], bev=0.002, seg=1)
    # Stiefel
    rbox('Stiefel', (0.13, 0.24, 0.14), (s * 0.124, -0.04, 0.09), M['armor'], bev=0.035, seg=4)
    rbox('Sohle', (0.138, 0.255, 0.032), (s * 0.124, -0.04, 0.016), M['sole'], bev=0.008)
    cyl('Stiefelschaft', 0.085, 0.12, (s * 0.122, 0.005, 0.21), M['armor'], r2=0.08, bev=0.01)
    torus('Stiefellicht', 0.086, 0.004, (s * 0.122, 0.005, 0.265), M['glow_dim'], mseg=8)
    rbox('Zehenkappe', (0.11, 0.065, 0.055), (s * 0.124, -0.14, 0.075), M['metal'], bev=0.02, seg=3)

# ------------------------------------------------------------------ Export
for ob in col.objects:
    ob.select_set(True)
bpy.context.view_layer.objects.active = col.objects[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'pionier.glb'), use_selection=True, export_apply=True,
                          export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'pionier.blend'))

if DO_RENDER:
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.cycles.use_denoising = True
    scene.cycles.device = 'CPU'
    scene.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); scene.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.006, 0.014, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    def light(name, loc, energy, color=(1, 1, 1), size=1.0):
        Ld = bpy.data.lights.new(name, 'AREA'); Ld.energy = energy; Ld.color = color; Ld.size = size
        o = bpy.data.objects.new(name, Ld); scene.collection.objects.link(o); o.location = loc
        o.rotation_euler = (Vector((0, 0, 1.1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light('key', (-1.6, -2.2, 2.6), 160, (1, 0.96, 0.92), 1.5)
    light('rim', (1.8, 1.6, 2.2), 380, (0.35, 0.5, 1.0), 1.2)
    light('rim2', (-1.9, 1.4, 1.8), 220, (0.35, 0.5, 1.0), 1.2)
    light('fill', (2.0, -1.8, 1.0), 35, (0.6, 0.7, 1.0), 2.0)
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    fl = bpy.context.active_object; fl.data.materials.append(mat('Boden', (0.004, 0.005, 0.01), 0.0, 0.35))
    cd = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cd); scene.collection.objects.link(cam)
    scene.camera = cam; cd.lens = 60
    scene.render.resolution_x, scene.render.resolution_y = 900, 1200
    shots = {'vorne': (0.0, -4.2, 1.15), 'schraeg': (2.4, -3.3, 1.5), 'hinten': (-2.0, 3.6, 1.4),
             'helm': (0.55, -1.25, 1.78)}
    for n, p in shots.items():
        cam.location = p
        tgt = Vector((0, 0, 1.72)) if n == 'helm' else Vector((0, 0, 0.92))
        cam.rotation_euler = (tgt - Vector(p)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT, f'render_{n}.png')
        bpy.ops.render.render(write_still=True)
print('DONE')
