// Mock ThousandEyes data for the floor: believable, slowly drifting numbers,
// with an optional incident (the east wing's ISP congests, so Webex from those
// rooms gets slow and lossy). Same shape as the real source (js/data/te.js):
//
//   snapshot = { t, agents: [Agent], kpis, alerts }
//   Agent = { id, name, kind: 'endpoint'|'enterprise', model, place, version, ip,
//             uptimeH, status, lastSeen, tests: [Test], path: [Hop] }
//   Test  = { id, name, target, latency, loss, jitter, status, series: { latency: [], loss: [] } }
//   Hop   = { name, ip, ms, owner }
//
// URL: ?scenario=calm (all healthy) | incident (default) | outage (worse).
import { statusOf, worst, kpisOf, alertsOf } from './shape.js';

const TESTS = {
  endpoint: [
    { id: 'webex', name: 'Webex Meetings', target: 'meet.webex.com', base: 28 },
    { id: 'm365', name: 'Microsoft 365', target: 'outlook.office365.com', base: 22 },
    { id: 'sfdc', name: 'Salesforce', target: 'login.salesforce.com', base: 34 },
  ],
  enterprise: [
    { id: 'webex', name: 'Webex Meetings', target: 'meet.webex.com', base: 24 },
    { id: 'm365', name: 'Microsoft 365', target: 'outlook.office365.com', base: 19 },
    { id: 'dc1', name: 'Data Center (DC1)', target: '10.20.0.10', base: 9 },
    { id: 'dns', name: 'DNS (Umbrella)', target: '208.67.222.222', base: 7 },
  ],
};

// Which closet (and so which ISP) each part of the floor goes through.
const EAST = new Set(['paris', 'oslo', 'beijing', 'toronto', 'tokyo', 'mexico', 'sf', 'idf2']);

// Small deterministic noise (no Math.random, so every screen agrees).
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function noise(key, t) {
  const a = hash(key) / 4294967296 * Math.PI * 2;
  return 0.5 * Math.sin(t / 97 + a) + 0.3 * Math.sin(t / 31 + a * 3) + 0.2 * Math.sin(t / 7.3 + a * 7);
}

export class MockSource {
  constructor(floor, opts = {}) {
    this.floor = floor;
    this.scenario = opts.scenario || 'incident';
    this.label = 'Mock data';
    this.agents = [];
    for (const r of floor.rooms) if (r.agent) this.agents.push({ id: r.agent, kind: 'endpoint', place: r.id, placeName: r.name, model: r.device });
    for (const c of floor.closets) this.agents.push({ id: c.agent, kind: 'enterprise', place: c.id, placeName: c.name, model: c.device });
    this.boost = new Map();   // agent id -> time an instant test ran (fresh numbers for a minute)
  }

  /** How bad the incident is for this agent and test right now (0 = fine). */
  impact(a, test, t) {
    if (this.scenario === 'calm') return 0;
    const east = EAST.has(a.place);
    if (!east || test.id === 'dc1' || test.id === 'dns') return 0;
    // Slowly breathes, so the floor visibly changes over a few minutes.
    const wave = 0.75 + 0.25 * Math.sin(t / 240);
    let k = test.id === 'webex' ? 1 : 0.35;
    if (a.place === 'tokyo' || a.place === 'idf2') k *= 1.6;
    if (this.scenario === 'outage') k *= 1.8;
    return k * wave;
  }

  sample(a, test, t) {
    const n = noise(a.id + test.id, t), imp = this.impact(a, test, t);
    const latency = Math.max(2, test.base * (1 + 0.12 * n) + imp * 190 + (a.kind === 'endpoint' ? 3 : 0));
    const loss = Math.max(0, (imp > 0 ? imp * 3.4 : 0) + Math.max(0, n - 0.6) * 0.4);
    const jitter = Math.max(0.3, 2 + 1.2 * n + imp * 26);
    return { latency, loss, jitter };
  }

