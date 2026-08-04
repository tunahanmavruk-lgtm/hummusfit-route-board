"""
3D mockup of the backstock room -- built from the confirmed geometry in
backstock_geometry.json, with the ACTUAL product-location assignment from
backstock_location_assignment.csv / position_fill.json rendered as colored
crate-load blocks per position (real 3.5-day crate counts, real Shopify u30
demand -- see build_backstock_location_assignment.py for the math). Color =
category. Block height = how full that position is relative to its capacity.
"""
import json

g = json.load(open('/home/claude/hummusfit-warehouse/backstock/backstock_geometry.json'))
pos_fill = json.load(open('/home/claude/hummusfit-warehouse/backstock/position_fill.json'))
THREE_JS = open('/tmp/package/build/three.min.js').read()
ORBIT_JS = open('/tmp/package/examples/js/controls/OrbitControls.js').read()

ZONE_W = g['zone_width_in']          # 384in (32ft) -- Wall A's confirmed span
ZONE_L = g['zone_length_in']
WA_BAYS, WA_LEVELS, WA_DEPTH = 4, 3, 42
WD_BAYS_OURS, WD_LEVELS, WD_DEPTH = 2, 4, 42
WD_BAY_W = g['wall_d_bay_width_in']  # 96in, confirmed same as Wall A
WD_BAY_LEN = WD_BAY_W
C_BAYS = g['center_bays']            # 7, corrected from 6 (C07 added)
C_TOTAL_RUN = g['center_total_run_in']  # 378in (31.5ft) -- shorter than Wall A
CENTER_DEPTH = 40
AISLE = 132
LEVEL_H = 60  # placeholder, unconfirmed per-level height
GAP_TO_WD = 40
X_OFFSET = GAP_TO_WD + WD_DEPTH

wa_bay_w = ZONE_W / WA_BAYS          # 96in/bay, confirmed 8ft
c_bay_w = C_TOTAL_RUN / C_BAYS       # Center's own 31.5ft run / 7 bays

room_w = ZONE_W + X_OFFSET
room_d = ZONE_L + 60

config = {
    'roomW': room_w, 'roomD': room_d,
    'wallA': {'bays': WA_BAYS, 'levels': WA_LEVELS, 'depth': WA_DEPTH, 'bayW': wa_bay_w, 'x0': X_OFFSET, 'y0': 0},
    'wallD': {'bays': WD_BAYS_OURS, 'levels': WD_LEVELS, 'depth': WD_DEPTH, 'bayLen': WD_BAY_LEN, 'x0': 0, 'y0': 0},
    'center': {'bays': C_BAYS, 'depth': CENTER_DEPTH, 'bayW': c_bay_w, 'totalRun': C_TOTAL_RUN, 'zoneW': ZONE_W, 'x0': X_OFFSET, 'y0': WA_DEPTH + AISLE},
    'levelH': LEVEL_H,
}

CAT_COLOR = {'meal': 0x3b82f6, 'muffin': 0xE8612C, 'oats': 0x22c55e, 'snack': 0x8b5cf6}
CAT_LABEL = {'meal': 'Meals (blue)', 'muffin': 'Muffins (orange)', 'oats': 'Oats (green)', 'snack': 'Snacks (purple)'}

