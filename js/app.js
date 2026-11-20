// ThousandEyes agents on a Spaces-style floor map.
//   ?data=mock (default) [&scenario=calm|incident|outage]
//   ?data=te&site=lab    real data: sites/lab.json + a token entered on the device
import { FLOOR } from './floor.js';
import { FloorMap } from './map3d.js';
import { MockSource } from './data/mock.js';
import { TESource, teToken } from './data/te.js';
import { STATUS, LIMITS } from './data/shape.js';
import { ICON, CISCO_MARK } from './icons.js';

const qs = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { snap: null, open: null, filter: null, hidden: false, running: null, alertIx: 0 };

// ── Static bits ──
$('ciscoMark').innerHTML = CISCO_MARK + '<span class="cisco-word">CISCO</span>';
$('levelBtn').innerHTML = ICON.chevron;
$('icSearch').innerHTML = ICON.search; $('icSearch2').innerHTML = ICON.search; $('icReset').innerHTML = ICON.reset;
$('searchClose').innerHTML = ICON.close;
$('siteName').textContent = FLOOR.site; $('levelName').textContent = FLOOR.level; $('city').textContent = FLOOR.city.name;
$('poiGrid').innerHTML = FLOOR.pois.map((p, i) => `<button data-i="${i}"><i>${ICON[p.kind] || ICON.pin}</i><small>${esc(p.name)}</small></button>`).join('');
$('qr').innerHTML = fakeQr('tesv-' + FLOOR.site + FLOOR.level);