  agentAt(a, now) {
    const t = now / 1000;
    const offline = this.scenario !== 'calm' && a.place === 'oslo';
    const name = a.kind === 'enterprise'
      ? `${a.model.startsWith('Meraki') ? 'MX250' : 'C9300'}-B10-${a.placeName.replace(/\s+/g, '')}`
      : `B10-L1-${a.placeName.replace(/\s+/g, '')}`;
    const tests = TESTS[a.kind].map((test) => {
      const cur = this.sample(a, test, t);
      const series = { latency: [], loss: [] };
      for (let i = 23; i >= 0; i--) {   // the last 2 hours, every 5 minutes
        const s = this.sample(a, test, t - i * 300);
        series.latency.push(+s.latency.toFixed(1)); series.loss.push(+s.loss.toFixed(2));
      }
      const v = offline ? { latency: null, loss: null, jitter: null } : { latency: +cur.latency.toFixed(1), loss: +cur.loss.toFixed(2), jitter: +cur.jitter.toFixed(1) };
      return { id: test.id, name: test.name, target: test.target, ...v, status: offline ? 'offline' : statusOf(v), series };
    });
    const east = EAST.has(a.place);
    const webex = tests.find((x) => x.id === 'webex') || tests[0];
    const isp = east ? { name: 'Comcast Business', ip: '68.86.103.1', asn: 'AS7922' } : { name: 'AT&T', ip: '12.122.144.1', asn: 'AS7018' };
    const lat = webex.latency || 0, imp = this.impact(a, TESTS[a.kind][0], t);
    const path = [
      { name: a.kind === 'enterprise' ? name : `${a.model} (agent)`, ip: a.kind === 'enterprise' ? '10.10.1.2' : `10.10.${east ? 22 : 21}.${10 + (hash(a.id) % 200)}`, ms: 0, owner: 'This site' },
      ...(a.kind === 'endpoint' ? [{ name: east ? 'C9300-B10-IDF1-E' : 'C9300-B10-IDF1-W', ip: east ? '10.10.22.1' : '10.10.21.1', ms: 0.6, owner: 'This site' }] : []),
      { name: 'MX250-B10-MDF', ip: '10.10.0.1', ms: 1.4, owner: 'This site' },
      { name: isp.name, ip: isp.ip, ms: +(4 + lat * 0.08 + imp * 150).toFixed(1), owner: isp.asn, hot: imp > 0.3 },
      { name: 'Equinix SV5 peering', ip: '206.223.116.10', ms: +(8 + lat * 0.3).toFixed(1), owner: 'AS24115' },
      { name: 'Webex edge (SJC)', ip: '170.72.231.161', ms: +lat.toFixed(1), owner: 'AS13445 Cisco Webex' },
    ];
    return {
      id: a.id, name, kind: a.kind, model: a.model, place: a.place, placeName: a.placeName,
      version: a.kind === 'enterprise' ? '1.218.0' : '1.231.2',
      ip: path[0].ip, uptimeH: 24 * 6 + (hash(a.id) % 400),
      status: offline ? 'offline' : worst(tests.map((x) => x.status)),
      lastSeen: offline ? now - 47 * 60e3 : now - (hash(a.id) % 50) * 1000,
      tests, path: offline ? [] : path,
    };
  }

  async snapshot(now = Date.now()) {
    const agents = this.agents.map((a) => this.agentAt(a, now));
    return { t: now, source: this.label, agents, kpis: kpisOf(agents), alerts: alertsOf(agents) };
  }

  /** An instant test from one agent: resolves after a few seconds with fresh results. */
  async instantTest(agentId, onProgress) {
    const a = this.agents.find((x) => x.id === agentId);
    if (!a) throw new Error('No such agent');
    const steps = ['Scheduling on agent', 'Resolving targets', 'Probing network path', 'Measuring HTTP and page load', 'Collecting results'];
    for (let i = 0; i < steps.length; i++) {
      onProgress && onProgress(i / steps.length, steps[i]);
      await new Promise((r) => setTimeout(r, 650 + (i === 2 ? 900 : 0)));
    }
    onProgress && onProgress(1, 'Done');
    return this.agentAt(a, Date.now());
  }
}
