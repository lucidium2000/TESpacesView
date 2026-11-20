// The floor plan: an invented office floor, in metres. x runs west -> east,
// z runs north -> south, the origin is the middle of the floor.
// Each room or closet can name the ThousandEyes agent it holds (`agent`):
// the mock data uses these ids, and for real data they're matched to agent
// names in the tenant (see js/data/te.js and sites/*.json).

export const FLOOR = {
  site: 'Building 10',
  level: 'Level 1',
  levels: ['Level 1', 'Level 2', 'Level 3'],
  city: { name: 'San Francisco, CA', lat: 37.7793, lon: -122.3893 },
  size: [104, 64],
  kiosk: { x: 2, z: 12, label: 'You are here' },

  // Meeting rooms. device: the RoomOS device in the room (its ThousandEyes
  // Endpoint Agent runs on it). Rooms without an agent have no `agent`.
  rooms: [
    // North wall
    { id: 'rome',     name: 'Rome',          x: -47, z: -27, w: 10, d: 8, seats: 8,  device: 'Room Bar',       agent: 'ea-rome' },
    { id: 'sydney',   name: 'Sydney',        x: -35, z: -27, w: 10, d: 8, seats: 8,  device: 'Room Bar Pro',   agent: 'ea-sydney' },
    { id: 'munich',   name: 'Munich',        x: -23, z: -27, w: 8,  d: 8, seats: 6,  device: 'Desk Pro',       agent: 'ea-munich' },
    { id: 'newyork',  name: 'New York',      x: -1,  z: -27, w: 12, d: 8, seats: 10, device: 'Board Pro 75',   agent: 'ea-newyork' },
    { id: 'sf',       name: 'San Francisco', x: 13,  z: -27, w: 12, d: 8, seats: 12, device: 'Room Kit EQ',    agent: 'ea-sf' },
    { id: 'paris',    name: 'Paris',         x: 27,  z: -27, w: 10, d: 8, seats: 8,  device: 'Room Bar Pro',   agent: 'ea-paris' },
    { id: 'oslo',     name: 'Oslo',          x: 39,  z: -27, w: 8,  d: 8, seats: 4,  device: 'Desk Pro',       agent: 'ea-oslo' },
    // East wall
    { id: 'beijing',  name: 'Beijing',       x: 47,  z: -15, w: 8,  d: 10, seats: 6, device: 'Room Bar',       agent: 'ea-beijing' },
    { id: 'toronto',  name: 'Toronto',       x: 47,  z: -3,  w: 8,  d: 10, seats: 8, device: 'Board Pro 55',   agent: 'ea-toronto' },
    // South wall
    { id: 'london',   name: 'London',        x: -33, z: 27,  w: 12, d: 8, seats: 10, device: 'Room Kit Pro',   agent: 'ea-london' },
    { id: 'chicago',  name: 'Chicago',       x: -19, z: 27,  w: 12, d: 8, seats: 10, device: 'Room Bar Pro',   agent: 'ea-chicago' },
    { id: 'tokyo',    name: 'Tokyo',         x: 21,  z: 27,  w: 12, d: 8, seats: 12, device: 'Room Kit EQX',   agent: 'ea-tokyo' },
    { id: 'mexico',   name: 'Mexico City',   x: 35,  z: 27,  w: 10, d: 8, seats: 8,  device: 'Room Bar',       agent: 'ea-mexico' },
    // West wall
    { id: 'dublin',   name: 'Dublin',        x: -47, z: -13, w: 8,  d: 10, seats: 6, device: 'Room Bar',       agent: 'ea-dublin' },
    { id: 'athens',   name: 'Athens',        x: -47, z: 1,   w: 8,  d: 8,  seats: 4, device: 'Desk Mini' },
    { id: 'lisbon',   name: 'Lisbon',        x: -47, z: 13,  w: 8,  d: 8,  seats: 4 },
  ],

  // Network closets with ThousandEyes Enterprise Agents (on the switch or SD-WAN appliance).
  closets: [
    { id: 'idf1', name: 'IDF 1-W', x: -40, z: 25, w: 6, d: 6, agent: 'ent-c9300-idf1', device: 'Catalyst 9300-48P' },
    { id: 'idf2', name: 'IDF 1-E', x: 48,  z: 13, w: 6, d: 8, agent: 'ent-c9300-idf2', device: 'Catalyst 9300-48UXM' },
    { id: 'mdf',  name: 'MDF',     x: -11, z: 13, w: 6, d: 6, agent: 'ent-mx-mdf',     device: 'Meraki MX250' },
  ],

  // Open-plan desk clusters: rows x cols of desks, each pair facing.
  desks: [
    { x: -30, z: -12, rows: 2, cols: 4 },
    { x: -30, z: 4,   rows: 2, cols: 4 },
    { x: 28,  z: -12, rows: 2, cols: 4 },
    { x: 28,  z: 4,   rows: 2, cols: 3 },
    { x: 8,   z: 23,  rows: 1, cols: 3 },
  ],

  // The middle: a round demo atrium with two briefing rooms.
  atrium: { x: 0, z: -6, r: 11, rooms: [
    { name: 'EBC-01', a: -2.4 }, { name: 'Demo Wall', a: -0.7 }, { name: 'EBC-02', a: 0.9 },
  ] },

  // Building core: lifts, stairs and restrooms (solid blocks).
  core: [
    { x: -12, z: 1, w: 8, d: 6, kind: 'core' },
    { x: 12,  z: 13, w: 8, d: 6, kind: 'core' },
  ],
  cafe: { x: -26, z: 18, w: 12, d: 6 },

  // Points of interest shown as small pins, and listed under "On this floor".
  pois: [
    { kind: 'cafeteria', name: 'Cafeteria',  x: -26, z: 18 },
    { kind: 'restroom',  name: 'Restrooms',  x: -12, z: 1 },
    { kind: 'stairs',    name: 'Stairs',     x: 12,  z: 11 },
    { kind: 'elevator',  name: 'Elevators',  x: 12,  z: 15 },
    { kind: 'helpdesk',  name: 'Help Desk',  x: -2,  z: 18 },
    { kind: 'lounge',    name: 'Lounge',     x: 30,  z: 16 },
    { kind: 'coffee',    name: 'Coffee',     x: -36, z: 18 },
    { kind: 'printer',   name: 'Printers',   x: 40,  z: 4 },
  ],
};
