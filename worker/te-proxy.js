// Cloudflare Worker: a read-only CORS proxy to the ThousandEyes API v7, so the
// Spaces-style view can read a tenant from the browser. The browser sends its
// own token (Authorization: Bearer ...); this Worker stores nothing.
//
//   GET https://<worker>/v7/agents?aid=...   ->  https://api.thousandeyes.com/v7/agents?aid=...
//
// Only GET, only /v7/, only from the allowed origins below.
const API = 'https://api.thousandeyes.com';
const ORIGINS = [/^https:\/\/lucidium2000\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const ok = ORIGINS.some((re) => re.test(origin));
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin : 'null',
      'Access-Control-Allow-Headers': 'Authorization, Accept',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors });
    const url = new URL(req.url);
    if (!ok || req.method !== 'GET' || !url.pathname.startsWith('/v7/')) return new Response('Not allowed', { status: 403, headers: cors });
    const auth = req.headers.get('Authorization') || '';
    if (!/^Bearer [\w.-]+$/.test(auth)) return new Response('Missing token', { status: 401, headers: cors });
    const r = await fetch(API + url.pathname + url.search, { headers: { Authorization: auth, Accept: req.headers.get('Accept') || 'application/json' } });
    const h = new Headers(cors);
    h.set('Content-Type', r.headers.get('Content-Type') || 'application/json');
    h.set('Cache-Control', 'no-store');
    return new Response(r.body, { status: r.status, headers: h });
  },
};
