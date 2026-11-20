// Real ThousandEyes data (API v7) for the floor, through a Cloudflare Worker
// (worker/te-proxy.js) because the ThousandEyes API sends no CORS headers.
// Same output shape as js/data/mock.js, so the UI doesn't change.
//
// Configuration: a site file (sites/<name>.json, picked with ?site=<name>):
//   {
//     "proxy": "https://te-proxy.<you>.workers.dev",
//     "aid": "<account group id, optional>",
//     "window": "2h",
//     "tests": [ { "id": "webex", "name": "Webex Meetings", "testId": "1234567", "kind": "enterprise" },
//                { "id": "webex", "name": "Webex Meetings", "testId": "7654321", "kind": "endpoint" } ],
//     "agents": { "ea-rome": "B10-L1-Rome", "ent-c9300-idf1": "C9300-B10-IDF1-W", ... }
//   }
// "agents" maps each floor slot (js/floor.js `agent`) to the agent's name in
// the tenant (Enterprise Agent name, or the endpoint agent's computer name).
//
// The API token never goes in the page or the site file: it's entered on the
// device (Settings > Data source) and kept in that browser's storage only.
import { statusOf, worst, kpisOf, alertsOf } from './shape.js';

const TOKEN_KEY = 'tesv-te-token';
export const teToken = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } },
  set(v) { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch (_) { /* private mode */ } },
};

export class TESource {
  constructor(floor, site) {
    this.floor = floor;
    this.site = site;
    this.label = 'ThousandEyes';
    this.slots = [];
    for (const r of floor.rooms) if (r.agent) this.slots.push({ id: r.agent, kind: 'endpoint', place: r.id, placeName: r.name, model: r.device });
    for (const c of floor.closets) this.slots.push({ id: c.agent, kind: 'enterprise', place: c.id, placeName: c.name, model: c.device });
  }

  async get(path, params = {}) {
    const token = teToken.get();
    if (!token) throw new Error('No ThousandEyes token on this device');
    const q = new URLSearchParams(params);
    if (this.site.aid) q.set('aid', this.site.aid);
    const r = await fetch(`${this.site.proxy.replace(/\/$/, '')}/v7/${path}?${q}`, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/hal+json' },
    });
    if (!r.ok) throw new Error(`ThousandEyes ${path}: HTTP ${r.status}`);
    return r.json();
  }

  async snapshot(now = Date.now()) {
    const win = this.site.window || '2h';
    // Agents: Enterprise Agents and Endpoint Agents, by name.
    const [ent, ep] = await Promise.all([
      this.get('agents', { agentTypes: 'enterprise' }).catch(() => ({ agents: [] })),
      this.get('endpoint/agents').catch(() => ({ agents: [] })),
    ]);
    const byName = new Map();
    for (const a of ent.agents || []) byName.set(a.agentName, { id: a.agentId, kind: 'enterprise', name: a.agentName, online: a.agentState !== 'offline', version: a.agentVersion, ip: (a.ipAddresses || [])[0], lastSeen: a.lastSeen });
    for (const a of ep.agents || []) byName.set(a.computerName || a.name, { id: a.id, kind: 'endpoint', name: a.computerName || a.name, online: a.status !== 'disabled' && a.lastSeen && now - Date.parse(a.lastSeen) < 15 * 60e3, version: a.version, ip: (a.clients && a.clients[0] && a.clients[0].ipAddress) || '', lastSeen: a.lastSeen });

    // Network results per test (latest per agent, plus a series over the window).
    const results = new Map();   // `${kind}:${agentId}:${testRef}` -> [{t, latency, loss, jitter}]
    await Promise.all((this.site.tests || []).map(async (test) => {
      const path = test.kind === 'endpoint' ? `endpoint/test-results/scheduled-tests/${test.testId}/network` : `test-results/${test.testId}/network`;
      const j = await this.get(path, { window: win }).catch(() => null);
      for (const r of (j && j.results) || []) {
        const key = `${test.kind}:${r.agentId}:${test.id}`;
        if (!results.has(key)) results.set(key, []);
        results.get(key).push({ t: Date.parse(r.date || r.roundId * 1000 || 0), latency: r.avgLatency ?? r.latency, loss: r.loss, jitter: r.jitter });
      }
    }));

    const agents = this.slots.map((slot) => {
      const real = byName.get((this.site.agents || {})[slot.id]);
      const tests = (this.site.tests || []).filter((t) => t.kind === slot.kind).map((t) => {
        const rows = (real && results.get(`${slot.kind}:${real.id}:${t.id}`)) || [];
        rows.sort((a, b) => a.t - b.t);
        const last = rows[rows.length - 1] || {};
        const v = { latency: last.latency ?? null, loss: last.loss ?? null, jitter: last.jitter ?? null };
        return { id: t.id, name: t.name, target: t.target || '', ...v, status: statusOf(v),
          series: { latency: rows.map((r) => r.latency), loss: rows.map((r) => r.loss) } };
      });
      const status = !real ? 'nodata' : !real.online ? 'offline' : worst(tests.map((t) => t.status));
      return {
        id: slot.id, teId: real && real.id, name: real ? real.name : '(not linked)', kind: slot.kind, model: slot.model,
        place: slot.place, placeName: slot.placeName, version: real && real.version, ip: real && real.ip,
        uptimeH: null, status, lastSeen: real && Date.parse(real.lastSeen), tests, path: [],
      };
    });
    return { t: now, source: this.label, agents, kpis: kpisOf(agents), alerts: alertsOf(agents) };
  }

  /** Path for one agent and test (path-vis), loaded when its card opens. */
  async pathFor(agent, testRef = 'webex') {
    const test = (this.site.tests || []).find((t) => t.id === testRef && t.kind === agent.kind);
    if (!test || !agent.teId || agent.kind !== 'enterprise') return [];
    const j = await this.get(`test-results/${test.testId}/path-vis/agent/${agent.teId}`, { window: '15m' }).catch(() => null);
    const route = j && j.results && j.results[0] && j.results[0].pathTraces && j.results[0].pathTraces[0];
    return ((route && route.hops) || []).map((h) => ({ name: h.rdns || h.ipAddress, ip: h.ipAddress, ms: h.responseTime, owner: h.network || '' }));
  }

  /** Instant tests need write access and a test template; not wired up yet. */
  async instantTest() { throw new Error('Instant tests are not enabled for live data yet'); }
}