# Turn position_fill.json (bay/level/zone/cat/filled/cap keyed by e.g. "C03-L2")
# into per-position 3D placements matching the rack geometry above.
loads = []
for code, v in pos_fill.items():
    if not v['filled']:
        continue
    bay, level, zone, cat = v['bay'], v['level'], v['zone'], v['cat']
    frac = min(1.0, v['filled'] / v['cap'])
    if zone == 'walla':
        x = X_OFFSET + (bay-1)*wa_bay_w
        z = 0
        w, d = wa_bay_w - 4, WA_DEPTH - 4
    elif zone == 'walld':
        x = 0
        z = (bay-1)*WD_BAY_LEN
        w, d = WD_DEPTH - 4, WD_BAY_LEN - 6
    else:  # center
        x = X_OFFSET + (bay-1)*c_bay_w
        z = WA_DEPTH + AISLE
        w, d = c_bay_w - 4, CENTER_DEPTH - 4
    y0 = (level-1) * LEVEL_H + 4
    h = max(6, (LEVEL_H - 10) * frac)
    # Build the label text: this position's own code, plus every product/lane-code
    # it holds, so it reads exactly like the walk-in ("K1-01 Apple Pie-Ceps (6cr)").
    lane_bits = '; '.join(f"{pr['lane']} {pr['name']} ({pr['crates']}cr)" for pr in v['products'])
    loads.append({
        'x': x, 'z': z, 'w': w, 'd': d, 'y0': y0, 'h': h,
        'color': CAT_COLOR.get(cat, 0x9aa0a8), 'code': code, 'cat': cat,
        'filled': v['filled'], 'cap': v['cap'], 'laneText': lane_bits,
    })

html_doc = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Hummus Fit — Backstock Room 3D (DRAFT)</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html,body{{margin:0;height:100%;overflow:hidden;font-family:'Inter',-apple-system,sans-serif;background:#dfe3e6;}}
  #wrap{{position:relative;width:100%;height:100%;}}
  #hud{{position:absolute;top:16px;left:16px;background:rgba(17,20,23,0.85);color:#fff;padding:14px 18px;border-radius:12px;font-size:12.5px;line-height:1.6;max-width:340px;}}
  #hud b{{color:#2BBFAA;}}
  #hud .warn{{color:#ffb066;}}
  #toggle{{position:absolute;top:16px;right:16px;background:rgba(17,20,23,0.85);color:#fff;padding:8px 14px;border-radius:10px;font-size:12px;cursor:pointer;user-select:none;}}
  #pagenav{{position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:10;}}
  #pagenav a{{text-decoration:none;font-size:12.5px;font-weight:800;color:#fff;background:rgba(17,20,23,0.85);border-radius:10px;padding:8px 14px;}}
  #pagenav a.active{{background:#2BBFAA;}}
  #labelLayer{{position:absolute;inset:0;overflow:hidden;pointer-events:none;}}
  .pos-label{{position:absolute;transform:translate(-50%,-100%);font-size:9.5px;font-weight:700;line-height:1.3;background:rgba(255,255,255,.95);border:1px solid rgba(17,20,23,.15);border-radius:5px;padding:3px 6px;white-space:pre;color:var(--ink,#111417);pointer-events:none;box-shadow:0 1px 2px rgba(0,0,0,.08);max-width:220px;white-space:normal;}}
  .pos-label b{{color:#E8612C;}}
</style>
</head>
<body>
<div id="wrap">
  <div id="pagenav"><a href="/blueprint.html">Blueprint</a><a href="/3d-model.html">3D Model</a><a href="/backstock-blueprint.html">Backstock Blueprint</a><a href="/backstock-3d.html" class="active">Backstock 3D</a></div>
  <div id="hud">
    <b>Backstock Room — with real product assignment (3.5-day reserve)</b><br>
    Colored blocks = actual crate load per position, from backstock_location_assignment.csv.<br>
    <span style="color:#60a5fa">■</span> Meals &nbsp; <span style="color:#E8612C">■</span> Muffins &nbsp; <span style="color:#4ade80">■</span> Oats &nbsp; <span style="color:#a78bfa">■</span> Snacks<br>
    Block height = how full that position is (short = lightly filled, tall = at capacity).<br>
    <span class="warn">Room capacity (720 crates) only covers ~27% of full 3.5-day demand (2,613 crates) — most positions shown are already at max fill; 97 products have no assigned spot at all. Beam spacing/level heights still placeholders.</span>
  </div>
  <div id="toggle">Drag to rotate · scroll to zoom in to read position labels<br><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-weight:600;margin-top:4px;"><input type="checkbox" id="labelToggle" checked> Show position labels</label></div>
  <div id="labelLayer"></div>
</div>
<script>{THREE_JS}</script>
<script>{ORBIT_JS}</script>
<script>
const CFG = {json.dumps(config)};
const LOADS = {json.dumps(loads)};
const wrap = document.getElementById('wrap');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe3e6);

const camera = new THREE.PerspectiveCamera(50, wrap.clientWidth/wrap.clientHeight, 1, 5000);
camera.position.set(CFG.roomW*1.4, 900, CFG.roomD*1.6);
camera.lookAt(CFG.roomW*0.5, 60, CFG.roomD*0.5);

const renderer = new THREE.WebGLRenderer({{antialias:true}});
renderer.setSize(wrap.clientWidth, wrap.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);
wrap.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(CFG.roomW*0.5, 60, CFG.roomD*0.5);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(400, 600, 300);
scene.add(sun);

// floor
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(CFG.roomW, CFG.roomD),
  new THREE.MeshStandardMaterial({{color: 0x9aa0a8}})
);
floor.rotation.x = -Math.PI/2;
floor.position.set(CFG.roomW/2, 0, CFG.roomD/2);
scene.add(floor);

// room outline walls (low, just for orientation)
function wallSeg(x0, z0, x1, z1, h=180) {{
  const len = Math.hypot(x1-x0, z1-z0);
  const geo = new THREE.BoxGeometry(len, h, 4);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({{color:0xf2f3f5}}));
  mesh.position.set((x0+x1)/2, h/2, (z0+z1)/2);
  mesh.rotation.y = -Math.atan2(z1-z0, x1-x0);
  scene.add(mesh);
}}
wallSeg(0,0, CFG.roomW,0);
wallSeg(0,0, 0,CFG.roomD);
wallSeg(CFG.roomW,0, CFG.roomW,CFG.roomD);

const GREEN = 0x5b6470, ORANGE = 0xE8612C, DARKINK = 0x111417, GRAYKIT = 0x9aa0a8;

function rackBay(x, z, w, d, levels, levelH, color) {{
  const group = new THREE.Group();
  // uprights
  const postGeo = new THREE.BoxGeometry(3, levels*levelH, 3);
  const postMat = new THREE.MeshStandardMaterial({{color}});
  [[0,0],[w,0],[0,d],[w,d]].forEach(([px,pz]) => {{
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x+px, levels*levelH/2, z+pz);
    group.add(post);
  }});
  // beam levels (wire deck shelves)
  const shelfMat = new THREE.MeshStandardMaterial({{color: 0xeeeeee, transparent:true, opacity:0.55}});
  const beamMat = new THREE.MeshStandardMaterial({{color: ORANGE}});
  for (let l=1; l<=levels; l++) {{
    const y = l*levelH;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), shelfMat);
    shelf.position.set(x+w/2, y, z+d/2);
    group.add(shelf);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 4, 3), beamMat);
    beam.position.set(x+w/2, y, z);
    group.add(beam);
  }}
  return group;
}}

