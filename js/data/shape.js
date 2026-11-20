// Shared rules for both data sources: health thresholds, floor KPIs, alerts.

// A test's health from its latest numbers (ms, %, ms).
export const LIMITS = { latency: [120, 250], loss: [1, 5], jitter: [30, 60] };
export function statusOf({ latency, loss, jitter }) {
  if (latency == null && loss == null) return 'nodata';
  if (loss >= LIMITS.loss[1] || latency >= LIMITS.latency[1] || jitter >= LIMITS.jitter[1]) return 'critical';
  if (loss >= LIMITS.loss[0] || latency >= LIMITS.latency[0] || jitter >= LIMITS.jitter[0]) return 'degraded';
  return 'healthy';
}
const RANK = { healthy: 0, nodata: 1, degraded: 2, critical: 3, offline: 4 };
export function worst(list) { return list.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), 'healthy'); }

export function kpisOf(agents) {
  const online = agents.filter((a) => a.status !== 'offline');
  const vals = (k) => online.flatMap((a) => a.tests.map((t) => t[k])).filter((v) => v != null);
  const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const count = (s) => agents.filter((a) => a.status === s).length;
  return {
    total: agents.length,
    online: online.length,
    healthy: count('healthy'), degraded: count('degraded'), critical: count('critical'), offline: count('offline'),
    endpoint: agents.filter((a) => a.kind === 'endpoint').length,
    enterprise: agents.filter((a) => a.kind === 'enterprise').length,
    latency: avg(vals('latency')), loss: avg(vals('loss')), jitter: avg(vals('jitter')),
  };
}

export function alertsOf(agents) {
  // One alert per agent: its worst test, plus how many others are also unhealthy.
  const out = [];
  for (const a of agents) {
    if (a.status === 'offline') { out.push({ sev: 'offline', agent: a.id, text: `${a.placeName}: ThousandEyes agent offline` }); continue; }
    const bad = a.tests.filter((t) => t.status === 'critical' || t.status === 'degraded')
      .sort((x, y) => (y.status === 'critical') - (x.status === 'critical') || (y.latency || 0) - (x.latency || 0));
    if (!bad.length) continue;
    const t = bad[0], why = t.loss >= LIMITS.loss[0] ? `${t.loss.toFixed(1)}% loss` : `${Math.round(t.latency)} ms latency`;
    out.push({ sev: t.status, agent: a.id, text: `${a.placeName} → ${t.name}: ${why}${bad.length > 1 ? ` (+${bad.length - 1} more)` : ''}` });
  }
  const order = { offline: 0, critical: 1, degraded: 2 };
  return out.sort((x, y) => order[x.sev] - order[y.sev]);
}

// Labels and colours the UI uses for each health state (Spaces' palette).
export const STATUS = {
  healthy:  { label: 'Healthy',  color: '#6cc04a' },
  degraded: { label: 'Degraded', color: '#f5a524' },
  critical: { label: 'Critical', color: '#e5484d' },
  offline:  { label: 'Offline',  color: '#8b93a1' },
  nodata:   { label: 'No Data',  color: '#8b93a1' },
  none:     { label: 'No Agent', color: '#c3c9d3' },
};
