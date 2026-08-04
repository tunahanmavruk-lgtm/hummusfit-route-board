"""
v5 -- relabel + rotate per Tony's correction:
  - Wall A (was drawn as "D"): 4 bays, 3 levels, spans the width axis at the
    door end, A1 nearest the door.
  - Wall D (was drawn as "A"): 4 levels, only 2 of 3 bays ours (D1, D2),
    runs the length axis on the side, unchanged physical position.
  - Center: rotates 90deg in the drawing to correctly face the new Wall A
    (this was my drawing error, not a physical rack move).
Still open: the Wall-A(new)-to-Center aisle distance was never actually
measured in this orientation -- see backstock_geometry.json._relabel_v5_open.
"""
import json

g = json.load(open('/home/claude/hummusfit-warehouse/backstock/backstock_geometry.json'))

SCALE = 1.6
ZONE_W = g['zone_width_in']   # 384in (32ft) -- Wall A's real confirmed span
ZONE_L = g['zone_length_in']  # 324in, y-axis, door at y=0

WA_BAYS, WA_LEVELS, WA_DEPTH = 4, 3, 42          # new Wall A, 8ft/bay confirmed
WD_BAYS_OURS, WD_LEVELS, WD_DEPTH = 2, 4, 42     # new Wall D, 8ft/bay confirmed, only 2 bays ours
WD_BAY_W = g['wall_d_bay_width_in']              # 96in
WD_BAY_LEN = WD_BAY_W
C_BAYS = g['center_bays']
C_TOTAL_RUN = g['center_total_run_in']           # 324in -- Center's OWN length, shorter than Wall A
AISLE_PLACEHOLDER = 132
CENTER_DEPTH = 40

MARGIN = 44
GAP_TO_WD = 40  # visual gap between the main zone and Wall D, since Wall D's
                 # exact connecting distance is NOT confirmed
WD_STRIP = GAP_TO_WD + WD_DEPTH
X_OFFSET = WD_STRIP  # Wall D sits on the LEFT (opposite side from before),
                      # Wall A + Center shift right so their door-end (y=0)
                      # row stays flush/aligned with Wall D's door-end
SVG_W = (ZONE_W + WD_STRIP) * SCALE + MARGIN * 2
SVG_H = ZONE_L * SCALE + MARGIN * 2 + 20

def rect(x, y, w, h, fill, stroke='#111417', sw=1.5, extra=''):
    return f'<rect x="{x*SCALE+MARGIN:.1f}" y="{y*SCALE+MARGIN:.1f}" width="{w*SCALE:.1f}" height="{h*SCALE:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>'

def text(x, y, s, size=11, weight='700', color='#111417', anchor='start'):
    return f'<text x="{x*SCALE+MARGIN:.1f}" y="{y*SCALE+MARGIN:.1f}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}" font-family="Inter, sans-serif">{s}</text>'

parts = []
parts.append(f'''<defs>
  <pattern id="hatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <line x1="0" y1="0" x2="0" y2="8" stroke="#c7cbd1" stroke-width="4"/>
  </pattern>
</defs>''')
parts.append(rect(X_OFFSET, 0, ZONE_W, ZONE_L, '#fafafa', '#111417', 3))
parts.append(text(X_OFFSET + 6, -10, 'DOOR END', 10, '700', '#E8612C', 'start'))

# ---- Wall A: 4 bays, spans width axis at the door end, A1 nearest door ----
wa_bay_w = ZONE_W / WA_BAYS
for b in range(WA_BAYS):
    parts.append(rect(X_OFFSET + b*wa_bay_w, 0, wa_bay_w, WA_DEPTH, '#e2e5e9', '#5b6470', 1.5))
    parts.append(text(X_OFFSET + b*wa_bay_w + wa_bay_w/2, WA_DEPTH/2 + 3, f'A{b+1:02d} (8ft)', 9.5, '800', '#5b6470', 'middle'))
parts.append(text(X_OFFSET + 6, WA_DEPTH + 14, f'Wall A (ours) — 4 bays, 3 levels — A1 nearest the door', 9.5, '700', '#5b6470', 'start'))

y_cursor = WA_DEPTH + 26

# ---- aisle ----
parts.append(text(X_OFFSET + ZONE_W/2, y_cursor + AISLE_PLACEHOLDER/2, 'AISLE (distance not yet confirmed)', 9.5, '600', '#c7cbd1', 'middle'))
y_cursor += AISLE_PLACEHOLDER

# ---- Center: rotated to run along width axis, facing Wall A ----
c_bay_w = C_TOTAL_RUN / C_BAYS
for b in range(C_BAYS):
    parts.append(rect(X_OFFSET + b*c_bay_w, y_cursor, c_bay_w, CENTER_DEPTH, '#eef0f4', '#111417', 1.5))
    parts.append(text(X_OFFSET + b*c_bay_w + c_bay_w/2, y_cursor + CENTER_DEPTH/2 + 3, f'C{b+1:02d}', 9.5, '800', '#111417', 'middle'))
