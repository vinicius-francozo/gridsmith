/**
 * Frozen contracts. Every layer of the pipeline programs against this file;
 * nothing here changes without a decision that touches the whole project.
 *
 * Every coordinate is in grid cells. Pixels exist only in `src/renderer/`,
 * reached through the conversion helpers in `src/core/grid.ts`.
 */

export type Cell = { x: number; y: number };        // integers, grid cells
export type Size = { w: number; h: number };        // in cells
export type Facing = 'n' | 'e' | 's' | 'w';

export type Building = 'tavern' | 'dungeon';
export type RoomKind = 'hall' | 'room' | 'storeroom';
export type Place = { building: Building; room: RoomKind };
export type Light = 'dark' | 'dim' | 'bright';
export type Condition = 'tidy' | 'lived_in' | 'disordered' | 'ruined';

/** Interpreter output. Closed vocabulary — the generator's ceiling. */
export type Constraints = {
  place: Place;
  sizeHint?: 'small' | 'medium' | 'large';
  light: Light;
  condition: Condition;
  /**
   * 0..1. How much loose stuff covers the floor. Governs the scatter layer and
   * nothing else.
   *
   * It used to govern the furniture count as well, and that was the defect: a
   * description of a filthy ruin came back with nine tables in it, because one
   * dial was wired to two things a person asks for separately. The two are
   * split here, at the contract, so no engine can answer only one of them and
   * have the other silently follow.
   */
  clutter: number;
  /** 0..1. How furnished the place is. Governs the count of furniture groups. */
  furnishing: number;
  features: string[];           // 'hearth' | 'bar' | 'stairs' | ...
  /**
   * What the description asked for there to be **none of**, in the words of
   * `features`.
   *
   * Never filled by absence. A description that simply does not mention stairs
   * leaves this empty; only one that says there are none puts `stairs` here.
   * That distinction is the whole reason the field exists — before it,
   * "sem escadaria" and "said nothing about stairs" arrived at the generator as
   * the same thing, and the generator drew a staircase for both.
   *
   * Not every engine can fill it. See `local/interpret.ts`, which measured that
   * its classifier cannot tell the two apart and leaves this empty for the same
   * reason it leaves `unresolved` empty.
   */
  excluded: string[];
  unresolved: string[];         // asked for, not expressible
};

/** Resolver output: every value concrete, conflicts already settled. */
export type Params = {
  place: Place;
  size: Size;                   // derived from place, max 20x20
  light: Light;
  condition: Condition;
  clutter: number;
  furnishing: number;
  features: string[];
  /** Features the generator must not place, whatever else it wants to fill with. */
  excluded: string[];
  doorCount: number;
  seed: number;
  conflicts: string[];          // what could not be satisfied, and why
};

export type CellKind = 'void' | 'floor' | 'wall';
export type Door = { cell: Cell; facing: Facing };
export type WallSegment = { from: Cell; to: Cell };

/** Stage 1 output. */
export type Floorplan = {
  size: Size;
  cells: CellKind[][];          // [y][x]
  doors: Door[];
  walls: WallSegment[];         // derived from the footprint boundary
};

export type Zone = { material: string; cells: Cell[] };
export type Rotation = 0 | 90 | 180 | 270;
export type TileRef = { material: string; variant: number; rotation: Rotation };
export type PlacedProp = {
  assetId: string;
  cell: Cell;                   // anchor cell
  footprint: Size;
  rotation: Rotation;
  layer: 'anchor' | 'group' | 'scatter';
};
export type LightSource = { cell: Cell; radiusCells: number; colorHex: string };

/** Stages 2+3 output — the renderer's only input. */
export type Scene = {
  floorplan: Floorplan;
  zones: Zone[];
  tiles: TileRef[][];           // [y][x]
  props: PlacedProp[];
  lights: LightSource[];
};

export type AssetKind = 'tile' | 'anchor' | 'group' | 'scatter';
export type AssetDef = {
  id: string;
  kind: AssetKind;
  footprint: Size;
  tags: string[];
  againstWall: boolean;
};
export interface AssetLibrary {
  get(id: string): AssetDef | undefined;
  query(tags: string[], kind?: AssetKind): AssetDef[];
  bitmap(id: string, rotation: Rotation): Promise<ImageBitmap>;
}

export interface Rng { int(min: number, max: number): number; float(): number; pick<T>(xs: T[]): T; }
export interface Interpreter { interpret(text: string): Promise<Constraints>; }

/** Roll20's default grid. The single bridge between cells and pixels. */
export const PIXELS_PER_CELL = 70;

/**
 * No map is wider or taller than this, in cells. A business rule of the
 * project, not of any one module: it lives here so the interpreter, which
 * enforces it, and anything that later needs to reason about the ceiling
 * read the same number.
 */
export const MAX_SIDE = 20;
