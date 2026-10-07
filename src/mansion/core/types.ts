/**
 * Mansion blueprint schema.
 *
 * The blueprint is pure, serialisable data with no three.js dependency: the
 * game server, NPC/spy AI, tests and the renderer all consume the same object.
 * Conventions: metres, y up, plan = (x, z). The *garden front* faces +z, toward
 * the sniper perch; the entrance front faces -z.
 */
import type { Rect, Vec2, Vec3 } from './geom';

export type StyleId = 'palladian' | 'georgian' | 'beauxarts';
export type MassingType = 'block' | 'u-garden' | 'u-entrance' | 'h';
export type MansionSize = 'compact' | 'grand' | 'palatial';
export type FacadeSide = 'garden' | 'entrance' | 'east' | 'west';

export type RoomType =
  | 'ballroom'
  | 'grand-salon'
  | 'drawing-room'
  | 'music-room'
  | 'library'
  | 'dining-room'
  | 'gallery'
  | 'billiard-room'
  | 'card-room'
  | 'morning-room'
  | 'conservatory'
  | 'entrance-hall'
  | 'stair-hall'
  | 'corridor'
  | 'study'
  | 'cloakroom'
  | 'pantry'
  | 'service-stair'
  | 'landing'
  | 'bedroom'
  | 'sitting-room'
  | 'dressing-room'
  | 'bathroom';

/** party: guests mingle here. circulation: halls, corridors, stairs. */
export type RoomRole = 'party' | 'circulation' | 'private' | 'service';

export type WallFinish = 'damask' | 'silk' | 'stripe' | 'paneling' | 'paint' | 'stone';
export type FloorFinish = 'herringbone' | 'parquet' | 'marble' | 'checker' | 'stone' | 'carpet' | 'boards';

export interface RoomFinish {
  wall: WallFinish;
  /** Hex sRGB. */
  wallColor: string;
  trimColor: string;
  floor: FloorFinish;
  floorColor: string;
  ceilingColor: string;
  drapery: string;
  dado: boolean;
}

export interface LevelSpec {
  index: number;
  /** Finished floor elevation (m). Level 0 is the raised piano nobile. */
  floorY: number;
  height: number;
  ceilingY: number;
}

export interface RoofSpec {
  kind: 'hipped' | 'mansard' | 'flat' | 'glass';
  /** Top of the cornice / wall plate. */
  eaveY: number;
  pitchDeg: number;
  /** Parapet with balustrade hiding the roof foot (Palladian). */
  balustrade: boolean;
  /** Pediment gable over this mass on the given side (central pavilions). */
  pediment?: FacadeSide;
  dormers: boolean;
}

export interface Mass {
  id: string;
  kind: 'main' | 'wing' | 'pavilion' | 'conservatory';
  /** Wall-centreline footprint. */
  rect: Rect;
  levels: number;
  roof: RoofSpec;
  /** Façades of this mass that are exposed to the outside (not abutting another mass). */
  exposed: FacadeSide[];
}

export type OpeningKind = 'window' | 'french-window' | 'door' | 'double-door' | 'arch' | 'entrance';

export interface OpeningDressing {
  pediment?: 'triangle' | 'segment';
  keystone?: boolean;
  balconette?: boolean;
  surround?: boolean;
}

export interface Opening {
  id: string;
  kind: OpeningKind;
  /** Span along the wall measured from wall.a (m). */
  u0: number;
  u1: number;
  /** Absolute elevation of sill and head (m). */
  y0: number;
  y1: number;
  /** Has glass: sightlines pass, NPCs do not (unless passable). */
  glazed: boolean;
  /** NPCs can walk through. */
  passable: boolean;
  /** Obscured glass (bathrooms): blocks sightlines. */
  frosted?: boolean;
  /** Glazing bars per leaf: [columns, rows]. */
  panes?: [number, number];
  leaves?: 1 | 2;
  dressing?: OpeningDressing;
  /** Interior drapery state: sheer reduces visibility, drawn blocks it. */
  curtain?: 'open' | 'sheer' | 'drawn';
}

export interface Wall {
  id: string;
  level: number;
  massId: string;
  /** Centreline endpoints; axis-aligned with a < b along `axis`. */
  a: Vec2;
  b: Vec2;
  axis: 'x' | 'z';
  thickness: number;
  y0: number;
  y1: number;
  exterior: boolean;
  /** For exterior walls: the direction the outside face looks. */
  side?: FacadeSide;
  /**
   * Room on each side of the wall. `neg` is toward -z (axis 'x') or -x (axis 'z');
   * `pos` is the other side. null = outside.
   */
  neg: string | null;
  pos: string | null;
  openings: Opening[];
  /** Conservatory-style curtain wall: entirely glazed between mullions. */
  glazed?: boolean;
}

