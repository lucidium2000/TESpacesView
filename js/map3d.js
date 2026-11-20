// The 3D floor map: a three.js scene built from js/floor.js, in the Spaces
// style (light floor and white walls on a dark backdrop, tinted glass room
// volumes, tan desks, dark chairs), with HTML pins that follow the camera.
//
// Touch: one finger pans, two fingers pinch to zoom and twist to rotate.
// Mouse: drag pans, right-drag (or shift-drag) rotates and tilts, wheel zooms.
import * as THREE from '../vendor/three.module.min.js';
import { ICON } from './icons.js';
import { STATUS } from './data/shape.js';

const C = {
  slab: 0xeef0f4, slabSide: 0xb7bdc8, wall: 0xffffff, corridor: 0xe4e7ec,
  desk: 0xecd4a8, chair: 0x2e3440, screen: 0x111418, core: 0xc4cad4, coreTop: 0xd7dce4,
  table: 0xd8b98c, plant: 0x5e9a52, rack: 0x232831, atrium: 0xdfe3e9,
};
const DEFAULT_VIEW = { tx: 0, tz: 2, dist: 162, pitch: 0.98, bearing: -0.22 };
const PIN_BASE = 150;   // the camera distance at which pins are drawn at 1x

export class FloorMap {
  constructor(host, floor, { onSelect } = {}) {
    this.host = host; this.floor = floor; this.onSelect = onSelect || (() => {});
    const qs = new URLSearchParams(location.search);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, parseFloat(qs.get('dpr')) || 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.pinLayer = document.createElement('div');
    this.pinLayer.className = 'pins';
    host.appendChild(this.pinLayer);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 1000);
    this.view = { ...DEFAULT_VIEW }; this.goal = { ...DEFAULT_VIEW };
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b4, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35); sun.position.set(-40, 90, 30); this.scene.add(sun);

    this.inset = { x: 3.5, y: 1.2 };   // rem: how far to push the view right and down
    this.insetNow = { ...this.inset };
    this.places = new Map();   // place id -> { vol, floor, edges, pin, status }
    this.pins = [];
    this.selected = null; this.filter = null;
    this.build();
    this.bindControls();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = (t) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ── Scene ──
  box(w, h, d, color, x, y, z, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, ...opts }));
    m.position.set(x, y, z); this.scene.add(m); return m;
  }

  build() {
    const F = this.floor, [W, D] = F.size;
    // Slab: a pale floor with a darker edge, sitting on the dark backdrop.
    this.box(W + 3, 1.2, D + 3, C.slabSide, 0, -0.62, 0);
    this.box(W + 2.4, 0.1, D + 2.4, C.slab, 0, 0, 0);
    // Outer wall, low and white.
    const wh = 1.5, wt = 0.45;
    this.box(W + 2.4, wh, wt, C.wall, 0, wh / 2, -(D + 2.4) / 2);
    this.box(W + 2.4, wh, wt, C.wall, 0, wh / 2, (D + 2.4) / 2);
    this.box(wt, wh, D + 2.4, C.wall, -(W + 2.4) / 2, wh / 2, 0);
    this.box(wt, wh, D + 2.4, C.wall, (W + 2.4) / 2, wh / 2, 0);
    // Corridor strips (slightly darker floor) between the rooms and the open plan.
    this.box(W - 4, 0.02, 3, C.corridor, 0, 0.06, -20.5);
    this.box(W - 4, 0.02, 3, C.corridor, 0, 0.06, 20.5);

    for (const r of F.rooms) this.addRoom(r, 'room');
    for (const c of F.closets) this.addRoom(c, 'closet');
    for (const k of F.core) { this.box(k.w, 3.2, k.d, C.core, k.x, 1.6, k.z); this.box(k.w - 0.4, 0.05, k.d - 0.4, C.coreTop, k.x, 3.23, k.z); }
    this.addDesks();
    this.addAtrium();
    this.addCafe();
    this.addPlants();
    this.addPins();
  }

  addRoom(r, type) {
    const { x, z, w, d } = r, wallH = type === 'closet' ? 2.2 : 1.1, t = 0.22;
    const color = new THREE.Color(STATUS.none.color);
    const floor = this.box(w - 0.2, 0.06, d - 0.2, color, x, 0.09, z);
    const vol = this.box(w - 0.3, 2.5, d - 0.3, color.clone(), x, 1.3, z, { transparent: true, opacity: 0.3, depthWrite: false });
    vol.userData.place = r.id;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(vol.geometry), new THREE.LineBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.85 }));
    edges.position.copy(vol.position); this.scene.add(edges);
    // White walls, with a doorway on the side facing the middle of the floor.
    const door = 1.8, toMid = Math.abs(x) / (this.floor.size[0] / 2) > Math.abs(z) / (this.floor.size[1] / 2) ? (x > 0 ? 'w' : 'e') : (z > 0 ? 'n' : 's');
    const wall = (side) => {
      const horiz = side === 'n' || side === 's', len = horiz ? w : d;
      const px = side === 'e' ? x + w / 2 : side === 'w' ? x - w / 2 : x;
      const pz = side === 's' ? z + d / 2 : side === 'n' ? z - d / 2 : z;
      if (side !== toMid) { this.box(horiz ? len : t, wallH, horiz ? t : len, C.wall, px, wallH / 2, pz); return; }
      const seg = (len - door) / 2;   // two pieces either side of the door
      for (const s of [-1, 1]) {
        const off = s * (door / 2 + seg / 2);
        this.box(horiz ? seg : t, wallH, horiz ? t : seg, C.wall, horiz ? px + off : px, wallH / 2, horiz ? pz : pz + off);
      }
    };
    ['n', 's', 'e', 'w'].forEach(wall);
    if (type === 'room') {
      // Table and chairs, and the video device on the far wall.
      const long = w >= d, tw = long ? w * 0.52 : w * 0.36, td = long ? d * 0.34 : d * 0.5;
      this.box(tw, 0.12, td, C.table, x, 0.78, z); this.box(tw * 0.9, 0.7, td * 0.6, 0xb89a72, x, 0.38, z);
      const n = Math.max(2, Math.round((r.seats || 6) / 2));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n - 0.5;
        if (long) { this.box(0.6, 0.55, 0.6, C.chair, x + f * tw, 0.3, z - td / 2 - 0.6); this.box(0.6, 0.55, 0.6, C.chair, x + f * tw, 0.3, z + td / 2 + 0.6); }
        else { this.box(0.6, 0.55, 0.6, C.chair, x - tw / 2 - 0.6, 0.3, z + f * td); this.box(0.6, 0.55, 0.6, C.chair, x + tw / 2 + 0.6, 0.3, z + f * td); }
      }
      if (r.device) {
        const far = { n: [0, d / 2 - 0.35], s: [0, -d / 2 + 0.35], e: [-w / 2 + 0.35, 0], w: [w / 2 - 0.35, 0] }[toMid];
        const horiz = toMid === 'n' || toMid === 's';
        this.box(horiz ? Math.min(3.2, w * 0.35) : 0.12, 1.3, horiz ? 0.12 : Math.min(3.2, d * 0.35), C.screen, x + far[0], 1.6, z + far[1]);
      }
    } else {
      // Racks in the network closet.
      for (let i = -1; i <= 1; i += 2) this.box(1, 2, 1.1, C.rack, x + i * 1.3, 1.05, z);
    }
    this.places.set(r.id, { r, type, vol, floor, edges, status: 'none' });
  }

  addDesks() {
    const desks = [], chairs = [], mons = [];
    for (const g of this.floor.desks) {
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          const cx = g.x + (col - (g.cols - 1) / 2) * 1.9, cz = g.z + (row - (g.rows - 1) / 2) * 5.2;
          for (const s of [-1, 1]) {   // a pair of desks, back to back
            desks.push([cx, 0.74, cz + s * 0.45]);
            chairs.push([cx, 0.3, cz + s * 1.45]);
            mons.push([cx, 1.05, cz + s * 0.12]);
          }
        }
      }
    }
    const inst = (geo, color, list) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), list.length);
      const o = new THREE.Object3D();
      list.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
      this.scene.add(m);
    };
    inst(new THREE.BoxGeometry(1.7, 0.1, 0.85), C.desk, desks);
    inst(new THREE.BoxGeometry(0.62, 0.55, 0.62), C.chair, chairs);
    inst(new THREE.BoxGeometry(0.75, 0.45, 0.06), C.screen, mons);
  }

  addAtrium() {
    const a = this.floor.atrium;
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(a.r, a.r, 0.06, 64), new THREE.MeshLambertMaterial({ color: C.atrium }));
    fl.position.set(a.x, 0.1, a.z); this.scene.add(fl);
    // Curved wall with an opening facing south.
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(a.r, a.r, 1.5, 64, 1, true, Math.PI * 0.62, Math.PI * 1.76),
      new THREE.MeshLambertMaterial({ color: C.wall, side: THREE.DoubleSide }));
    wall.position.set(a.x, 0.75, a.z); this.scene.add(wall);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(a.r * 0.45, a.r * 0.45, 1.1, 48, 1, true), new THREE.MeshLambertMaterial({ color: C.wall, side: THREE.DoubleSide }));
    inner.position.set(a.x, 0.55, a.z); this.scene.add(inner);
    this.box(4.5, 2.2, 0.25, C.screen, a.x, 1.2, a.z - a.r + 1.2);   // the demo wall
  }

  addCafe() {
    const c = this.floor.cafe;
    this.box(c.w, 1.05, 1.1, 0xf4f4f4, c.x, 0.53, c.z - c.d / 2);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 20), new THREE.MeshLambertMaterial({ color: C.table }));
      t.position.set(c.x - 4.5 + i * 3, 0.76, c.z + 1); this.scene.add(t);
      for (const s of [-1, 1]) this.box(0.55, 0.5, 0.55, C.chair, c.x - 4.5 + i * 3 + s * 1.05, 0.28, c.z + 1);
    }
  }

  addPlants() {
    const geo = new THREE.IcosahedronGeometry(0.75, 0), mat = new THREE.MeshLambertMaterial({ color: C.plant, flatShading: true });
    for (const [x, z] of [[-40, -18], [-20, -18], [20, -18], [40, -18], [-8, 21], [36, 21], [44, 8], [-40, 8], [18, 6], [-18, -10]]) {
      const p = new THREE.Mesh(geo, mat); p.position.set(x, 0.9, z); this.scene.add(p);
      this.box(0.6, 0.5, 0.6, 0xf2f2f2, x, 0.25, z);
    }
  }

  // ── Pins (HTML, positioned every frame) ──
  addPins() {
    const add = (el, x, y, z, place) => { this.pinLayer.appendChild(el); this.pins.push({ el, p: new THREE.Vector3(x, y, z), place }); return el; };
    for (const r of this.floor.rooms) {
      const el = document.createElement('button');
      el.className = 'pin pin-room' + (r.agent ? '' : ' no-agent');
      el.dataset.place = r.id;
      el.innerHTML = `<span class="pin-dot">${r.agent ? ICON.roomDevice : ICON.people}</span><span class="pin-name">${r.name}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.select(r.id, true); });
      this.places.get(r.id).pin = add(el, r.x, 2.7, r.z, r.id);
    }
    for (const c of this.floor.closets) {
      const el = document.createElement('button');
      el.className = 'pin pin-room pin-closet';
      el.dataset.place = c.id;
      el.innerHTML = `<span class="pin-dot">${c.device.startsWith('Meraki') ? ICON.router : ICON.switch}</span><span class="pin-name">${c.name}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.select(c.id, true); });
      this.places.get(c.id).pin = add(el, c.x, 2.9, c.z, c.id);
    }
    for (const p of this.floor.pois) {
      const el = document.createElement('span');
      el.className = 'pin pin-poi'; el.dataset.kind = p.kind; el.title = p.name;
      el.innerHTML = ICON[p.kind] || ICON.pin;
      add(el, p.x, 1.6, p.z);
    }
    const a = this.floor.atrium;
    for (const r of a.rooms) {
      const el = document.createElement('span');
      el.className = 'pin pin-tag'; el.textContent = r.name;
      add(el, a.x + Math.cos(r.a) * a.r * 0.72, 1.4, a.z + Math.sin(r.a) * a.r * 0.72);
    }
    const k = this.floor.kiosk;
    const you = document.createElement('span');
    you.className = 'pin pin-you'; you.innerHTML = `<b>${k.label}</b>`;
    this.you = add(you, k.x, 1.2, k.z);
  }

  // ── Status, selection, filter ──
  setStatus(byPlace) {
    for (const [id, pl] of this.places) {
      const s = byPlace[id] || 'none';
      pl.status = s;
      if (pl.pin) pl.pin.dataset.status = s;
    }
    this.restyle();
  }

  setFilter(fn) { this.filter = fn; this.restyle(); }

  restyle() {
    for (const [id, pl] of this.places) {
      const dim = this.filter && !this.filter(id, pl.status);
      const sel = this.selected === id;
      const none = pl.status === 'none';
      const col = new THREE.Color(dim ? STATUS.none.color : (STATUS[pl.status] || STATUS.none).color);
      pl.vol.material.color.copy(col); pl.floor.material.color.copy(col); pl.edges.material.color.copy(col);
      pl.vol.material.opacity = dim ? 0.05 : sel ? 0.55 : none ? 0.12 : 0.32;
      
      pl.edges.material.opacity = dim ? 0.15 : sel ? 1 : 0.8;
      if (pl.pin) { pl.pin.classList.toggle('dim', !!dim); pl.pin.classList.toggle('selected', sel); }
    }
  }

  select(id, fromMap) {
    this.selected = id;
    this.restyle();
    const pl = id && this.places.get(id);
    if (pl) this.flyTo({ tx: pl.r.x, tz: pl.r.z + 2, dist: 92, pitch: 0.98, bearing: this.goal.bearing });
    if (fromMap) this.onSelect(id);
  }

  flyTo(v) { Object.assign(this.goal, v); }
  reset() { this.selected = null; this.restyle(); this.goal = { ...DEFAULT_VIEW }; }
  whereAmI() {
    const k = this.floor.kiosk;
    this.flyTo({ tx: k.x, tz: k.z, dist: 70, pitch: 1.0 });
    this.you.classList.remove('bounce'); void this.you.offsetWidth; this.you.classList.add('bounce');
  }

  // ── Controls ──
  bindControls() {
    const el = this.renderer.domElement, pts = new Map();
    let moved = 0, start = null, mode = 'pan', last2 = null;
    const ground = (dx, dy) => {   // screen delta -> ground delta (pan)
      // Screen right is (cos b, -sin b) on the ground, away from the viewer is (-sin b, -cos b);
      // moving the finger drags the ground with it.
      const k = this.goal.dist / this.host.clientHeight * 0.55, b = this.goal.bearing, kf = k / Math.sin(this.goal.pitch);
      this.goal.tx += -dx * k * Math.cos(b) - dy * kf * Math.sin(b);
      this.goal.tz += dx * k * Math.sin(b) - dy * kf * Math.cos(b);
    };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; start = { x: e.clientX, y: e.clientY };
      mode = e.button === 2 || e.shiftKey ? 'rotate' : 'pan';
      last2 = null;
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 1) {
        if (mode === 'rotate') { this.goal.bearing -= dx * 0.006; this.goal.pitch = clamp(this.goal.pitch - dy * 0.004, 0.45, 1.35); }
        else ground(dx, dy);
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (last2) {
          this.goal.dist = clamp(this.goal.dist * last2.d / d, 35, 240);
          let da = ang - last2.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
          this.goal.bearing -= da;
        }
        last2 = { d, ang };
      }
      this.clampTarget();
    });
    const up = (e) => {
      pts.delete(e.pointerId); last2 = null;
      if (pts.size === 0 && moved < 8 && start) this.tap(e.clientX, e.clientY);
      if (pts.size === 0) start = null;
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.goal.dist = clamp(this.goal.dist * Math.exp(e.deltaY * 0.0012), 35, 240); }, { passive: false });
  }

  clampTarget() {
    const [W, D] = this.floor.size;
    this.goal.tx = clamp(this.goal.tx, -W / 2, W / 2); this.goal.tz = clamp(this.goal.tz, -D / 2, D / 2);
  }

  tap(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects([...this.places.values()].map((p) => p.vol))[0];
    if (hit) this.select(hit.object.userData.place, true);
    else { this.selected = null; this.restyle(); this.onSelect(null); }
  }

  // ── Frame ──
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / Math.max(1, h);
    this.rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.applyInset();
  }

  // Centre the floor in the open area between the panels (eased when a card opens or closes).
  applyInset() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.camera.setViewOffset(w, h, -this.insetNow.x * this.rem, -this.insetNow.y * this.rem, w, h);
    this.camera.updateProjectionMatrix();
  }
  setInset(x, y) { this.inset = { x, y }; }

  frame() {
    const v = this.view, g = this.goal, k = 0.12;
    if (Math.abs(this.insetNow.x - this.inset.x) > 0.01 || Math.abs(this.insetNow.y - this.inset.y) > 0.01) {
      this.insetNow.x += (this.inset.x - this.insetNow.x) * k; this.insetNow.y += (this.inset.y - this.insetNow.y) * k;
      this.applyInset();
    }
    let db = g.bearing - v.bearing;
    for (const key of ['tx', 'tz', 'dist', 'pitch']) v[key] += (g[key] - v[key]) * k;
    v.bearing += db * k;
    const target = new THREE.Vector3(v.tx, 0, v.tz);
    const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
    this.camera.position.set(v.tx + v.dist * cp * Math.sin(v.bearing), v.dist * sp, v.tz + v.dist * cp * Math.cos(v.bearing));
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);

    // Pins: project, scale a little with zoom, and hide those off-screen.
    const w = this.host.clientWidth, h = this.host.clientHeight, s = clamp(PIN_BASE / v.dist, 0.72, 1.35);
    const q = new THREE.Vector3();
    for (const pin of this.pins) {
      q.copy(pin.p).project(this.camera);
      const x = (q.x + 1) / 2 * w, y = (1 - q.y) / 2 * h;
      const off = q.z > 1 || x < -60 || x > w + 60 || y < -60 || y > h + 60;
      pin.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`;
      pin.el.style.visibility = off ? 'hidden' : '';
      pin.el.style.zIndex = String(Math.round((1 - q.z) * 100000));
    }
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
