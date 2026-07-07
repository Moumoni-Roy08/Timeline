#!/usr/bin/env python3
"""Generates public/bg.svg — calm watercolor scene:
cream wall, blossom branches with leaf shadows, blue shuttered window,
tulip pots on a brick path. Seeded so the output is reproducible."""
import math, random, sys

ANIMATE = "--static" not in sys.argv
OUT = "public/bg-static.svg" if not ANIMATE else "public/bg.svg"
random.seed(20260706)
W, H = 1600, 1000
out = []
A = out.append

A(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">')
A('<defs>'
  '<filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>'
  '<filter id="soft2" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>'
  '<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">'
  '<stop offset="0" stop-color="#F7F2E4"/><stop offset="0.55" stop-color="#F5EFDF"/><stop offset="1" stop-color="#EFE7D2"/>'
  '</linearGradient>'
  '</defs>')

# wall
A(f'<rect width="{W}" height="{H}" fill="url(#wall)"/>')

# sun-washed blotches on the plaster
for _ in range(26):
    x, y = random.uniform(0, W), random.uniform(60, H - 160)
    r = random.uniform(60, 190)
    tone = random.choice(['#EFE7D2', '#F9F5E9', '#EDE3CB'])
    op = random.uniform(0.25, 0.5)
    A(f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="{r:.0f}" ry="{r*0.6:.0f}" fill="{tone}" opacity="{op:.2f}" filter="url(#soft)"/>')

# paper speckles
for _ in range(90):
    x, y = random.uniform(0, W), random.uniform(0, H)
    r = random.uniform(0.8, 2.4)
    A(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="#C9BC9E" opacity="{random.uniform(0.12,0.3):.2f}"/>')

# ---------- leaf shadows cast on the wall ----------
def shadow_cluster(cx, cy, n, spread):
    for _ in range(n):
        a = random.uniform(0, 2 * math.pi)
        d = random.uniform(0, spread)
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d * 0.7
        rx, ry = random.uniform(16, 34), random.uniform(8, 16)
        rot = random.uniform(0, 180)
        A(f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="{rx:.0f}" ry="{ry:.0f}" fill="#A9B2A0" opacity="0.16" '
      f'transform="rotate({rot:.0f} {x:.0f} {y:.0f})" filter="url(#soft2)"/>')

shadow_cluster(300, 330, 40, 240)
shadow_cluster(1330, 300, 34, 210)
shadow_cluster(120, 620, 16, 130)

# ---------- blossom branches ----------
def branch(x0, y0, ang, length, depth, thick):
    """Draw tapering branch recursively; returns leaf/flower anchor points."""
    pts = []
    x1 = x0 + math.cos(ang) * length
    y1 = y0 + math.sin(ang) * length
    mx = (x0 + x1) / 2 + random.uniform(-14, 14)
    my = (y0 + y1) / 2 + random.uniform(-14, 14)
    A(f'<path d="M{x0:.0f} {y0:.0f} Q{mx:.0f} {my:.0f} {x1:.0f} {y1:.0f}" fill="none" '
      f'stroke="#6E4B33" stroke-width="{thick:.1f}" stroke-linecap="round"/>')
    pts.append((x1, y1))
    if depth > 0:
        for _ in range(random.randint(2, 3)):
            na = ang + random.uniform(-0.75, 0.75)
            nl = length * random.uniform(0.55, 0.75)
            pts += branch(x1, y1, na, nl, depth - 1, max(1.4, thick * 0.55))
        # mid twig
        pts += branch((x0+x1)/2, (y0+y1)/2, ang + random.uniform(-1.0, 1.0),
                      length * 0.4, max(0, depth - 2), max(1.2, thick * 0.4))
    return pts

def leaf(x, y):
    a = random.uniform(0, 360)
    l = random.uniform(14, 24)
    c = random.choice(['#7FA46F', '#8FB283', '#6E9160'])
    A(f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="{l:.0f}" ry="{l*0.42:.0f}" fill="{c}" '
      f'opacity="0.95" transform="rotate({a:.0f} {x:.0f} {y:.0f})"/>')

def blossom(x, y, r):
    for k in range(5):
        a = k / 5 * 2 * math.pi + random.uniform(-0.15, 0.15)
        px, py = x + math.cos(a) * r * 0.75, y + math.sin(a) * r * 0.75
        A(f'<ellipse cx="{px:.1f}" cy="{py:.1f}" rx="{r*0.62:.1f}" ry="{r*0.5:.1f}" fill="#FDFBF4" '
          f'stroke="#EAE0C8" stroke-width="0.8" transform="rotate({math.degrees(a):.0f} {px:.1f} {py:.1f})"/>')
    A(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*0.3:.1f}" fill="#F0B95D"/>')
    for k in range(5):
        a = random.uniform(0, 2 * math.pi)
        A(f'<circle cx="{x+math.cos(a)*r*0.32:.1f}" cy="{y+math.sin(a)*r*0.32:.1f}" r="1.6" fill="#D89A3F"/>')

def blossom_branch(x0, y0, ang, length, depth, thick, n_extra_flowers):
    anchors = branch(x0, y0, ang, length, depth, thick)
    random.shuffle(anchors)
    for i, (x, y) in enumerate(anchors):
        for _ in range(random.randint(1, 2)):
            leaf(x + random.uniform(-16, 16), y + random.uniform(-14, 14))
        if i % 2 == 0:
            blossom(x + random.uniform(-8, 8), y + random.uniform(-8, 8), random.uniform(11, 17))
    for _ in range(n_extra_flowers):
        x, y = random.choice(anchors)
        blossom(x + random.uniform(-30, 30), y + random.uniform(-24, 24), random.uniform(9, 14))

# top-left branch reaching in
blossom_branch(-40, 120, 0.35, 190, 3, 11, 8)
blossom_branch(-30, 20, 0.55, 160, 3, 9, 6)
# top-right branch
blossom_branch(W + 40, 140, math.pi - 0.4, 180, 3, 11, 8)
blossom_branch(W + 30, 30, math.pi - 0.6, 150, 3, 9, 6)

# ---------- blue shuttered window, far left, faint ----------
A('<g opacity="0.85" transform="translate(60 520)">')
A('<rect x="-14" y="-14" width="176" height="216" fill="#F1E9D6" stroke="#DDD2B8" stroke-width="3" rx="3"/>')
A('<rect x="0" y="0" width="148" height="188" fill="#7FA3BC" stroke="#5E82A0" stroke-width="3" rx="2"/>')
A('<line x1="74" y1="0" x2="74" y2="188" stroke="#5E82A0" stroke-width="4"/>')
A('<line x1="0" y1="94" x2="148" y2="94" stroke="#5E82A0" stroke-width="3"/>')
A('<rect x="8" y="8" width="58" height="78" fill="#A9C4D6" opacity="0.7" rx="2"/>')
A('<rect x="82" y="100" width="58" height="80" fill="#93B3C9" opacity="0.6" rx="2"/>')
A('<rect x="-20" y="198" width="188" height="14" fill="#E4D9BE" rx="3"/>')
A('</g>')

# ---------- brick path along the bottom ----------
path_y = H - 96
A(f'<rect x="0" y="{path_y}" width="{W}" height="96" fill="#E4C7AC"/>')
A(f'<rect x="0" y="{path_y}" width="{W}" height="10" fill="#D9BC9F"/>')
bw, bh = 88, 30
for row in range(3):
    y = path_y + 10 + row * bh
    off = (bw // 2) * (row % 2)
    for x in range(-bw, W + bw, bw):
        c = random.choice(['#E0BD9C', '#E7CBAE', '#DCB795', '#E9D0B6'])
        A(f'<rect x="{x+off}" y="{y}" width="{bw-4}" height="{bh-4}" fill="{c}" rx="3" opacity="0.9"/>')
# fallen petals on the path
for _ in range(26):
    x = random.uniform(0, W)
    y = random.uniform(path_y + 6, H - 8)
    A(f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="6" ry="3.4" fill="#FBF7EC" opacity="0.9" '
      f'transform="rotate({random.uniform(0,180):.0f} {x:.0f} {y:.0f})"/>')

# ---------- tulip pots resting on the path ----------
def pot_of_tulips(cx, base_y, scale, pot_color, tulip_colors):
    g = f'<g transform="translate({cx} {base_y}) scale({scale})">'
    A(g)
    # flowers sway in the wind (SMIL, pivots at the pot rim)
    dur = random.uniform(3.6, 5.4)
    ang = random.uniform(1.4, 2.4)
    if ANIMATE:
        A(f'<g><animateTransform attributeName="transform" type="rotate" '
          f'values="{-ang:.1f} 0 0; {ang:.1f} 0 0; {-ang:.1f} 0 0" dur="{dur:.1f}s" '
          f'repeatCount="indefinite" calcMode="spline" '
          f'keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"/>')
    else:
        A('<g>')
    # tulips behind pot rim
    n = len(tulip_colors)
    for i, col in enumerate(tulip_colors):
        x = (i - (n - 1) / 2) * 26 + random.uniform(-4, 4)
        h = random.uniform(95, 140)
        lean = random.uniform(-0.12, 0.12)
        tx = x + math.sin(lean) * h
        A(f'<path d="M{x:.0f} 0 Q{x + math.sin(lean)*h*0.5:.0f} {-h*0.55:.0f} {tx:.0f} {-h:.0f}" '
          f'fill="none" stroke="#7CA06F" stroke-width="6" stroke-linecap="round"/>')
        # leaves
        A(f'<path d="M{x:.0f} -12 Q{x-30:.0f} -46 {x-14:.0f} -86 Q{x-6:.0f} -46 {x:.0f} -12" fill="#8FB283"/>')
        A(f'<path d="M{x:.0f} -10 Q{x+30:.0f} -40 {x+18:.0f} -78 Q{x+8:.0f} -42 {x:.0f} -10" fill="#7CA06F"/>')
        # tulip head: cup + 3 tips
        A(f'<g transform="translate({tx:.0f} {-h:.0f})">')
        A(f'<path d="M-16 4 Q-18 -20 0 -24 Q18 -20 16 4 Q0 14 -16 4" fill="{col}"/>')
        A(f'<path d="M-14 -2 L-9 -26 L-3 -4 Z" fill="{col}"/>')
        A(f'<path d="M14 -2 L9 -26 L3 -4 Z" fill="{col}"/>')
        A(f'<path d="M-4 -6 L0 -30 L4 -6 Z" fill="{col}"/>')
        A('</g>')
    A('</g>')  # end sway group — pot itself stays still
    # pot
    A(f'<path d="M-46 0 L46 0 L36 66 L-36 66 Z" fill="{pot_color}"/>')
    A(f'<rect x="-52" y="-10" width="104" height="20" rx="6" fill="{pot_color}"/>')
    A(f'<rect x="-52" y="-10" width="104" height="8" rx="4" fill="#FFFFFF" opacity="0.18"/>')
    A('</g>')

pot_of_tulips(150, H - 120, 1.0, '#D2925F', ['#EE9AA6', '#F3B3BC', '#EE9AA6'])
pot_of_tulips(320, H - 108, 0.8, '#8FA6B8', ['#F2C24E', '#F3B3BC'])
pot_of_tulips(1300, H - 116, 0.95, '#C97B5A', ['#F3B3BC', '#EE9AA6', '#F2C24E'])
pot_of_tulips(1480, H - 106, 0.75, '#D9B24A', ['#EE9AA6', '#F3B3BC'])

A('</svg>')
open(OUT, 'w').write('\n'.join(out))
print(OUT, 'bytes:', len('\n'.join(out)))
