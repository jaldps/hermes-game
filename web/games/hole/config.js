// Sinkhole City — tuning + content tables
export const ROUND_TIME = 120;

// City grid (world units ~ metres)
export const CITY = {
  NX: 7, NZ: 7,
  BLOCK: 26,     // block (incl. sidewalk) size
  ROAD: 9,       // road width
  WALK: 3.2,     // sidewalk width inside a block
  CURB_H: 0.16,  // block raised height
  BORDER: 9,     // promenade strip around the city
};
CITY.PITCH = CITY.BLOCK + CITY.ROAD;
CITY.SPAN = CITY.NX * CITY.PITCH + CITY.ROAD;          // road-to-road extent
CITY.X0 = -CITY.SPAN / 2;                              // first road starts here
CITY.HALF = CITY.SPAN / 2 + CITY.BORDER;               // platform half extent

// Hole growth: discrete levels, radius per level, mass needed per level
export const HOLE = {
  R0: 0.95,
  LEVEL_GROWTH: 1.165,
  MAX_LEVEL: 30,
  GROW: 0.21,            // fraction of swallowed footprint area added to the hole's area
  FIT: 0.94,             // object size must be < r*FIT to fall in
  SPEED_BASE: 7.2,
  SPEED_PER_R: 0.45,
  EAT_HOLE_RATIO: 1.22,
  BOT_GROW: 1.0,         // bots grow at player rate (no handicap)
};
export function levelRadius(L) { return HOLE.R0 * Math.pow(HOLE.LEVEL_GROWTH, L - 1); }
export function levelMass(L) { const a = levelRadius(L), b = levelRadius(L + 1); return Math.PI * (b * b - a * a) / HOLE.GROW; }
export function objectMass(size) { return Math.max(0.32, 3.2 * size * size); }

// Skins: rim styles (style index used by the rim shader)
export const SKINS = [
  { id: 'classic', name: 'Classic', price: 0, a: '#2f8cff', b: '#8fd0ff', style: 0 },
  { id: 'sunset', name: 'Sunset', price: 150, a: '#ff6a3d', b: '#ffcf5a', style: 1 },
  { id: 'toxic', name: 'Toxic', price: 300, a: '#59e000', b: '#e9ff6a', style: 2 },
  { id: 'candy', name: 'Candy', price: 450, a: '#ff4fa3', b: '#ffffff', style: 3 },
  { id: 'galaxy', name: 'Galaxy', price: 700, a: '#6a3dff', b: '#ff7ae6', style: 4 },
  { id: 'lava', name: 'Lava', price: 900, a: '#ff2a00', b: '#ffb000', style: 5 },
  { id: 'gold', name: 'Royal Gold', price: 1300, a: '#d9a521', b: '#fff1a8', style: 6 },
  { id: 'rainbow', name: 'Prism', price: 2000, a: '#ff3d6e', b: '#3dd6ff', style: 7 },
];

export const BOT_NAMES = ['Mango', 'Kraken', 'Zippy', 'Luna', 'Boltz', 'Pixel', 'Nova', 'Tacocat', 'Rubi', 'Gizmo', 'Yeti', 'Comet', 'Sushi', 'Wombat', 'Vortex', 'Pebble'];
export const BOT_COLORS = ['#ff4d4d', '#ffb02e', '#3ddc84', '#b46bff', '#ff5fb8', '#22d3ee', '#f5e04a', '#ff7a3d', '#8b9cff'];
export const NUM_BOTS = 7;

// Palette — warm, sunny, saturated
export const PAL = {
  walls: ['#f2a07b', '#f6c873', '#9fd8c8', '#b9a7e8', '#f4e3c3', '#ef8f8f', '#8ec5ef', '#f0b5cf', '#c9e08f', '#e9d1a6', '#ffd6a0', '#a5e0e4'],
  office: ['#7fb6e6', '#93c9d6', '#a7b9e8', '#c7d8e8', '#86c3b8'],
  roofs: ['#c75b4a', '#4f6ea8', '#6b7d5a', '#a8563f', '#5b5f73', '#d27a46'],
  cars: ['#e8433f', '#2f7de1', '#f7c531', '#ffffff', '#3a3f4a', '#35b26b', '#ff8a2a', '#9b5de5', '#e5e5e5', '#18a7c9'],
  shirts: ['#ff5a5f', '#3fa7ff', '#ffd23f', '#43d17a', '#b06bff', '#ff8c42', '#ffffff', '#2b2d42', '#ff70a6', '#20c4b5'],
  pants: ['#2b3a67', '#3d3d3d', '#6b4f3a', '#1f4e79', '#4a4a6a', '#7a7a7a', '#22303c'],
  foliage: ['#5fb83a', '#4ea832', '#78c443', '#3f9a3a', '#8acb4a', '#69b548'],
};