// Wall A -- 4 bays, 3 levels, green, door end
for (let b=0; b<CFG.wallA.bays; b++) {{
  scene.add(rackBay(CFG.wallA.x0 + b*CFG.wallA.bayW, CFG.wallA.y0, CFG.wallA.bayW-2, CFG.wallA.depth, CFG.wallA.levels, CFG.levelH, GREEN));
}}

// Wall D -- 2 bays, 4 levels, green, left side (only 2 of 3 bays ours; 3rd shown gray)
for (let b=0; b<3; b++) {{
  const color = b < CFG.wallD.bays ? GREEN : GRAYKIT;
  scene.add(rackBay(CFG.wallD.x0, CFG.wallD.y0 + b*CFG.wallD.bayLen, CFG.wallD.depth, CFG.wallD.bayLen-2, CFG.wallD.levels, CFG.levelH, color));
}}

// Center -- 7 bays (C01-C07), double-deep. Front face (ours, dark) + back face (kitchen's, gray)
// Center's total run (31.5ft) is shorter than Wall A's 32ft -- the leftover
// strip past Center's last bay is shown as a flat gray "no rack here" pad,
// matching the blueprint's hatched gap.
for (let b=0; b<CFG.center.bays; b++) {{
  scene.add(rackBay(CFG.center.x0 + b*CFG.center.bayW, CFG.center.y0, CFG.center.bayW-2, CFG.center.depth, 4, CFG.levelH, DARKINK));
  scene.add(rackBay(CFG.center.x0 + b*CFG.center.bayW, CFG.center.y0 + CFG.center.depth, CFG.center.bayW-2, CFG.center.depth, 4, CFG.levelH, GRAYKIT));
}}
if (CFG.center.totalRun < CFG.center.zoneW) {{
  const gapW = CFG.center.zoneW - CFG.center.totalRun;
  const gapPad = new THREE.Mesh(
    new THREE.BoxGeometry(gapW - 2, 2, CFG.center.depth*2 - 2),
    new THREE.MeshStandardMaterial({{color: 0xc7cbd1, transparent:true, opacity:0.5}})
  );
  gapPad.position.set(CFG.center.x0 + CFG.center.totalRun + gapW/2, 1, CFG.center.y0 + CFG.center.depth);
  scene.add(gapPad);
}}

