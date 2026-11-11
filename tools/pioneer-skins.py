# Malt die Pionier-Figuren fuer das Gaming-Profil (Steam-Ansicht): eigene Pixel-Skins im Minecraft-Format (64x64),
# angelehnt an die Anzug-Designs aus Satisfactory: Helm in Anzugfarbe mit dunklem Gesichtsfeld und leuchtendem Visier,
# Latzhose mit Traegern ueber dunklem Unteranzug, Armbinde, Guerteltaschen, Knieschuetzer, Stiefel, Rueckentornister.
# Die 3D-Ansicht der Seite (skinview3d) zeigt und animiert sie wie den Minecraft-Skin.
# Varianten = Farbgebungen (FARBEN unten). Neue Variante: Eintrag ergaenzen, Skript starten, in gaming.js bei PIONEERS eintragen.
# Start: python3 tools/pioneer-skins.py   (braucht Pillow) -> site/skin/pionier-<name>.png
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'site', 'skin')
# name: (Anzug, Anzug dunkel, Unteranzug, Unteranzug dunkel, Visier, Armbinde)
FARBEN = {
    'gruen':   ('#7c9a62', '#566f43', '#34373e', '#23252a', '#e0408f', '#c9506e'),
    'schwarz': ('#34343a', '#1e1e22', '#26272c', '#17181b', '#ff3b4e', '#b03a48'),
    'blau':    ('#97a3e6', '#6672bd', '#34373e', '#23252a', '#e0408f', '#c9506e'),
    'weiss':   ('#ececf0', '#b7b8c4', '#34373e', '#23252a', '#5fe08a', '#c9506e'),
    'gelb':    ('#e9db4d', '#b3a52c', '#34373e', '#23252a', '#e0408f', '#c9506e'),
}


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def skin(c):
    suit, suit_d, under, under_d, visor, band = [rgb(x) for x in c]
    grey, grey_d, black, face = rgb('#8c9099'), rgb('#5c6069'), rgb('#0c0d10'), rgb('#15171c')
    im = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    px = im.load()

    def rect(x, y, w, h, col):
        for i in range(x, x + w):
            for j in range(y, y + h):
                px[i, j] = col

    # ----- Kopf: Helm/Haube in Anzugfarbe, vorn das dunkle Gesichtsfeld mit leuchtendem Visier
    rect(8, 0, 8, 8, suit); rect(10, 1, 4, 6, suit_d)               # oben mit Mittelplatte
    rect(16, 0, 8, 8, under_d)                                      # unten
    for x in (0, 16, 24): rect(x, 8, 8, 8, suit)                    # rechts, links, hinten
    rect(8, 8, 8, 8, suit)                                          # vorn
    for x in (0, 8, 16, 24): rect(x, 15, 8, 1, suit_d)              # Helmrand
    rect(9, 10, 6, 5, face); rect(10, 9, 4, 1, face)                # Gesichtsfeld
    rect(10, 11, 4, 2, visor); px[9, 11] = visor; px[14, 11] = visor  # Visier
    px[11, 11] = rgb('#ffffff')                                     # Glanzlicht
    rect(11, 14, 2, 1, grey_d)                                      # Atemfilter
    rect(2, 10, 3, 3, suit_d); rect(19, 10, 3, 3, suit_d)           # Ohrstuecke
    px[3, 11] = visor; px[20, 11] = visor
    rect(26, 10, 4, 4, suit_d)                                      # hinten: Platte
    # ----- Rumpf: dunkler Unteranzug, darueber die Latzhose mit Traegern; hinten der Tornister
    rect(20, 16, 8, 4, under); rect(28, 16, 8, 4, suit_d)           # Schultern oben, unten (Schritt)
    rect(16, 20, 4, 12, under); rect(28, 20, 4, 12, under)          # Seiten
    rect(20, 20, 8, 12, under)                                      # vorn
    rect(21, 20, 1, 4, suit_d); rect(26, 20, 1, 4, suit_d)          # Traeger
    rect(21, 23, 6, 5, suit); rect(22, 24, 4, 2, suit_d)            # Latz mit Brusttasche
    px[21, 23] = grey; px[26, 23] = grey                            # Schnallen
    rect(20, 28, 8, 4, suit)                                        # Hosenbund
    rect(20, 28, 8, 1, black); rect(23, 28, 2, 1, grey)             # Guertel mit Schnalle
    rect(20, 29, 2, 2, suit_d); rect(26, 29, 2, 2, suit_d)          # Guerteltaschen
    for x in (16, 28): rect(x, 28, 4, 4, suit); rect(x, 28, 4, 1, black)
    rect(32, 20, 8, 12, under)                                      # hinten
    rect(33, 20, 1, 3, suit_d); rect(38, 20, 1, 3, suit_d)          # Traeger hinten
    rect(34, 21, 4, 6, grey); rect(35, 22, 2, 3, grey_d)            # Tornister
    rect(34, 27, 1, 1, black); rect(37, 27, 1, 1, black)            # Duesen
    rect(32, 28, 8, 4, suit); rect(32, 28, 8, 1, black)

    # ----- Arme und Beine (beide Seiten gleich gemalt)
    def arm(ox, oy):
        rect(ox + 4, oy, 4, 4, under); rect(ox + 8, oy, 4, 4, grey_d)           # oben (Schulter), unten (Hand)
        for i in range(4):                                                     # 4 Seiten
            x = ox + i * 4
            rect(x, oy + 4, 4, 12, under)
            rect(x, oy + 7, 4, 2, band)                                         # Armbinde
            rect(x, oy + 12, 4, 4, grey); rect(x, oy + 12, 4, 1, grey_d)        # Handschuh
        rect(ox + 4, oy + 4, 4, 2, under_d)                                     # Schulterpolster vorn

    def leg(ox, oy):
        rect(ox + 4, oy, 4, 4, suit); rect(ox + 8, oy, 4, 4, black)
        for i in range(4):
            x = ox + i * 4
            rect(x, oy + 4, 4, 12, suit_d if i in (0, 2) else suit)
            rect(x, oy + 13, 4, 3, under_d); rect(x, oy + 15, 4, 1, black)      # Stiefel
        rect(ox + 4, oy + 8, 4, 3, under_d); rect(ox + 5, oy + 9, 2, 1, grey_d)  # Knieschutz vorn
        rect(ox, oy + 6, 4, 2, suit_d); rect(ox + 8, oy + 6, 4, 2, suit_d)       # Beintaschen an den Seiten

    arm(40, 16); arm(32, 48)      # rechter, linker Arm
    leg(0, 16); leg(16, 48)       # rechtes, linkes Bein
    return im


if __name__ == '__main__':
    for name, c in FARBEN.items():
        p = os.path.join(OUT, 'pionier-' + name + '.png')
        skin(c).save(p)
        print('geschrieben:', os.path.normpath(p))
