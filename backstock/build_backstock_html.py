import json
svg = open('/home/claude/hummusfit-warehouse/backstock/backstock_blueprint.svg').read().strip()
g = json.load(open('/home/claude/hummusfit-warehouse/backstock/backstock_geometry.json'))

confirmed = ''.join(f'<li>{a}</li>' for a in g['_confirmed_by_tony'])
open_items = ''.join(f'<li>{a}</li>' for a in g['_still_assumed_or_open'] + g.get('_relabel_v5_open', []))

# Compute stat-card numbers from the live geometry instead of hardcoding them,
# so this script can't silently go stale again the way it just did (v4's
# numbers got shipped as "v7" until this was caught).
WA_BAYS, WA_LEVELS = 4, 3
WD_BAYS_OURS, WD_LEVELS = 2, 4
C_BAYS = g['center_bays']
C_LEVELS = 4  # still unconfirmed, see _relabel_v5_open
wa_positions = WA_BAYS * WA_LEVELS
wd_positions = WD_BAYS_OURS * WD_LEVELS
c_positions = C_BAYS * C_LEVELS
wa_span_ft = g['wall_a_total_span_in'] / 12
c_run_ft = g['center_total_run_in'] / 12

html_doc = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hummus Fit — Backstock Room (DRAFT v7, C07 added, real measurements)</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>
  :root{{ --teal:#2BBFAA; --orange:#E8612C; --ink:#111417; --dim:#767c85; --line:#e9ebee; --bg:#fafafa; --green:#2e9e5b; }}
  *{{box-sizing:border-box;}}
  body{{margin:0;font-family:'Inter',sans-serif;background:var(--bg);color:var(--ink);}}
  .wrap{{max-width:1200px;margin:0 auto;padding:32px 28px 60px;}}
  h1{{font-size:24px;margin:0 0 4px;font-weight:900;}}
  .sub{{color:var(--dim);font-size:14px;margin:0 0 20px;font-weight:600;}}
  .confirmedbanner{{background:#eafaf0;border:1.5px solid var(--green);border-radius:14px;padding:16px 20px;margin-bottom:16px;}}
  .confirmedbanner h2{{margin:0 0 8px;font-size:14px;color:var(--green);text-transform:uppercase;letter-spacing:.04em;}}
  .confirmedbanner ul{{margin:0;padding-left:20px;font-size:13px;line-height:1.6;color:#1e5c37;}}
  .draftbanner{{background:#fff3ea;border:1.5px solid var(--orange);border-radius:14px;padding:16px 20px;margin-bottom:24px;}}
  .draftbanner h2{{margin:0 0 8px;font-size:14px;color:var(--orange);text-transform:uppercase;letter-spacing:.04em;}}
  .draftbanner ul{{margin:0;padding-left:20px;font-size:13px;line-height:1.6;color:#5a4130;}}
  .diagram-card{{background:#fff;border:1.5px solid var(--line);border-radius:20px;padding:20px;overflow-x:auto;margin-bottom:28px;}}
  .diagram-card svg{{display:block;width:100%;height:auto;min-width:500px;}}
  .statgrid{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px;}}
  .stat{{background:#fff;border:1.5px solid var(--line);border-radius:14px;padding:16px;text-align:center;}}
  .stat .n{{font-size:26px;font-weight:900;color:var(--teal);}}
  .stat .l{{font-size:11.5px;color:var(--dim);font-weight:700;text-transform:uppercase;margin-top:4px;}}
  .pagenav{{display:flex;gap:8px;margin-bottom:16px;}}
  .pagenav a{{text-decoration:none;font-size:13px;font-weight:800;color:var(--dim);border:1.5px solid var(--line);border-radius:10px;padding:9px 18px;}}
  .pagenav a.active{{background:var(--ink);color:#fff;border-color:var(--ink);}}
</style></head>
<body><div class="wrap">
  <div class="pagenav"><a href="/blueprint.html">Blueprint</a><a href="/3d-model.html">3D Model</a><a href="/backstock-blueprint.html" class="active">Backstock Blueprint</a><a href="/backstock-3d.html">Backstock 3D</a></div>
  <h1>Backstock Room — Draft v7 (C07 added)</h1>
  <p class="sub">Top-down · Wall A 32ft/4 bays, Wall D 2-of-3 bays, Center 7 bays/31.5ft · still a few open items</p>

  <div class="confirmedbanner">
    <h2>Confirmed by you — real, not guessed</h2>
    <ul>{confirmed}</ul>
  </div>

  <div class="draftbanner">
    <h2>Still open</h2>
    <ul>{open_items}</ul>
  </div>

  <div class="statgrid">
    <div class="stat"><div class="n">{wd_positions}</div><div class="l">positions — Wall D ({WD_BAYS_OURS}×{WD_LEVELS})</div></div>
    <div class="stat"><div class="n">{wa_positions}</div><div class="l">positions — Wall A ({WA_BAYS}×{WA_LEVELS}, {wa_span_ft:.0f}ft)</div></div>
    <div class="stat"><div class="n">{c_positions}</div><div class="l">positions — Center front ({C_BAYS}×{C_LEVELS}, {c_run_ft:.1f}ft, levels unconfirmed)</div></div>
  </div>

  <div class="diagram-card">{svg}</div>
</div></body></html>
'''
open('/home/claude/hummusfit-warehouse/backstock/backstock_blueprint.html', 'w').write(html_doc)
print('HTML written', len(html_doc), 'bytes')
