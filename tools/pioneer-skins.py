# Malt die Pionier-Figuren fuer das Gaming-Profil (Steam-Ansicht): eigene Pixel-Skins im Minecraft-Format (64x64),
# angelehnt an den Schutzanzug aus Satisfactory (Helm mit dunklem Visier, Brustplatte, Schulter- und Knieschuetzer,
# Rueckentornister). Die 3D-Ansicht der Seite (skinview3d) zeigt und animiert sie wie den Minecraft-Skin.
# Varianten = Farbgebungen (FARBEN unten). Neue Variante: Eintrag ergaenzen, Skript starten, in gaming.js bei PIONEERS eintragen.
# Start: python3 tools/pioneer-skins.py   (braucht Pillow) -> site/skin/pionier-<name>.png
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'site', 'skin')
# name: (Akzent, Akzent dunkel, Anzug, Anzug dunkel, Helm, Helm dunkel, Visier, Visier-Glanz)
FARBEN = {
    'orange': ('#fa9549', '#c96a1c', '#3a3d45', '#26282e', '#e8e6df', '#b9b6ad', '#141a22', '#5fd0e8'),
    'blau':   ('#4d8fe0', '#2b62ab', '#30343c', '#1f2228', '#dfe5ee', '#aab4c2', '#10161f', '#ffd36b'),
    'gold':   ('#e8c14a', '#b08a1e', '#4a4237', '#2f2a22', '#f1ead6', '#c4b999', '#1b1712', '#7de0b5'),
}


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def skin(c):
    acc, acc_d, suit, suit_d, helm, helm_d, visor, shine = [rgb(x) for x in c]
    grey, grey_d, black = rgb('#8c9099'), rgb('#5c6069'), rgb('#0c0d10')
    im = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    px = im.load()

    def rect(x, y, w, h, col):
        for i in range(x, x + w):
            for j in range(y, y + h):
                px[i, j] = col

    # ----- Kopf: Helm rundum, vorn das Visier, oben ein Streifen in der Akzentfarbe
    rect(8, 0, 8, 8, helm); rect(11, 0, 2, 8, acc)                 # oben
    rect(16, 0, 8, 8, helm_d)                                       # unten
    for x in (0, 16, 24): rect(x, 8, 8, 8, helm)                    # rechts, links, hinten
    rect(8, 8, 8, 8, helm)                                          # vorn
    for x in (0, 8, 16, 24): rect(x, 15, 8, 1, helm_d)              # Helmrand
    rect(9, 10, 6, 4, visor); rect(8, 11, 8, 2, visor)              # Visier
    px[10, 10] = shine; px[11, 10] = shine; px[10, 11] = shine      # Glanzlicht
    rect(11, 8, 2, 1, acc)                                          # Streifen laeuft vorn aus
    rect(6, 10, 2, 3, visor); rect(16, 10, 2, 3, visor)             # Visier zieht sich um die Seiten
    rect(2, 11, 2, 2, grey_d); rect(20, 11, 2, 2, grey_d)           # Filter an den Seiten
    rect(27, 9, 2, 6, acc); rect(24, 8, 8, 1, helm_d)               # hinten: Streifen
    # ----- Rumpf: dunkler Anzug, Brustplatte, Guertel; hinten der Tornister
    rect(20, 16, 8, 4, acc_d); rect(28, 16, 8, 4, suit_d)           # Schultern oben, unten
    rect(16, 20, 4, 12, suit); rect(28, 20, 4, 12, suit)            # Seiten
    rect(20, 20, 8, 12, suit)                                       # vorn
    rect(20, 20, 8, 5, acc); rect(21, 25, 6, 1, acc_d)              # Brustplatte
    rect(23, 21, 2, 2, helm); px[24, 22] = acc_d                    # Abzeichen
    rect(20, 29, 8, 1, black); rect(23, 29, 2, 1, shine)            # Guertel mit Schnalle
    rect(20, 30, 8, 2, suit_d)
    rect(32, 20, 8, 12, suit)                                       # hinten
    rect(33, 20, 6, 8, grey); rect(34, 21, 4, 3, grey_d)            # Tornister
    rect(33, 28, 2, 2, black); rect(37, 28, 2, 2, black)            # Duesen
    px[35, 25] = acc; px[36, 25] = acc
    rect(32, 29, 8, 1, black)

    # ----- Arme und Beine (rechts gemalt, links gespiegelt uebernommen)
    def arm(ox, oy):
        rect(ox + 4, oy, 4, 4, acc); rect(ox + 8, oy, 4, 4, grey_d)             # oben (Schulter), unten (Hand)
        for i in range(4):                                                     # 4 Seiten
            x = ox + i * 4
            rect(x, oy + 4, 4, 12, suit)
            rect(x, oy + 4, 4, 3, acc); rect(x, oy + 7, 4, 1, acc_d)            # Schulterschutz
            rect(x, oy + 13, 4, 3, grey); rect(x, oy + 13, 4, 1, grey_d)        # Handschuh
        rect(ox + 5, oy + 9, 2, 2, suit_d)

    def leg(ox, oy):
        rect(ox + 4, oy, 4, 4, suit_d); rect(ox + 8, oy, 4, 4, black)
        for i in range(4):
            x = ox + i * 4
            rect(x, oy + 4, 4, 12, suit_d if i in (0, 2) else suit)
            rect(x, oy + 12, 4, 4, grey_d); rect(x, oy + 15, 4, 1, black)       # Stiefel
        rect(ox + 4, oy + 8, 4, 3, acc); rect(ox + 4, oy + 10, 4, 1, acc_d)     # Knieschutz vorn

    arm(40, 16); arm(32, 48)      # rechter, linker Arm
    leg(0, 16); leg(16, 48)       # rechtes, linkes Bein
    return im


if __name__ == '__main__':
    for name, c in FARBEN.items():
        p = os.path.join(OUT, 'pionier-' + name + '.png')
        skin(c).save(p)
        print('geschrieben:', os.path.normpath(p))
