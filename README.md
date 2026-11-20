# ThousandEyes agents · Smart Workspaces view

A Cisco Spaces–style signage view (3D floor map, KPI header, room cards) that
shows the health of the ThousandEyes agents on a floor instead of room bookings:

- **Meeting rooms**: the ThousandEyes Endpoint Agent built into each RoomOS device
  (Board Pro, Room Bar, Desk Pro, …).
- **Network closets**: ThousandEyes Enterprise Agents on Catalyst 9300 switches and
  the Meraki MX.

Rooms are tinted by agent health (green healthy, orange degraded, red critical,
grey offline or no agent). Tap a room for its tests, the last two hours, the
network path, and an instant test.

Designed for a Board Pro (16:9, 4K); the layout is 1920 × 1080 design pixels and
scales to any 16:9 screen.

## Data

| URL | Data |
|---|---|
| `?` (default) | Mock data, with an incident: the east wing's ISP congests and Webex suffers |
| `?scenario=calm` / `?scenario=outage` | Mock data, all healthy / a worse outage |
| `?data=te&site=lab` | Real ThousandEyes data (API v7), using `sites/lab.json` |

Both sources produce the same snapshot shape (`js/data/mock.js` documents it), so
the interface doesn't change between them.

### Real data from a lab

1. Deploy the read-only proxy (the ThousandEyes API has no CORS):
   `cd worker && npx wrangler deploy`
2. Copy `sites/lab.example.json` to `sites/lab.json`. Fill in the proxy URL, the test IDs,
   and which tenant agent sits in which room or closet (`agents`: floor slot → agent name).
   The slots are the `agent` ids in `js/floor.js`.
3. Open the app and tap the **Mock data** button (bottom right). Choose ThousandEyes and
   enter an API token. The token is kept in that device's browser storage only; it's never
   in the page or the repo.

## Files

- `js/floor.js`: the floor plan (rooms, closets, desks, points of interest) and which agent is where
- `js/map3d.js`: the three.js floor map and pins
- `js/data/mock.js`, `js/data/te.js`, `js/data/shape.js`: data sources and the health rules
- `js/app.js`: header, panels, agent card, search
- `worker/te-proxy.js`: Cloudflare Worker proxy

Local: `python3 -m http.server 8780` and open http://localhost:8780.
