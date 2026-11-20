// The data-flow layer: ThousandEyes test traffic made visible on the floor map.
//
//  - Overhead cable trays (glowing tubes) from every agent to its IDF and the MDF.
//  - Uplinks that rise out of the MDF and arc over the ISPs and a peering point
//    to the services the agents test (Webex, Microsoft 365, ...), which float
//    beyond the building.
//  - Particles stream along those paths: their speed follows latency, their
//    colour the test's health, and lossy paths drop particles as red sparks.
//  - Test-round ripples from each agent, scan beams in critical rooms, and a
//    holographic grid with a radar sweep under the building.
//  - focus(agent): that agent's path lit up hop by hop, with per-hop labels.
//  - trace(agent, ms): a comet runs the path like a live traceroute.
import * as THREE from '../vendor/three.module.min.js';

const COL = { healthy: new THREE.Color('#38d9ff'), degraded: new THREE.Color('#ffb020'), critical: new THREE.Color('#ff4757'), offline: new THREE.Color('#5d6575'), nodata: new THREE.Color('#5d6575') };
const TRAY_Y = 3.1;

// How busy the flow looks. ?flow=full brings back the original, busier look.
const FULL = new URLSearchParams(location.search).get('flow') === 'full';
const FLOW = FULL
  ? { perTrack: 9, size: 5.2, alpha: 1, trip: 2.6, spark: 9, rippleEvery: 3, ripple: 0.55, sweep: 1 }
  : { perTrack: 4, size: 3.6, alpha: 0.7, trip: 4.2, spark: 5, rippleEvery: 6, ripple: 0.3, sweep: 0.5 };
const EAST = new Set(['paris', 'oslo', 'beijing', 'toronto', 'tokyo', 'mexico', 'sf', 'idf2']);

// Places beyond the building (x, y, z). The services sit in a row above the far side.
const SKY = {
  isp: { att: { name: 'AT&T', asn: 'AS7018', p: [-26, 6, -42] }, comcast: { name: 'Comcast Business', asn: 'AS7922', p: [26, 6, -42] } },
  ixp: { name: 'Equinix SV5', asn: 'Peering', p: [0, 6, -48] },
  svc: {
    dns: { name: 'DNS · Umbrella', p: [-58, 11, -58] },
    m365: { name: 'Microsoft 365', p: [-30, 14, -64] },
    webex: { name: 'Webex', p: [0, 16, -68] },
    sfdc: { name: 'Salesforce', p: [30, 14, -64] },
    dc1: { name: 'Data Center DC1', p: [58, 11, -58] },
  },

};

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.18, 'rgba(255,255,255,.85)'); r.addColorStop(0.45, 'rgba(255,255,255,.22)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.75, 'rgba(255,255,255,.9)'); r.addColorStop(0.86, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const add = (mat) => Object.assign(mat, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

/** A curve sampled evenly by distance, for cheap lookups while animating. */
class Track {
  constructor(curves, n = 160) {
    this.pts = []; this.marks = [];
    for (const c of curves) {
      const sp = c.getSpacedPoints(Math.max(8, Math.round(n * c.getLength() / 120)));
      if (this.pts.length) sp.shift();
      this.marks.push(this.pts.length);   // the index where each piece starts (a hop)
      this.pts.push(...sp);
    }
    this.marks.push(this.pts.length - 1);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.len = this.cum[this.cum.length - 1];
  }
  at(s, out) {
    s = Math.max(0, Math.min(this.len, s));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] < s) lo = m; else hi = m; }
    const a = this.pts[lo], b = this.pts[hi], f = (s - this.cum[lo]) / Math.max(1e-6, this.cum[hi] - this.cum[lo]);
    return out.copy(a).lerp(b, f);
  }
  distAtMark(k) { return this.cum[this.marks[Math.min(k, this.marks.length - 1)]]; }
}