export interface Room {
  id: string;
  /** Dense index, used as the lighting scope and in nav grids. */
  index: number;
  type: RoomType;
  role: RoomRole;
  label: string;
  level: number;
  massId: string;
  /** Wall-centreline rectangle. */
  rect: Rect;
  /** Clear interior between wall faces. */
  inner: Rect;
  floorY: number;
  ceilingY: number;
  /** Openings in this room's floor (stairwells, gallery voids). */
  floorHoles: Rect[];
  /** True when the room rises through the level above (ballroom, stair hall). */
  doubleHeight: boolean;
  /** May be walked through to reach other rooms (enfilade). */
  passThrough: boolean;
  /** Has windows on the garden (stage) façade. */
  stage: boolean;
  /** 0 = dark, 1 = full party lighting. */
  lit: number;
  finish: RoomFinish;
}

export interface StairFlight {
  /** Foot of the flight (centre of the first tread nosing line), at its floor level. */
  x: number;
  y: number;
  z: number;
  /** Climbing direction in plan. */
  dir: '+x' | '-x' | '+z' | '-z';
  width: number;
  run: number;
  rise: number;
  steps: number;
}

export interface Stair {
  id: string;
  kind: 'grand' | 'service';
  fromLevel: number;
  toLevel: number;
  bottomRoom: string;
  topRoom: string;
  rect: Rect;
  flights: StairFlight[];
  landings: { rect: Rect; y: number }[];
}

export interface Portico {
  id: string;
  side: FacadeSide;
  /** Column centres. */
  columns: Vec2[];
  columnRadius: number;
  baseY: number;
  topY: number;
  order: 'doric' | 'ionic' | 'corinthian';
  /** Roofed area in front of the façade. */
  rect: Rect;
  pediment: boolean;
}

export type PropKind =
  | 'sofa'
  | 'armchair'
  | 'chair'
  | 'coffee-table'
  | 'side-table'
  | 'dining-table'
  | 'cocktail-table'
  | 'card-table'
  | 'console'
  | 'sideboard'
  | 'bookcase'
  | 'desk'
  | 'grand-piano'
  | 'bar-counter'
  | 'bar-shelf'
  | 'billiard-table'
  | 'fireplace'
  | 'statue'
  | 'bust'
  | 'painting'
  | 'mirror'
  | 'clock'
  | 'plant'
  | 'rug'
  | 'chandelier'
  | 'sconce'
  | 'lamp'
  | 'bed'
  | 'wardrobe'
  | 'bench'
  | 'globe'
  | 'music-stand'
  | 'harp'
  | 'cabinet'
  | 'safe'
  | 'urn'
  | 'lamppost'
  | 'lantern';

export type PoiType =
  | 'statue'
  | 'bookshelf'
  | 'bar'
  | 'piano'
  | 'painting'
  | 'fireplace'
  | 'clock'
  | 'ledger'
  | 'safe'
  | 'globe'
  | 'window';

export interface Prop {
  id: string;
  kind: PropKind;
  /** null = exterior (terrace, garden). */
  roomId: string | null;
  level: number;
  /** Base centre (floor contact point; for wall/ceiling mounts the mount point). */
  x: number;
  y: number;
  z: number;
  /** Rotation about +y (radians). Local +z is the prop's front. */
  yaw: number;
  w: number;
  d: number;
  h: number;
  variant: number;
  color?: string;
  mount: 'floor' | 'wall' | 'ceiling';
  blocksNav: boolean;
  /** Tall/solid enough to block a sightline. */
  occludes: boolean;
  poi?: PoiType;
}

export interface Poi {
  id: string;
  type: PoiType;
  propId?: string;
  roomId: string | null;
  level: number;
  x: number;
  y: number;
  z: number;
  /** Where an NPC stands to interact, and which way it faces. */
  stand: { x: number; z: number; yaw: number };
  /** Fraction (0..1) of a person at `stand` visible from the perch. */
  visibility: number;
}

export interface LightSpec {
  id: string;
  kind: 'chandelier' | 'sconce' | 'lamp' | 'candles' | 'fire' | 'lantern' | 'lamppost' | 'uplight' | 'bounce';
  /** Lighting scope: a room id, or 'exterior'. Lights never leak across scopes. */
  scope: string;
  x: number;
  y: number;
  z: number;
  /** Linear RGB, roughly unit luminance. */
  color: [number, number, number];
  /** Luminous intensity, candela. */
  intensity: number;
  /** Soft cutoff distance (m). */
  range: number;
}

export interface Tree {
  x: number;
  z: number;
  /** Ground elevation at the trunk. */
  y: number;
  height: number;
  crown: number;
  kind: 'oak' | 'beech' | 'cedar' | 'cypress' | 'yew' | 'poplar';
}

export interface Terrace {
  rect: Rect;
  y: number;
  /** Balustrade runs (centreline) with their top height above the terrace. */
  balustrades: { a: Vec2; b: Vec2; height: number }[];
  steps: { rect: Rect; dir: '+z' | '-z' | '+x' | '-x'; y0: number; y1: number; count: number }[];
}

export interface Perch {
  /** Sniper eye position (prone in the treeline). */
  eye: Vec3;
  /** Default aim point (garden façade centre). */
  target: Vec3;
  distance: number;
  azimuthDeg: number;
  fovMinDeg: number;
  fovMaxDeg: number;
}

