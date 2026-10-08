import type { Rng } from './rng';
import type { FloorFinish, RoomFinish, RoomType, StyleDef, StyleId, WallFinish } from './types';

/**
 * Architectural style presets. Values are tuned for a ~70% realistic / 30%
 * appealing read: real proportions and materials, with a slightly richer
 * palette and cleaner silhouettes than a photograph.
 */
export const STYLES: Record<StyleId, StyleDef> = {
  palladian: {
    id: 'palladian',
    name: 'Palladian Limestone',
    wallMaterial: 'limestone',
    wallColor: '#d9cfbd',
    trimColor: '#e8e1d2',
    baseMaterial: 'rusticated',
    roof: 'hipped',
    roofMaterial: 'slate',
    roofPitchDeg: [24, 30],
    bayWidth: [3.8, 4.4],
    levelHeights: [
      [4.8, 5.6],
      [4.0, 4.4],
      [3.1, 3.4],
    ],
    floors: [2, 3],
    plinth: [1.2, 1.6],
    porticoChance: 0.75,
    pavilionChance: 0.55,
    quoins: false,
    balustradeParapet: true,
    pedimentedWindows: true,
    balconettes: false,
    windowFrameColor: '#ece8df',
    doorColor: '#2c3a33',
    columnOrder: 'ionic',
    massingWeights: { block: 0.35, 'u-garden': 0.25, 'u-entrance': 0.2, h: 0.2 },
  },
  georgian: {
    id: 'georgian',
    name: 'Georgian Red Brick',
    wallMaterial: 'brick',
    wallColor: '#9a4f3a',
    trimColor: '#e4dccb',
    baseMaterial: 'limestone',
    roof: 'hipped',
    roofMaterial: 'slate',
    roofPitchDeg: [32, 40],
    bayWidth: [3.6, 4.1],
    levelHeights: [
      [4.5, 5.1],
      [3.9, 4.3],
      [3.0, 3.3],
    ],
    floors: [2, 3],
    plinth: [1.0, 1.4],
    porticoChance: 0.4,
    pavilionChance: 0.6,
    quoins: true,
    balustradeParapet: false,
    pedimentedWindows: false,
    balconettes: false,
    windowFrameColor: '#f2efe8',
    doorColor: '#1f2b24',
    columnOrder: 'doric',
    massingWeights: { block: 0.4, 'u-garden': 0.2, 'u-entrance': 0.25, h: 0.15 },
  },
  beauxarts: {
    id: 'beauxarts',
    name: 'Beaux-Arts Mansard',
    wallMaterial: 'limestone',
    wallColor: '#e2d6bf',
    trimColor: '#efe6d3',
    baseMaterial: 'rusticated',
    roof: 'mansard',
    roofMaterial: 'zinc',
    roofPitchDeg: [68, 74],
    bayWidth: [3.9, 4.5],
    levelHeights: [
      [5.0, 5.8],
      [4.1, 4.6],
      [3.2, 3.5],
    ],
    floors: [2, 3],
    plinth: [1.1, 1.5],
    porticoChance: 0.35,
    pavilionChance: 0.8,
    quoins: false,
    balustradeParapet: false,
    pedimentedWindows: true,
    balconettes: true,
    windowFrameColor: '#e9e4da',
    doorColor: '#26303a',
    columnOrder: 'corinthian',
    massingWeights: { block: 0.3, 'u-garden': 0.3, 'u-entrance': 0.15, h: 0.25 },
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

/* ------------------------------------------------------------------ */
/* Interior palettes. Jewel tones under warm light read rich through   */
/* cool twilight glass; that warm/cool split is the core of the look.  */
/* ------------------------------------------------------------------ */

const WALL_PALETTES: Record<string, string[]> = {
  ballroom: ['#efe4cf', '#e8dcc4', '#e9e0d0', '#dfe3da'],
  salon: ['#7d8f78', '#8aa0a8', '#b98a83', '#9c8a5a', '#6f7f99', '#a7a07d'],
  library: ['#3b2a1f', '#4a3424', '#2f3a2c', '#5a2e26'],
  dining: ['#7a2b26', '#2f4a3c', '#6b2f3d', '#304458', '#8a5a2b'],
  music: ['#a9b7c4', '#c4b5a5', '#b7c2b0', '#c9aeb0'],
  gallery: ['#5d6b5f', '#6b5d58', '#58606d', '#7b2f2f'],
  billiard: ['#2d4a35', '#5a2a24', '#3a3f4a'],
  hall: ['#ddd3c0', '#d4ccbb', '#cfc6b4'],
  private: ['#c9c2a8', '#a9b8b0', '#c7aea6', '#b9b3c9', '#d1c7b0', '#9fb0a0'],
  service: ['#cfc8b8', '#bfb8a6'],
  conservatory: ['#e5e0d2'],
};

const DRAPERY = ['#7d1f22', '#8a6a1f', '#2d4b39', '#3f2f5a', '#6a1d33', '#9a7b3a', '#284058'];

function wallKey(type: RoomType): string {
  switch (type) {
    case 'ballroom':
    case 'grand-salon':
    case 'hall-gallery':
      return 'ballroom';
    case 'drawing-room':
    case 'morning-room':
    case 'card-room':
      return 'salon';
    case 'library':
    case 'study':
      return 'library';
    case 'dining-room':
      return 'dining';
    case 'music-room':
      return 'music';
    case 'gallery':
      return 'gallery';
    case 'billiard-room':
      return 'billiard';
    case 'entrance-hall':
    case 'stair-hall':
    case 'landing':
    case 'corridor':
      return 'hall';
    case 'conservatory':
      return 'conservatory';
    case 'pantry':
    case 'service-stair':
    case 'cloakroom':
    case 'bathroom':
      return 'service';
    default:
      return 'private';
  }
}

function wallFinishFor(type: RoomType, rng: Rng): WallFinish {
  switch (type) {
    case 'library':
    case 'study':
    case 'billiard-room':
      return 'paneling';
    case 'ballroom':
    case 'grand-salon':
      return rng.pick<WallFinish>(['paneling', 'silk', 'paint']);
    case 'entrance-hall':
    case 'stair-hall':
    case 'conservatory':
      return 'stone';
    case 'drawing-room':
    case 'dining-room':
    case 'music-room':
    case 'morning-room':
    case 'card-room':
      return rng.pick<WallFinish>(['damask', 'silk', 'stripe', 'damask']);
    case 'gallery':
      return rng.pick<WallFinish>(['silk', 'paint']);
    case 'bedroom':
    case 'sitting-room':
    case 'dressing-room':
      return rng.pick<WallFinish>(['damask', 'stripe', 'paint']);
    default:
      return 'paint';
  }
}

function floorFinishFor(type: RoomType, rng: Rng): FloorFinish {
  switch (type) {
    case 'ballroom':
      return rng.pick<FloorFinish>(['herringbone', 'marble', 'herringbone']);
    case 'grand-salon':
      return rng.pick<FloorFinish>(['marble', 'herringbone']);
    case 'entrance-hall':
    case 'stair-hall':
      return rng.pick<FloorFinish>(['checker', 'marble', 'stone']);
    case 'conservatory':
      return rng.pick<FloorFinish>(['checker', 'stone']);
    case 'roof-terrace':
      return 'stone';
    case 'corridor':
    case 'landing':
      return rng.pick<FloorFinish>(['parquet', 'boards', 'stone']);
    case 'pantry':
    case 'service-stair':
    case 'cloakroom':
      return 'stone';
    case 'bathroom':
      return 'marble';
    case 'bedroom':
    case 'dressing-room':
      return rng.pick<FloorFinish>(['carpet', 'boards', 'parquet']);
    default:
      return rng.pick<FloorFinish>(['herringbone', 'parquet', 'herringbone']);
  }
}

const FLOOR_COLORS: Record<FloorFinish, string[]> = {
  herringbone: ['#8a5a32', '#7a4e2c', '#9a6a3c'],
  parquet: ['#7b5233', '#6e4a2e', '#8c6440'],
  boards: ['#6b4a30', '#7d5a3a'],
  marble: ['#e6e1d8', '#ddd6ca', '#d8d2c8'],
  checker: ['#e8e3d8'],
  stone: ['#b9b1a2', '#c4bcab'],
  carpet: ['#6a2a2a', '#2f3e5a', '#5a4a2a', '#3a4a3a'],
};

export function roomFinish(type: RoomType, rng: Rng): RoomFinish {
  const wall = wallFinishFor(type, rng);
  const floor = floorFinishFor(type, rng);
  const key = wallKey(type);
  let wallColor = rng.pick(WALL_PALETTES[key]!);
  if (wall === 'stone') wallColor = rng.pick(['#d8cfbf', '#cfc5b2', '#ddd5c6']);
  if (wall === 'paneling' && (type === 'ballroom' || type === 'grand-salon')) wallColor = rng.pick(['#efe7d6', '#e6ddc8']);
  return {
    wall,
    wallColor,
    trimColor: wall === 'paneling' && key === 'library' ? '#3a2618' : rng.pick(['#f1ece2', '#ebe3d2', '#efe9dc']),
    floor,
    floorColor: rng.pick(FLOOR_COLORS[floor]),
    ceilingColor: type === 'library' ? '#d9cdb5' : rng.pick(['#f3efe6', '#efe9dc', '#f1eadb']),
    drapery: rng.pick(DRAPERY),
    dado: wall === 'damask' || wall === 'silk' || wall === 'stripe' ? rng.chance(0.6) : false,
  };
}

export const ROOM_LABELS: Record<RoomType, string> = {
  ballroom: 'Ballroom',
  'grand-salon': 'Grand Salon',
  'drawing-room': 'Drawing Room',
  'music-room': 'Music Room',
  library: 'Library',
  'dining-room': 'Dining Room',
  gallery: 'Picture Gallery',
  'billiard-room': 'Billiard Room',
  'card-room': 'Card Room',
  'morning-room': 'Morning Room',
  conservatory: 'Conservatory',
  'entrance-hall': 'Entrance Hall',
  'stair-hall': 'Stair Hall',
  corridor: 'Corridor',
  study: 'Study',
  cloakroom: 'Cloakroom',
  pantry: "Butler's Pantry",
  'service-stair': 'Service Stair',
  landing: 'Landing',
  'hall-gallery': 'Hall Gallery',
  'roof-terrace': 'Roof Terrace',
  bedroom: 'Bedroom',
  'sitting-room': 'Sitting Room',
  'dressing-room': 'Dressing Room',
  bathroom: 'Bathroom',
};