export class FlowLayer {
  constructor(map) {
    this.map = map; this.scene = map.scene; this.floor = map.floor;
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.glow = glowTexture(); this.ringTex = ringTexture();
    this.on = true; this.focusId = null; this.snap = null; this.traceRun = null;
    // The internet side (ISPs, peering, services) shows only for the focused agent's path, unless ?sky=1.
    this.sky = new URLSearchParams(location.search).get('sky') === '1';
    this.skyKeys = new Set();
    this.built = false;
    this.buildGrid();
    this.buildSky();
    map.hooks.push((dt, t) => this.tick(dt, t));
  }

  // ── The holographic ground grid with a radar sweep ──
  buildGrid() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime; varying vec2 vP;
        float grid(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          float r = length(vP - vec2(0.0, -20.0));
          float fade = 1.0 - smoothstep(30.0, 230.0, r);
          float g = grid(vP, 4.0) * 0.22 + grid(vP, 20.0) * 0.35;
          float ang = atan(vP.y + 20.0, vP.x);
          float sw = mod(ang - uTime * 0.45, 6.28318);
          float sweep = (exp(-sw * 2.4) * 0.55 + exp(-sw * 14.0) * 0.6) * ${FLOW.sweep.toFixed(2)};
          float ring = exp(-pow((r - mod(uTime * 26.0, 240.0)) / 3.0, 2.0)) * 0.35;
          vec3 c = vec3(0.16, 0.55, 1.0) * (g * (0.55 + sweep) + sweep * 0.08 + ring * (0.4 + g));
          gl_FragColor = vec4(c * fade, 1.0);
        }`,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), mat);
    plane.rotation.x = -Math.PI / 2; plane.position.y = -1.3;
    this.gridMat = mat; this.scene.add(plane);
  }

  // ── Services, ISPs and the peering point floating beyond the building ──
  buildSky() {
    this.nodes = {};
    const node = (key, def, size, kind) => {
      const g = new THREE.Group(); g.position.copy(v3(def.p));
      const halo = new THREE.Sprite(add(new THREE.SpriteMaterial({ map: this.glow, color: COL.healthy, opacity: 0.85 })));
      halo.scale.setScalar(size * 3.2); g.add(halo);
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 0.42, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.9 }));
      g.add(core);
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(size, size * 0.05, 8, 64), add(new THREE.MeshBasicMaterial({ color: COL.healthy, opacity: 0.9 })));
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(size * 1.35, size * 0.025, 8, 64), add(new THREE.MeshBasicMaterial({ color: COL.healthy, opacity: 0.55 })));
      ring1.rotation.x = Math.PI / 2.4; ring2.rotation.x = Math.PI / 1.7; g.add(ring1, ring2);
      this.group.add(g);
      const el = document.createElement('div');
      el.className = 'pin pin-svc' + (kind === 'svc' ? '' : ' small');
      const logo = key === 'svc:webex' ? '<img class="svc-logo" src="assets/webex-mark.png" alt="" onerror="this.remove()">' : '';
      el.innerHTML = `<div class="svc-card">${logo}<b>${def.name}</b><small>${def.asn || ''}</small><em></em></div>`;
      const pin = this.map.addPin(el, v3(def.p).add(new THREE.Vector3(0, -size * 1.9, 0)));
      this.nodes[key] = { key, g, halo, core, ring1, ring2, el, pin, size, kind, def };
    };
    for (const [k, d] of Object.entries(SKY.svc)) node('svc:' + k, d, 2.6, 'svc');
    for (const [k, d] of Object.entries(SKY.isp)) node('isp:' + k, d, 1.7, 'isp');
    node('ixp', SKY.ixp, 1.9, 'ixp');
  }

  // ── Routes for the current agents ──
  where(id) {
    const F = this.floor;
    return F.rooms.find((r) => r.id === id) || F.closets.find((c) => c.id === id);
  }

  /** Overhead path from a room or closet to a target closet (Manhattan, along the corridors). */
  trayRoute(from, to, startY) {
    const pts = [new THREE.Vector3(from.x, startY, from.z), new THREE.Vector3(from.x, TRAY_Y, from.z)];
    const zc = Math.abs(from.z) > 15 ? Math.sign(from.z) * 19 : (to.z > 0 ? 19 : -19);   // the corridor to run along
    const xEnd = to.x;
    if (Math.abs(from.z - zc) > 0.5) pts.push(new THREE.Vector3(from.x, TRAY_Y, zc));
    pts.push(new THREE.Vector3(xEnd, TRAY_Y, zc));
    pts.push(new THREE.Vector3(xEnd, TRAY_Y, to.z));
    pts.push(new THREE.Vector3(to.x, 2.3, to.z));
    const out = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 0.05) out.push(new THREE.LineCurve3(pts[i - 1], pts[i]));
    return out;
  }

  build(snap) {
    // Clear the old routes (keep the grid and the sky nodes).
    for (const o of this.dynamic || []) { this.group.remove(o); o.geometry && o.geometry.dispose(); }
    this.dynamic = [];
    const mdf = this.where('mdf'), mdfTop = new THREE.Vector3(mdf.x, 9, mdf.z);
    this.routes = new Map();   // agent id -> { floor: [curves], hops: [Vector3...], ispKey }
    for (const a of snap.agents) {
      const at = this.where(a.place); if (!at) continue;
      const east = EAST.has(a.place), ispKey = east ? 'comcast' : 'att';
      let floor = [], hops = [];
      const p0 = new THREE.Vector3(at.x, a.kind === 'endpoint' ? 1.6 : 2.2, at.z);
      hops.push(p0);
      if (a.kind === 'endpoint') {
        const idf = this.where(east ? 'idf2' : 'idf1');
        floor.push(...this.trayRoute(at, idf, 1.6));
        hops.push(new THREE.Vector3(idf.x, 2.3, idf.z));
        floor.push(...this.trayRoute(idf, mdf, 2.3));
      } else if (a.place !== 'mdf') {
        floor.push(...this.trayRoute(at, mdf, 2.2));
      }
      hops.push(new THREE.Vector3(mdf.x, 2.3, mdf.z));
      floor.push(new THREE.LineCurve3(new THREE.Vector3(mdf.x, 2.3, mdf.z), mdfTop));
      this.routes.set(a.id, { floor, hops, ispKey, agent: a });
    }
    // Uplink curves: MDF top -> ISP -> peering -> service.
    this.uplinks = new Map();
    const ixp = v3(SKY.ixp.p);
    for (const ispKey of ['att', 'comcast']) {
      const isp = v3(SKY.isp[ispKey].p);
      for (const [sk, sd] of Object.entries(SKY.svc)) {
        const svc = v3(sd.p);
        const c1 = new THREE.QuadraticBezierCurve3(mdfTop, new THREE.Vector3((mdfTop.x + isp.x) / 2, 14, (mdfTop.z + isp.z) / 2), isp);
        const c2 = new THREE.QuadraticBezierCurve3(isp, new THREE.Vector3((isp.x + ixp.x) / 2, ixp.y + 3, (isp.z + ixp.z) / 2), ixp);
        const c3 = new THREE.QuadraticBezierCurve3(ixp, new THREE.Vector3((ixp.x + svc.x) / 2, Math.max(ixp.y, svc.y) + 5, (ixp.z + svc.z) / 2), svc);
        this.uplinks.set(ispKey + ':' + sk, [c1, c2, c3]);
      }
    }
    // Tubes: one per agent floor route, one per uplink in use.
    this.tubes = new Map();
    const tube = (curves, r, color, opacity) => {
      const path = new THREE.CurvePath(); curves.forEach((c) => path.add(c));
      const geo = new THREE.TubeGeometry(path, Math.max(16, Math.round(path.getLength() * 1.2)), r, 6, false);
      const m = new THREE.Mesh(geo, add(new THREE.MeshBasicMaterial({ color: color.clone(), opacity })));
      this.group.add(m); this.dynamic.push(m); return m;
    };
    for (const [id, r] of this.routes) this.tubes.set('a:' + id, tube(r.floor, 0.07, COL[r.agent.status] || COL.healthy, 0.22));
    const used = new Set();
    for (const r of this.routes.values()) for (const t of r.agent.tests) used.add(r.ispKey + ':' + t.id);
    for (const k of used) if (this.uplinks.has(k)) { const tb = tube(this.uplinks.get(k), 0.12, COL.healthy, 0.18); tb.visible = this.sky; this.tubes.set('u:' + k, tb); }

    // Tracks for particles: every agent x test.
    this.tracks = [];
    for (const [id, r] of this.routes) {
      for (const t of r.agent.tests) {
        const up = this.uplinks.get(r.ispKey + ':' + t.id); if (!up) continue;
        const tr = new Track([...r.floor, ...up]);
        tr.agent = id; tr.test = t.id; tr.ispDist = tr.distAtMark(r.floor.length); // where the ISP segment starts
        this.tracks.push(tr);
      }
    }
    this.buildParticles();
    this.buildRipples(snap);
    this.buildScans(snap);
    this.built = true;
  }

  buildParticles() {
    const N = Math.min(1400, this.tracks.length * FLOW.perTrack);
    if (this.points) { this.group.remove(this.points); this.points.geometry.dispose(); }
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pSize = new Float32Array(N); this.pAlpha = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d); a = a * a; gl_FragColor = vec4(vC * (0.6 + a), a * vA); }`,
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false;
    this.group.add(this.points);
    this.parts = [];
    for (let i = 0; i < N; i++) this.parts.push(this.spawn({}, true));
  }

  spawn(p, anywhere) {
    const tr = this.tracks[Math.floor(Math.random() * this.tracks.length)];
    p.tr = tr; p.s = anywhere ? Math.random() * tr.len : 0; p.drop = -1; p.dying = 0;
    const ag = this.snap && this.snap.agents.find((a) => a.id === tr.agent);
    const t = ag && ag.tests.find((x) => x.id === tr.test);
    p.status = ag && ag.status === 'offline' ? 'offline' : (t ? t.status : 'healthy');
    const lat = (t && t.latency) || 30;
    p.speed = tr.len / (FLOW.trip + lat / 60) * (0.85 + Math.random() * 0.3);   // slower when latency is high
    if (t && t.loss > 0.3 && Math.random() < Math.min(0.85, t.loss / 6)) p.drop = tr.ispDist + Math.random() * 8;   // lost at the ISP
    p.off = p.status === 'offline';
    return p;
  }

  buildRipples(snap) {
    for (const r of this.ripples || []) this.group.remove(r.m);
    this.ripples = [];
    for (const a of snap.agents) {
      const at = this.where(a.place); if (!at || a.status === 'offline') continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), add(new THREE.MeshBasicMaterial({ map: this.ringTex, color: (COL[a.status] || COL.healthy).clone(), opacity: 0 })));
      m.rotation.x = -Math.PI / 2; m.position.set(at.x, 0.2, at.z);
      this.group.add(m); this.ripples.push({ m, phase: Math.random() * 3, id: a.id });
    }
  }

  buildScans(snap) {
    for (const s of this.scans || []) this.group.remove(s.m);
    this.scans = [];
    for (const a of snap.agents) {
      if (a.status !== 'critical') continue;
      const at = this.where(a.place); if (!at) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(at.w - 0.4, 0.06, at.d - 0.4), add(new THREE.MeshBasicMaterial({ color: COL.critical, opacity: 0.7 })));
      m.position.set(at.x, 0.2, at.z); this.group.add(m); this.scans.push({ m, at });
    }
  }

  // ── Data in ──
  setData(snap) {
    const sig = snap.agents.map((a) => a.id + a.status).join();
    this.snap = snap;
    if (!this.built || sig !== this.sig) { this.build(snap); this.sig = sig; }
    // Re-time existing particles to the new numbers as they respawn; colour the tubes and nodes.
    for (const [id, r] of this.routes) {
      const a = snap.agents.find((x) => x.id === id); if (!a) continue;
      r.agent = a;
      this.tubes.get('a:' + id).material.color.copy(COL[a.status] || COL.healthy);
    }
    const agg = {};
    for (const a of snap.agents) for (const t of a.tests) {
      const k = t.id; (agg[k] = agg[k] || { lat: [], loss: [], bad: 0, n: 0 });
      if (t.latency != null) { agg[k].lat.push(t.latency); agg[k].loss.push(t.loss); }
      agg[k].n++; if (t.status === 'critical') agg[k].bad += 2; else if (t.status === 'degraded') agg[k].bad++;
    }
    for (const [sk] of Object.entries(SKY.svc)) {
      const n = this.nodes['svc:' + sk], g = agg[sk];
      if (!g) { n.g.visible = false; n.pin.off = true; continue; }
      const lat = g.lat.reduce((s, v) => s + v, 0) / Math.max(1, g.lat.length), loss = g.loss.reduce((s, v) => s + v, 0) / Math.max(1, g.loss.length);
      const st = g.bad / g.n > 0.5 ? 'critical' : g.bad > 0 ? 'degraded' : 'healthy';
      this.paintNode(n, st);
      n.el.querySelector('em').innerHTML = `${Math.round(lat)} ms <i>·</i> ${loss.toFixed(1)}% loss`;
      n.el.dataset.status = st;
    }
    // ISPs: health of the paths through them.
    for (const ispKey of ['att', 'comcast']) {
      const through = [...this.routes.values()].filter((r) => r.ispKey === ispKey && r.agent.status !== 'offline');
      const hot = through.filter((r) => (r.agent.path || []).some((h) => h.hot)).length;
      const n = this.nodes['isp:' + ispKey], st = hot > through.length / 2 ? 'critical' : hot ? 'degraded' : 'healthy';
      this.paintNode(n, st);
      const lossAvg = through.flatMap((r) => r.agent.tests.map((t) => t.loss || 0));
      n.el.querySelector('em').innerHTML = `${through.length} agents <i>·</i> ${(lossAvg.reduce((s, v) => s + v, 0) / Math.max(1, lossAvg.length)).toFixed(1)}% loss`;
      n.el.dataset.status = st;
      for (const sk of Object.keys(SKY.svc)) { const tb = this.tubes.get('u:' + ispKey + ':' + sk); if (tb) tb.material.color.copy(COL[st]); }
    }
    this.paintNode(this.nodes.ixp, 'healthy');
    this.nodes.ixp.el.querySelector('em').textContent = 'Internet exchange';
    for (const rp of this.ripples) { const a = snap.agents.find((x) => x.id === rp.id); if (a) rp.m.material.color.copy(COL[a.status] || COL.healthy); }
    if (this.focusId) this.focus(this.focusId);
  }

  paintNode(n, st) {
    const c = COL[st] || COL.healthy;
    n.halo.material.color.copy(c); n.ring1.material.color.copy(c); n.ring2.material.color.copy(c);
    n.status = st;
  }

  // ── Focus on one agent: light its path, label each hop ──
  focus(id) {
    this.focusId = id;
    for (const h of this.hopPins || []) { h.el.remove(); h.off = true; }
    this.map.pins = this.map.pins.filter((p) => !(this.hopPins || []).includes(p));
    this.hopPins = [];
    for (const m of this.hopMarks || []) this.group.remove(m);
    this.hopMarks = [];
    if (this.focusLine) { this.group.remove(this.focusLine); this.focusLine = null; }
    const r = id && this.routes && this.routes.get(id);
    const svcKey = r ? ((r.agent.tests.find((t) => t.id === 'webex') || r.agent.tests[0] || {}).id || 'webex') : null;
    this.skyKeys = new Set(r ? ['isp:' + r.ispKey, 'ixp', 'svc:' + svcKey] : []);
    this.focusSvc = svcKey;
    for (const [k, tb] of this.tubes || []) {
      const up = k.startsWith('u:');
      const mine = r && (k === 'a:' + id || k === 'u:' + r.ispKey + ':' + svcKey);
      tb.material.opacity = !r ? (up ? 0.18 : 0.22) : mine ? 0.75 : 0.05;
      tb.visible = !up || this.sky || mine;
    }
    if (!r) return;
    const a = r.agent;
    // The hops in 3D: agent, (IDF), MDF, ISP, peering, service edge.
    const pos = [...r.hops, v3(SKY.isp[r.ispKey].p), v3(SKY.ixp.p), v3(SKY.svc[svcKey].p)];
    this.focusPts = pos;
    const hops = a.path && a.path.length ? a.path : [];
    pos.forEach((p, i) => {
      const h = hops[i]; if (!h && i < pos.length - 3) return;
      const m = new THREE.Sprite(add(new THREE.SpriteMaterial({ map: this.glow, color: h && h.hot ? COL.critical : COL.healthy, opacity: 1 })));
      m.position.copy(p); m.scale.setScalar(i >= pos.length - 3 ? 0 : 2.6); this.group.add(m); this.hopMarks.push(m);
      if (!h) return;
      const el = document.createElement('div');
      el.className = 'pin pin-hop' + (h.hot ? ' hot' : '');
      el.innerHTML = `<span><i>${i + 1}</i><b>${h.name}</b><em>${h.ms} ms</em></span>`;
      const pin = this.map.addPin(el, p.clone().add(new THREE.Vector3(0, i >= pos.length - 3 ? 4.2 : 1.6, 0)));
      pin.hop = i; this.hopPins.push(pin);
    });
    this.revealHops(this.traceRun && this.traceRun.id === id ? 0 : 99);
  }

  /** A camera view that fits the focused path (from the room out to the service). */
  frame() {
    const pts = this.focusPts; if (!pts || !pts.length) return null;
    const box = new THREE.Box3().setFromPoints(pts);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    return { tx: c.x, tz: c.z + 6, dist: Math.max(140, Math.max(size.x * 1.4, size.z * 1.7) + 60), pitch: 0.82 };
  }

  revealHops(n) { (this.hopPins || []).forEach((p) => p.el.classList.toggle('shown', p.hop < n)); }

  /** A comet along the focused agent's path, hop by hop (an instant test). */
  trace(id, ms = 4500) {
    const r = this.routes && this.routes.get(id); if (!r) return;
    const svcKey = (r.agent.tests.find((t) => t.id === 'webex') || r.agent.tests[0]).id;
    const tr = new Track([...r.floor, ...this.uplinks.get(r.ispKey + ':' + svcKey)]);
    if (!this.comet) {
      this.comet = new THREE.Sprite(add(new THREE.SpriteMaterial({ map: this.glow, color: 0xffffff, opacity: 1 })));
      this.comet.scale.setScalar(5); this.group.add(this.comet);
      this.tail = []; for (let i = 0; i < 14; i++) { const s = new THREE.Sprite(add(new THREE.SpriteMaterial({ map: this.glow, color: COL.healthy, opacity: 0.6 * (1 - i / 14) }))); s.scale.setScalar(3.4 * (1 - i / 16)); this.group.add(s); this.tail.push(s); }
    }
    // Hop boundaries along the track: agent, idf?, mdf, isp, ixp, svc.
    const nFloorHops = r.hops.length;
    const markD = [0];
    let acc = 0; for (let i = 0; i < r.floor.length; i++) acc += r.floor[i].getLength();
    // floor hops spread over the floor part in proportion; uplink hops at curve ends.
    for (let i = 1; i < nFloorHops; i++) markD.push(acc * i / nFloorHops * 0.98);
    const up = this.uplinks.get(r.ispKey + ':' + svcKey);
    let d = acc; for (const c of up) { d += c.getLength(); markD.push(d); }
    this.traceRun = { id, tr, t0: performance.now(), ms, markD };
    this.focus(id);
  }

  // ── Per frame ──
  tick(dt, t) {
    this.gridMat.uniforms.uTime.value = t;
    for (const n of Object.values(this.nodes)) {
      n.ring1.rotation.z += dt * 0.6; n.ring2.rotation.z -= dt * 0.35; n.core.rotation.y += dt * 0.4;
      const pulse = 1 + 0.08 * Math.sin(t * 2 + n.size);
      n.halo.scale.setScalar(n.size * 3.2 * pulse * (n.status === 'critical' ? 1 + 0.25 * Math.abs(Math.sin(t * 3)) : 1));
      const show = this.on && (this.sky || this.skyKeys.has(n.key));
      n.g.visible = show; n.pin.off = !show;
    }
    if (!this.built) return;
    this.group.visible = this.on;
    // Ripples: one per test round, every ~3 s.
    for (const rp of this.ripples) {
      const k = ((t + rp.phase) % FLOW.rippleEvery) / FLOW.rippleEvery;
      rp.m.scale.setScalar(1 + k * 13); rp.m.material.opacity = (1 - k) * FLOW.ripple * (this.focusId && this.focusId !== rp.id ? 0.2 : 1);
    }
    for (const s of this.scans) { const k = (t * 0.6) % 1; s.m.position.y = 0.2 + k * 2.4; s.m.material.opacity = 0.45 * (1 - k); }
    // Particles.
    const q = new THREE.Vector3(), dim = !!this.focusId;
    this.points.material.uniforms.uScale.value = this.map.renderer.domElement.height * 0.5;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.dying > 0) {
        p.dying -= dt;
        if (p.dying <= 0) this.spawn(p);
      } else {
        p.s += p.speed * dt;
        if (p.drop > 0 && p.s >= p.drop) { p.dying = 0.9; p.s = p.drop; }
        if (p.s >= p.tr.len) this.spawn(p);
        // Without the sky, traffic rises out of the MDF and fades away above the building.
        else if (!this.sky && !this.upOk(p.tr) && p.s > p.tr.ispDist + 4) this.spawn(p);
      }
      p.tr.at(p.s, q);
      const c = p.dying > 0 ? COL.critical : COL[p.status] || COL.healthy;
      const mine = !dim || p.tr.agent === this.focusId;
      let alpha = p.off ? 0 : mine ? FLOW.alpha : 0.06, size = FLOW.size;
      if (p.dying > 0) { alpha *= p.dying / 0.9; size = FLOW.size + (0.9 - p.dying) * FLOW.spark; q.y += (0.9 - p.dying) * 1.5; }
      let fadeIn = Math.min(1, p.s / 2);
      if (!this.sky && !this.upOk(p.tr) && p.dying <= 0) fadeIn *= Math.max(0, Math.min(1, (p.tr.ispDist + 4 - p.s) / 7));
      this.pPos[i * 3] = q.x; this.pPos[i * 3 + 1] = q.y; this.pPos[i * 3 + 2] = q.z;
      this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
      this.pSize[i] = size * (p.tr.agent === this.focusId ? 1.5 : 1); this.pAlpha[i] = alpha * fadeIn;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
    // Trace comet.
    const run = this.traceRun;
    if (run && this.comet) {
      const k = Math.min(1, (performance.now() - run.t0) / run.ms), s = run.tr.len * (1 - Math.pow(1 - k, 1.6));
      this.comet.visible = true; run.tr.at(s, this.comet.position);
      this.tail.forEach((sp, i) => { sp.visible = true; run.tr.at(Math.max(0, s - (i + 1) * 1.6), sp.position); });
      this.revealHops(run.markD.filter((d) => d <= s + 0.5).length);
      if (k >= 1) { this.traceRun = null; this.comet.visible = false; this.tail.forEach((sp) => { sp.visible = false; }); this.revealHops(99); }
    }
  }

  /** Whether particles on this track carry on past the building (its uplink is on screen). */
  upOk(tr) { return tr.agent === this.focusId && tr.test === this.focusSvc; }

  setOn(on) { this.on = on; this.map.setDark(on); for (const n of Object.values(this.nodes)) n.pin.off = !on; for (const h of this.hopPins || []) h.off = !on; }
}