// ── Data source ──
async function makeSource() {
  if (qs.get('data') === 'te') {
    const name = (qs.get('site') || 'lab').replace(/[^\w-]/g, '');
    const site = await fetch(`sites/${name}.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('No site file sites/' + name + '.json'))));
    return new TESource(FLOOR, site);
  }
  return new MockSource(FLOOR, { scenario: qs.get('scenario') || 'incident' });
}

// ── Map ──
const map = new FloorMap($('map'), FLOOR, { onSelect: (id) => openDetail(id) });

// ── Render: KPIs ──
function gauge(frac, color) {
  const f = Math.max(0, Math.min(1, frac)), a = Math.PI * (1 - f), x = 24 + 15 * Math.cos(a), y = 24 - 15 * Math.sin(a);
  return `<svg class="gauge" viewBox="0 0 48 28"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#6cc04a"/><stop offset=".55" stop-color="#f5a524"/><stop offset="1" stop-color="#e5484d"/></linearGradient></defs>`
    + `<path d="M5 24a19 19 0 0 1 38 0" fill="none" stroke="url(#gg)" stroke-width="4.5" stroke-linecap="round" opacity=".95"/>`
    + `<path d="M24 24L${x.toFixed(1)} ${y.toFixed(1)}" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/><circle cx="24" cy="24" r="3" fill="#fff"/></svg>`;
}
const grade = (v, [a, b]) => (v == null ? ['na', 'No data'] : v >= b ? ['bad', 'Poor'] : v >= a ? ['warn', 'Fair'] : ['ok', 'Good']);
function renderKpis(k, alerts) {
  const rows = [
    { label: 'Agents Online', frac: 1 - k.online / Math.max(1, k.total), val: `${k.online}<em>of ${k.total}</em>`, g: k.online === k.total ? ['ok'] : k.online / k.total > 0.8 ? ['warn'] : ['bad'] },
    { label: 'Avg. Latency', frac: (k.latency || 0) / 300, val: k.latency == null ? '—' : `${Math.round(k.latency)} ms`, g: grade(k.latency, LIMITS.latency) },
    { label: 'Packet Loss', frac: (k.loss || 0) / 6, val: k.loss == null ? '—' : `${k.loss.toFixed(2)} %`, g: grade(k.loss, LIMITS.loss) },
    { label: 'Jitter', frac: (k.jitter || 0) / 70, val: k.jitter == null ? '—' : `${k.jitter.toFixed(1)} ms`, g: grade(k.jitter, LIMITS.jitter) },
    { label: 'Active Alerts', frac: Math.min(1, alerts.length / 10), val: alerts.length ? `${alerts.length} open` : 'None', g: alerts.some((a) => a.sev === 'critical' || a.sev === 'offline') ? ['bad'] : alerts.length ? ['warn'] : ['ok'] },
  ];
  const col = { ok: '#6cc04a', warn: '#f5a524', bad: '#e5484d', na: '#8b93a1' };
  $('kpis').innerHTML = rows.map((r) => `<div class="card kpi"><small>${r.label}</small>${gauge(r.frac, '#fff')}<b class="${r.g[0]}">${r.val}</b></div>`).join('');
  void col;
}

// ── Render: left column ──
function renderTiles(k, snap) {
  $('agentTotal').textContent = k.total;
  const tile = (cls, n, label, key) => `<button class="tile ${cls}${S.filter && S.filter !== key ? ' off' : ''}" data-f="${key}"><b>${n}</b><small>${label}</small></button>`;
  $('agentTiles').innerHTML = tile('healthy', k.healthy, 'Healthy', 'healthy') + tile('degraded', k.degraded, 'Degraded', 'degraded')
    + tile('critical', k.critical, 'Critical', 'critical') + tile('offline', k.offline, 'Offline', 'offline');
  const tests = snap.agents.flatMap((a) => a.tests);
  const n = (s) => tests.filter((t) => t.status === s).length;
  $('testTotal').textContent = tests.length;
  $('testTiles').className = 'tiles three';
  $('testTiles').innerHTML = `<div class="tile healthy"><b>${n('healthy')}</b><small>Passing</small></div><div class="tile degraded"><b>${n('degraded')}</b><small>Warning</small></div><div class="tile critical"><b>${n('critical')}</b><small>Failing</small></div>`;
  $('hideBtn').innerHTML = (S.hidden ? ICON.eye + 'View' : ICON.eyeOff + 'Hide');
}

function applyMap() {
  const byPlace = {};
  if (!S.hidden) for (const a of S.snap.agents) byPlace[a.place] = a.status === 'nodata' ? 'offline' : a.status;
  map.setStatus(byPlace);
  map.setFilter(S.filter ? (id, st) => st === S.filter : null);
}

// ── Alerts pill ──
function renderAlert() {
  const al = S.snap.alerts, pill = $('alertPill');
  if (!al.length) { pill.hidden = true; return; }
  const a = al[S.alertIx % al.length];
  pill.hidden = false;
  pill.className = 'alert-pill' + (al.some((x) => x.sev === 'critical' || x.sev === 'offline') ? '' : ' warn');
  pill.innerHTML = `${ICON.bell}<span class="n">${al.length}</span><span class="msg">${esc(a.text)}</span>`;
  pill.onclick = () => { const ag = S.snap.agents.find((x) => x.id === a.agent); if (ag) { map.select(ag.place); openDetail(ag.place); } };
}
setInterval(() => { if (S.snap) { S.alertIx++; renderAlert(); } }, 5000);

// ── Agent card ──
function placeOf(id) { return FLOOR.rooms.find((r) => r.id === id) || FLOOR.closets.find((c) => c.id === id); }
function agentAt(place) { return S.snap && S.snap.agents.find((a) => a.place === place); }
const cls = (st) => ({ healthy: 'ok', degraded: 'warn', critical: 'bad' }[st] || 'na');
const fmt = (v, u, d = 0) => (v == null ? '—' : `${v.toFixed(d)} ${u}`);

function spark(series, color) {
  const vals = series.filter((v) => v != null);
  if (!vals.length) return '<svg class="spark" viewBox="0 0 240 64"><text x="120" y="36" fill="#6b7383" font-size="11" text-anchor="middle">No results in this window</text></svg>';
  const max = Math.max(LIMITS.latency[0] * 1.3, ...vals) * 1.08, W = 240, H = 64;
  const pts = series.map((v, i) => [i / (series.length - 1) * W, H - (v ?? 0) / max * H]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const y1 = H - LIMITS.latency[0] / max * H, y2 = H - LIMITS.latency[1] / max * H;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="sf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    + `<line x1="0" x2="${W}" y1="${y1}" y2="${y1}" stroke="#f5a524" stroke-dasharray="3 4" stroke-width="1" opacity=".55"/>`
    + (y2 > 0 ? `<line x1="0" x2="${W}" y1="${y2}" y2="${y2}" stroke="#e5484d" stroke-dasharray="3 4" stroke-width="1" opacity=".55"/>` : '')
    + `<path d="${line}L${W} ${H}L0 ${H}Z" fill="url(#sf)"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function marker(v, max) { return v == null ? '' : `<div class="bar"><i style="left:${Math.min(100, v / max * 100).toFixed(1)}%"></i></div>`; }

function openDetail(placeId) {
  S.open = placeId;
  const el = $('detail');
  map.setInset(placeId ? -14 : 3.5, 1.2);
  if (!placeId) { el.hidden = true; return; }
  const pl = placeOf(placeId); if (!pl) { el.hidden = true; return; }
  const a = agentAt(placeId);
  el.hidden = false;
  if (!a) {
    el.innerHTML = `<button class="d-close" aria-label="Close">${ICON.close}</button><h2 class="d-title">${esc(pl.name)}</h2>
      <div class="d-sub"><i>${ICON.roomDevice}</i>${pl.device ? esc(pl.device) + ' in this room' : 'No collaboration device in this room'}</div>
      <div class="d-grid"><div class="d-state nodata"><small>ThousandEyes agent</small><b>Not installed</b></div>
      <div class="d-box"><h4>Room Capacity</h4><div class="d-count"><b>${pl.seats || '—'}</b> <span>seats</span></div></div></div>
      <div class="d-sec"><p style="color:var(--muted);font-size:.85rem;line-height:1.5;margin:0">${pl.device ? `This ${esc(pl.device)} can run the ThousandEyes Endpoint Agent. Turn it on in Control Hub (Devices &gt; ThousandEyes) to see this room's network health here.` : 'Add a RoomOS device with the ThousandEyes agent to monitor this room.'}</p></div>
      <div class="d-src">Data source: ${esc(S.snap.source)}</div>`;
    el.querySelector('.d-close').onclick = closeDetail;
    return;
  }
  const st = a.status, main = a.tests.find((t) => t.id === 'webex') || a.tests[0];
  const passing = a.tests.filter((t) => t.status === 'healthy').length;
  const kind = a.kind === 'enterprise' ? 'Enterprise Agent' : 'Endpoint Agent';
  const color = STATUS[st === 'nodata' ? 'offline' : st].color;
  const now = new Date();
  const hhmm = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const lastSeen = a.lastSeen ? Math.max(0, Math.round((Date.now() - a.lastSeen) / 60000)) : null;
  const running = S.running && S.running.id === a.id;
  el.innerHTML = `<button class="d-close" aria-label="Close">${ICON.close}</button>
    <h2 class="d-title">${esc(pl.name)}</h2>
    <div class="d-sub"><i>${ICON.te}</i>ThousandEyes ${kind} on ${esc(a.model)}</div>
    <div class="d-grid">
      <div class="d-state ${st}"><small>${st === 'offline' ? 'This agent has been' : 'Network health from this agent'}</small><b>${STATUS[st].label}</b></div>
      <div class="d-box"><h4>Service Tests Passing</h4><div class="d-count"><b>${st === 'offline' ? 0 : passing}</b> <span>of</span> <em>${a.tests.length}</em></div></div>
      <div class="d-timeline">
        <div class="now">${hhmm(now)}</div>
        <h5>${esc(main.name)} latency, last 2 hours:</h5>
        ${spark(main.series.latency, color)}
        <div class="spark-axis"><span>${hhmm(new Date(now - 2 * 3600e3))}</span><span>${hhmm(new Date(now - 3600e3))}</span><span>Now</span></div>
      </div>
      <div class="d-box d-metrics">
        <div><span>Latency (${esc(main.name.split(' ')[0])}):</span><b class="${cls(statusOfOne(main.latency, LIMITS.latency))}">${fmt(main.latency, 'ms')}</b></div>${marker(main.latency, 320)}
        <div><span>Packet Loss:</span><b class="${cls(statusOfOne(main.loss, LIMITS.loss))}">${fmt(main.loss, '%', 1)}</b></div>${marker(main.loss, 7)}
        <div><span>Jitter:</span><b class="${cls(statusOfOne(main.jitter, LIMITS.jitter))}">${fmt(main.jitter, 'ms', 1)}</b></div>
        <div><span>Last Seen:</span><b class="${st === 'offline' ? 'bad' : 'ok'}">${lastSeen == null ? '—' : lastSeen < 1 ? 'Just now' : lastSeen + ' min ago'}</b></div>
      </div>
    </div>
    <div class="d-sec"><h4>Tests from this agent <small>Agent to Server · every 1 min</small></h4>
      <table class="tests"><tr><th>Service</th><th>Latency</th><th>Loss</th><th>Jitter</th></tr>
      ${a.tests.map((t) => `<tr><td><span class="dot" style="background:${STATUS[t.status === 'nodata' ? 'offline' : t.status].color}"></span>${esc(t.name)}<small>${esc(t.target)}</small></td>
        <td class="${cls(statusOfOne(t.latency, LIMITS.latency))}">${fmt(t.latency, 'ms')}</td><td class="${cls(statusOfOne(t.loss, LIMITS.loss))}">${fmt(t.loss, '%', 1)}</td><td class="${cls(statusOfOne(t.jitter, LIMITS.jitter))}">${fmt(t.jitter, 'ms', 1)}</td></tr>`).join('')}
      </table></div>
    ${a.path && a.path.length ? `<div class="d-sec"><h4>Path to ${esc(main.name)} <small>Path Visualization</small></h4><div class="path">${a.path.map((h) => `<div class="hop${h.hot ? ' hot' : ''}"><b>${esc(h.name)}</b><small>${esc(h.owner)}</small><em>${h.ms} ms</em></div>`).join('')}</div></div>` : ''}
    <div class="d-sec d-meta"><div>Agent<b>${esc(a.name)}</b></div><div>IP address<b>${esc(a.ip || '—')}</b></div><div>Version<b>${esc(a.version || '—')}</b></div></div>
    <div class="d-src">Data source: ${esc(S.snap.source)} · updated ${hhmm(new Date(S.snap.t))}</div>
    <div class="d-cta"><div><b>Want to check it now?</b><small>Run a ThousandEyes instant test from this agent.</small><div class="run-step" id="runStep">${running ? esc(S.running.step) : ''}</div></div>
      <button class="run" id="runBtn" ${running || st === 'offline' ? 'disabled' : ''}><span class="ring"><i class="pct" style="--p:${running ? S.running.p : 0}"></i>${ICON.play}</span>${running ? 'Testing…' : 'Run Test'}</button></div>`;
  el.querySelector('.d-close').onclick = closeDetail;
  const btn = el.querySelector('#runBtn');
  if (st === 'offline') btn.title = 'The agent is offline';
  btn.onclick = () => runTest(a);
}
function statusOfOne(v, [a, b]) { return v == null ? 'nodata' : v >= b ? 'critical' : v >= a ? 'degraded' : 'healthy'; }
function closeDetail() { S.open = null; $('detail').hidden = true; map.setInset(3.5, 1.2); map.select(null); }

async function runTest(a) {
  if (S.running) return;
  S.running = { id: a.id, p: 0, step: 'Starting…' };
  openDetail(S.open);
  try {
    const fresh = await source.instantTest(a.id, (p, step) => {
      S.running.p = Math.round(p * 100); S.running.step = step;
      const r = document.querySelector('#runBtn .pct'); if (r) r.style.setProperty('--p', S.running.p);
      const s = $('runStep'); if (s) s.textContent = step;
    });
    const i = S.snap.agents.findIndex((x) => x.id === a.id);
    if (i >= 0) S.snap.agents[i] = fresh;
    const t = fresh.tests[0];
    toast(`Instant test from ${fresh.placeName}: ${t.name} ${fmt(t.latency, 'ms')}, ${fmt(t.loss, '% loss', 1)}`);
  } catch (e) { toast(String(e.message || e)); }
  S.running = null;
  if (S.open) openDetail(S.open);
}

// ── Search ──
function renderSearch(q) {
  q = q.trim().toLowerCase();
  const m = (s) => !q || String(s).toLowerCase().includes(q);
  const rooms = [...FLOOR.rooms, ...FLOOR.closets].filter((p) => { const a = agentAt(p.id); return m(p.name) || m(p.device || '') || (a && (m(a.name) || a.tests.some((t) => m(t.name)))); });
  const pois = FLOOR.pois.filter((p) => m(p.name));
  let html = '';
  if (rooms.length) {
    html += '<h6>Rooms and agents</h6>' + rooms.map((p) => {
      const a = agentAt(p.id), st = a ? a.status : 'none';
      return `<button class="hit" data-place="${p.id}"><i>${FLOOR.closets.includes(p) ? ICON.switch : ICON.roomDevice}</i><span><b>${esc(p.name)}</b><small>${a ? esc(a.name) + ' · ' + esc(a.model) : esc(p.device || 'No device') + ' · no agent'}</small></span><em style="color:${STATUS[st === 'nodata' ? 'offline' : st].color}">${STATUS[st].label}</em></button>`;
    }).join('');
  }
  if (pois.length) html += '<h6>On this floor</h6>' + pois.map((p) => `<button class="hit" data-poi="${FLOOR.pois.indexOf(p)}"><i>${ICON[p.kind] || ICON.pin}</i><span><b>${esc(p.name)}</b><small>${esc(FLOOR.level)}</small></span></button>`).join('');
  $('searchList').innerHTML = html || '<p style="color:var(--muted);padding:1rem;margin:0">No matches on this floor.</p>';
}
function openSearch() { $('searchPop').hidden = false; $('searchInput').value = ''; renderSearch(''); setTimeout(() => $('searchInput').focus(), 30); }
function closeSearch() { $('searchPop').hidden = true; }
$('searchBtn').onclick = (e) => { e.stopPropagation(); if ($('searchPop').hidden) openSearch(); else closeSearch(); };
$('searchClose').onclick = closeSearch;
$('searchInput').oninput = (e) => renderSearch(e.target.value);
$('searchList').onclick = (e) => {
  const h = e.target.closest('.hit'); if (!h) return;
  closeSearch();
  if (h.dataset.place) { map.select(h.dataset.place); openDetail(h.dataset.place); } else goPoi(+h.dataset.poi);
};

function goPoi(i) {
  const p = FLOOR.pois[i];
  map.flyTo({ tx: p.x, tz: p.z, dist: 55 });
  toast(`${p.name} · ${FLOOR.level}`);
}

// ── Buttons ──
$('whereBtn').onclick = () => { closeDetail(); map.whereAmI(); };
$('resetBtn').onclick = () => { closeDetail(); closeSearch(); S.filter = null; map.reset(); render(); };
$('poiGrid').onclick = (e) => { const b = e.target.closest('button'); if (b) goPoi(+b.dataset.i); };
$('agentTiles').onclick = (e) => { const t = e.target.closest('.tile'); if (!t) return; S.filter = S.filter === t.dataset.f ? null : t.dataset.f; render(); };
$('hideBtn').onclick = () => { S.hidden = !S.hidden; render(); };
$('levelBtn').onclick = (e) => {
  e.stopPropagation();
  const m = $('levelMenu'), open = m.hidden;
  m.hidden = !open; $('levelBtn').setAttribute('aria-expanded', String(open));
  m.innerHTML = FLOOR.levels.map((l) => `<button class="${l === FLOOR.level ? 'on' : ''}" data-l="${l}">${l}<small>${l === FLOOR.level ? (S.snap ? S.snap.kpis.total + ' agents' : '') : 'No agents yet'}</small></button>`).join('');
};
$('levelMenu').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $('levelMenu').hidden = true; $('levelBtn').setAttribute('aria-expanded', 'false'); if (b.dataset.l !== FLOOR.level) toast(`${b.dataset.l}: no ThousandEyes agents mapped yet`); };
document.addEventListener('pointerdown', (e) => {
  if (!$('levelMenu').hidden && !e.target.closest('.brand')) { $('levelMenu').hidden = true; $('levelBtn').setAttribute('aria-expanded', 'false'); }
  if (!$('searchPop').hidden && !e.target.closest('.search-pop') && !e.target.closest('#searchBtn')) closeSearch();
});
$('helpBtn').onclick = () => sheet(`<h2>How do I use this?</h2><p>This map shows the network health seen by the ThousandEyes agents on this floor: the Endpoint Agents built into the Webex devices in each meeting room, and the Enterprise Agents on the Catalyst switches and Meraki SD-WAN in the network closets.</p>
  <div class="tips"><div class="tip"><b>Tap a room</b>See its agent's tests, the last two hours and the network path.</div><div class="tip"><b>Colours</b>Green is healthy, orange degraded, red critical, grey offline or no agent.</div>
  <div class="tip"><b>Move the map</b>Drag to pan, pinch to zoom, twist with two fingers to rotate.</div><div class="tip"><b>Filter</b>Tap Healthy, Degraded, Critical or Offline on the left to show only those rooms.</div></div>
  <div class="row"><button class="primary" data-close>Got it</button></div>`);
$('srcBtn').onclick = () => {
  const live = qs.get('data') === 'te';
  sheet(`<h2>Data source</h2><p>Now showing: <b style="color:var(--text)">${esc(S.snap ? S.snap.source : '')}</b>${live ? '' : ` (scenario: ${esc(qs.get('scenario') || 'incident')})`}.</p>
    <label>Source</label><select id="srcSel"><option value="mock-incident">Mock data: incident</option><option value="mock-calm">Mock data: all healthy</option><option value="mock-outage">Mock data: major outage</option><option value="te">ThousandEyes (site file: sites/lab.json)</option></select>
    <label>ThousandEyes API token (kept on this device only)</label><input id="tokIn" type="password" placeholder="${teToken.get() ? 'Saved. Leave empty to keep it' : 'Bearer token'}" autocomplete="off">
    <div class="row"><button data-close>Cancel</button><button class="primary" id="srcApply">Apply</button></div>`);
  $('srcSel').value = live ? 'te' : 'mock-' + (qs.get('scenario') || 'incident');
  $('srcApply').onclick = () => {
    const v = $('srcSel').value, tok = $('tokIn').value.trim();
    if (tok) teToken.set(tok);
    const u = new URL(location.href);
    u.searchParams.delete('scenario'); u.searchParams.delete('data');
    if (v === 'te') { u.searchParams.set('data', 'te'); if (!u.searchParams.get('site')) u.searchParams.set('site', 'lab'); }
    else { u.searchParams.delete('site'); const sc = v.split('-')[1]; if (sc !== 'incident') u.searchParams.set('scenario', sc); }
    location.href = u.toString();
  };
};

function sheet(html) {
  const s = $('sheet');
  s.innerHTML = `<div class="panel">${html}</div>`; s.hidden = false;
  s.onclick = (e) => { if (e.target === s || e.target.closest('[data-close]')) s.hidden = true; };
}
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500); }

// ── Clock and weather ──
function tick() {
  const d = new Date();
  $('date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  $('time').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase();
}
tick(); setInterval(tick, 10e3);
const WX = (c) => c === 0 ? ['Clear', 'sun'] : c <= 2 ? ['Partly cloudy', 'part'] : c === 3 ? ['Overcast', 'cloud'] : c <= 48 ? ['Fog', 'cloud'] : c <= 67 || (c >= 80 && c <= 82) ? ['Rain', 'rain'] : c <= 77 || c === 85 || c === 86 ? ['Snow', 'snow'] : ['Thunderstorms', 'rain'];
function wxIcon(kind) {
  const sun = '<circle cx="18" cy="16" r="7" fill="#fbbf24"/>';
  const cloud = '<path d="M14 36h20a7 7 0 0 0 .6-14 10 10 0 0 0-19.3 2.6A5.8 5.8 0 0 0 14 36z" fill="#e8edf5"/>';
  const drops = '<path d="M18 40l-2 4M25 40l-2 4M32 40l-2 4" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"/>';
  const snow = '<circle cx="18" cy="42" r="1.4" fill="#fff"/><circle cx="25" cy="44" r="1.4" fill="#fff"/><circle cx="32" cy="42" r="1.4" fill="#fff"/>';
  const body = { sun: '<circle cx="24" cy="24" r="9" fill="#fbbf24"/>', part: sun + cloud, cloud, rain: cloud + drops, snow: cloud + snow }[kind];
  return `<svg viewBox="0 0 48 48">${body}</svg>`;
}
async function weather() {
  try {
    const { lat, lon } = FLOOR.city;
    const j = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`).then((r) => r.json());
    const [text, kind] = WX(j.current.weather_code);
    $('wxTemp').textContent = Math.round(j.current.temperature_2m) + '°F'; $('wxText').textContent = text; $('wxIcon').innerHTML = wxIcon(kind);
  } catch (_) { $('wxIcon').innerHTML = wxIcon('part'); $('wxText').textContent = 'Partly cloudy'; }
}
weather(); setInterval(weather, 15 * 60e3);

// ── A QR-like pattern (the mock-up's "Navigate on phone" card) ──
function fakeQr(seed) {
  const N = 25; let h = 2166136261; const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const finder = (x, y) => [[0, 0], [N - 7, 0], [0, N - 7]].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  let r = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!finder(x, y) && !(x === 7 || y === 7 || x === N - 8 || y === N - 8) && rnd() > 0.52) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  for (const [fx, fy] of [[0, 0], [N - 7, 0], [0, N - 7]]) r += `<rect x="${fx + 0.5}" y="${fy + 0.5}" width="6" height="6" fill="none" stroke="#000" stroke-width="1"/><rect x="${fx + 2}" y="${fy + 2}" width="3" height="3"/>`;
  return `<svg viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" fill="#000">${r}</svg>`;
}

// ── Refresh ──
function render() {
  if (!S.snap) return;
  renderKpis(S.snap.kpis, S.snap.alerts);
  renderTiles(S.snap.kpis, S.snap);
  applyMap();
  renderAlert();
  if (S.open && !S.running) openDetail(S.open);
  $('srcBtn').textContent = S.snap.source === 'ThousandEyes' ? '● Live: ThousandEyes' : 'Mock data';
  $('srcBtn').dataset.live = S.snap.source === 'ThousandEyes' ? '1' : '0';
}

let source;
async function refresh() {
  try { S.snap = await source.snapshot(); render(); }
  catch (e) { toast('Data: ' + (e.message || e)); }
}
(async () => {
  try { source = await makeSource(); }
  catch (e) { toast(String(e.message || e) + ' · showing mock data'); source = new MockSource(FLOOR); }
  await refresh();
  setInterval(refresh, source instanceof TESource ? 60e3 : 10e3);
})();