export interface SkySpec {
  /** Sun azimuth (deg, 0 = +z, 90 = +x) and elevation (negative = below horizon). */
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  moonAzimuthDeg: number;
  moonElevationDeg: number;
  /** 0 = clear, 1 = overcast. */
  cloudiness: number;
}

export interface TerrainSpec {
  /** Lawn plateau half-extent around the house where the ground is flat. */
  flatRadius: number;
  /** Height of the wooded rise the perch sits on. */
  perchRise: number;
  /** Plan position of the rise crest. */
  crest: Vec2;
  undulation: number;
  seed: number;
}

export interface Site {
  terrace: Terrace;
  lawn: Rect;
  paths: { rect: Rect; kind: 'gravel' | 'flagstone' }[];
  fountain: { x: number; z: number; radius: number; tiers: number } | null;
  parterres: { rect: Rect; pattern: 'cross' | 'diamond' | 'ring' | 'quarters' }[];
  topiary: { x: number; z: number; height: number; radius: number; shape: 'cone' | 'ball' | 'spiral' }[];
  trees: Tree[];
  terrain: TerrainSpec;
  perch: Perch;
  sky: SkySpec;
}

export interface NavLevel {
  level: number;
  y: number;
  originX: number;
  originZ: number;
  cell: number;
  cols: number;
  rows: number;
  /** 1 = walkable. Row-major, index = row * cols + col (row along z). */
  walk: Uint8Array;
  /** Room index per cell; -1 outside, -2 terrace. */
  room: Int16Array;
  /** Visibility from the perch, 0..255 (person standing in the cell). */
  vis: Uint8Array;
}

export interface NavLink {
  kind: 'door' | 'french-window' | 'stair';
  from: string;
  to: string;
  /** Opening or stair id. */
  via: string;
  x: number;
  z: number;
  level: number;
}

export interface Nav {
  levels: NavLevel[];
  links: NavLink[];
}

export interface Sightlines {
  eye: Vec3;
  /** Mean visibility per room id (0..1), person-height samples. */
  rooms: Record<string, number>;
  terrace: number;
  /** Share of party floor area (incl. terrace) visible from the perch. */
  partyVisible: number;
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warn';
  message: string;
  ref?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  metrics: Record<string, number>;
}

export interface MansionOptions {
  seed: string | number;
  size?: MansionSize;
  style?: StyleId;
  massing?: MassingType;
  /** Override perch distance (m) and azimuth off the garden axis (deg). */
  perchDistance?: number;
  perchAzimuthDeg?: number;
  /** Mission objects that must exist, with minimum counts and how many must be visible. */
  requiredPois?: Partial<Record<PoiType, { min: number; visible: number }>>;
  /** Acceptable share of party floor visible from the perch. */
  partyVisibility?: [number, number];
  maxAttempts?: number;
  /** Nav/visibility grid resolution (m). */
  navCell?: number;
}

export interface StyleDef {
  id: StyleId;
  name: string;
  wallMaterial: 'limestone' | 'brick' | 'stucco';
  wallColor: string;
  trimColor: string;
  baseMaterial: 'rusticated' | 'limestone' | 'brick';
  roof: 'hipped' | 'mansard' | 'flat';
  roofMaterial: 'slate' | 'zinc' | 'lead';
  roofPitchDeg: [number, number];
  bayWidth: [number, number];
  levelHeights: [[number, number], [number, number], [number, number]];
  floors: [number, number];
  plinth: [number, number];
  porticoChance: number;
  pavilionChance: number;
  quoins: boolean;
  balustradeParapet: boolean;
  pedimentedWindows: boolean;
  balconettes: boolean;
  windowFrameColor: string;
  doorColor: string;
  columnOrder: 'doric' | 'ionic' | 'corinthian';
  massingWeights: Record<MassingType, number>;
}

export interface MansionBlueprint {
  schema: 'scope-and-drop/mansion@1';
  seed: string;
  /** Generation attempt that passed validation (0 = first try). */
  attempt: number;
  options: Required<Omit<MansionOptions, 'seed' | 'style' | 'massing' | 'perchDistance' | 'perchAzimuthDeg'>> &
    Pick<MansionOptions, 'style' | 'massing' | 'perchDistance' | 'perchAzimuthDeg'> & { seed: string };
  style: StyleDef;
  massing: MassingType;
  bay: number;
  bays: number;
  levels: LevelSpec[];
  /** Ground floor finished level above the lawn. */
  groundFloorY: number;
  masses: Mass[];
  rooms: Room[];
  walls: Wall[];
  stairs: Stair[];
  porticos: Portico[];
  props: Prop[];
  pois: Poi[];
  lights: LightSpec[];
  site: Site;
  nav: Nav;
  sightlines: Sightlines;
  validation: ValidationReport;
  stats: {
    rooms: number;
    partyRooms: number;
    partyArea: number;
    walls: number;
    openings: number;
    props: number;
    lights: number;
    footprint: Rect;
    generationMs: number;
  };
}