parts.append(text(X_OFFSET + 6, y_cursor - 6, f'Center front (ours) — {C_BAYS} bays, {C_TOTAL_RUN/12:.1f}ft total — shorter than Wall A, flush with A01 end (alignment unconfirmed)', 9.5, '700', '#111417', 'start'))
# unspanned remainder of Wall A's width, past Center's shorter run
if C_TOTAL_RUN < ZONE_W:
    parts.append(rect(X_OFFSET + C_TOTAL_RUN, y_cursor, ZONE_W - C_TOTAL_RUN, CENTER_DEPTH, 'url(#hatch)', '#c7cbd1', 1))
    parts.append(text(X_OFFSET + C_TOTAL_RUN + (ZONE_W-C_TOTAL_RUN)/2, y_cursor + CENTER_DEPTH/2, 'no rack here', 7.5, '600', '#9aa0a8', 'middle'))
y_cursor += CENTER_DEPTH

# back face = Row B (kitchen's)
parts.append(rect(X_OFFSET, y_cursor, C_TOTAL_RUN, CENTER_DEPTH, 'url(#hatch)', '#9aa0a8', 1.5))
parts.append(text(X_OFFSET + 6, y_cursor + CENTER_DEPTH/2 + 3, "Row B / Center back face (kitchen's, NOT ours)", 9.5, '700', '#9aa0a8', 'start'))
y_cursor += CENTER_DEPTH + 20

# ---- Wall D: opposite side (LEFT of Wall A/Center), door end (y=0)
# flush-aligned with Wall A's door end -- per correction ----
wd_x = 0
parts.append(f'<line x1="{(X_OFFSET)*SCALE+MARGIN:.1f}" y1="{MARGIN:.1f}" x2="{(X_OFFSET)*SCALE+MARGIN:.1f}" y2="{(ZONE_L)*SCALE+MARGIN:.1f}" stroke="#c7cbd1" stroke-width="1" stroke-dasharray="3,3"/>')
parts.append(text(X_OFFSET - GAP_TO_WD/2, ZONE_L/2, 'gap not confirmed', 8, '600', '#c7cbd1', 'middle'))
for b in range(2):
    parts.append(rect(wd_x, b*WD_BAY_LEN, WD_DEPTH, WD_BAY_LEN - 3, '#e2e5e9', '#5b6470', 1.5))
    parts.append(text(wd_x + WD_DEPTH/2, b*WD_BAY_LEN + WD_BAY_LEN/2, f'D{b+1:02d} (8ft)', 9.5, '800', '#5b6470', 'middle'))
# uncounted 3rd bay, shown hatched for reference
parts.append(rect(wd_x, 2*WD_BAY_LEN, WD_DEPTH, WD_BAY_LEN - 3, 'url(#hatch)', '#c7cbd1', 1.5))
parts.append(text(wd_x + WD_DEPTH/2, -10, 'Wall D (ours)', 9.5, '700', '#5b6470', 'middle'))
parts.append(text(wd_x + WD_DEPTH/2, 2*WD_BAY_LEN + WD_BAY_LEN/2, "3rd bay —", 8, '600', '#9aa0a8', 'middle'))
parts.append(text(wd_x + WD_DEPTH/2, 2*WD_BAY_LEN + WD_BAY_LEN/2 + 12, "not counted", 8, '600', '#9aa0a8', 'middle'))
parts.append(f'<line x1="{MARGIN:.1f}" y1="{MARGIN:.1f}" x2="{(X_OFFSET+ZONE_W)*SCALE+MARGIN:.1f}" y2="{MARGIN:.1f}" stroke="#E8612C" stroke-width="2"/>')
parts.append(text((X_OFFSET+ZONE_W)/2, -22, "door-end row — Wall D's D01 and Wall A's A01 both start flush at this line", 8.5, '600', '#E8612C', 'middle'))

svg = f'''<svg viewBox="0 0 {SVG_W:.1f} {SVG_H:.1f}" xmlns="http://www.w3.org/2000/svg" font-family="Inter, sans-serif">
{''.join(parts)}
</svg>'''

open('/home/claude/hummusfit-warehouse/backstock/backstock_blueprint.svg', 'w').write(svg)
ours = WA_BAYS*WA_LEVELS + 2*WD_LEVELS + C_BAYS*4
print('SVG written:', len(svg), 'bytes')
print(f'Wall A: {WA_BAYS}x{WA_LEVELS}={WA_BAYS*WA_LEVELS}  Wall D: 2x{WD_LEVELS}={2*WD_LEVELS}  Center front (levels unconfirmed, assumed 4): {C_BAYS}x4={C_BAYS*4}  TOTAL: {ours}')