// Real crate loads per position, from the actual product-location assignment
// (backstock_location_assignment.csv) -- one solid block per filled position,
// colored by category, height scaled to how full that position is. Each also
// gets an HTML label (same overlay technique as the main walk-in 3D model)
// showing the position code + every walk-in row code/product stored there,
// so a picker can match e.g. "K1-01" here to "K1-01" on the walk-in blueprint.
const labelLayer = document.getElementById('labelLayer');
const posLabels = [];
LOADS.forEach(ld => {{
  const mat = new THREE.MeshStandardMaterial({{color: ld.color}});
  const block = new THREE.Mesh(new THREE.BoxGeometry(ld.w, ld.h, ld.d), mat);
  block.position.set(ld.x + ld.w/2, ld.y0 + ld.h/2, ld.z + ld.d/2);
  scene.add(block);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(block.geometry),
    new THREE.LineBasicMaterial({{color: 0x111417, transparent:true, opacity:0.35}})
  );
  edges.position.copy(block.position);
  scene.add(edges);

  const div = document.createElement('div');
  div.className = 'pos-label';
  div.innerHTML = `<b>${{ld.code}}</b><br>${{ld.laneText}}`;
  labelLayer.appendChild(div);
  posLabels.push({{div, x: ld.x + ld.w/2, y: ld.y0 + ld.h + 10, z: ld.z + ld.d/2}});
}});

const labelVec = new THREE.Vector3();
const labelToggle = document.getElementById('labelToggle');
function updateLabels() {{
  const show = labelToggle.checked;
  labelLayer.style.display = show ? 'block' : 'none';
  if (!show) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const camDist = camera.position.distanceTo(controls.target);
  // Default view is ~1030 units out with 48 labels -- unreadable overlap.
  // Hide labels until zoomed in past 550 units so only a readable cluster shows.
  const declutter = camDist > 550;
  for (const lb of posLabels) {{
    labelVec.set(lb.x, lb.y, lb.z);
    labelVec.project(camera);
    if (labelVec.z > 1 || declutter) {{ lb.div.style.display = 'none'; continue; }}
    const sx = (labelVec.x * 0.5 + 0.5) * rect.width;
    const sy = (-labelVec.y * 0.5 + 0.5) * rect.height;
    if (sx < -60 || sx > rect.width + 60 || sy < -30 || sy > rect.height + 30) {{
      lb.div.style.display = 'none';
      continue;
    }}
    lb.div.style.display = 'block';
    lb.div.style.left = sx + 'px';
    lb.div.style.top = sy + 'px';
  }}
}}

function animate() {{
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  updateLabels();
}}
animate();

window.addEventListener('resize', () => {{
  camera.aspect = wrap.clientWidth/wrap.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
}});
</script>
</body></html>
'''

open('/home/claude/hummusfit-warehouse/backstock/backstock_3d.html', 'w').write(html_doc)
print('3D HTML written:', len(html_doc), 'bytes')
