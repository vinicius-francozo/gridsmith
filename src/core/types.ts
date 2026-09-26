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

export type PlaceType = 'tavern_hall' | 'tavern_room' | 'tavern_storeroom';
export type Light = 'dark' | 'dim' | 'bright';
export type Condition = 'tidy' | 'lived_in' | 'disordered' | 'ruined';

/** Interpreter output. Closed vocabulary — the generator's ceiling. */
export type Constraints = {
  placeType: PlaceType;
  sizeHint?: 'small' | 'medium' | 'large';
  light: Light;
  condition: Condition;
  clutter: number;              // 0..1
  features: string[];           // 'hearth' | 'bar' | 'stairs' | ...
  unresolved: string[];         // asked for, not expressible
};

/** Resolver output: every value concrete, conflicts already settled. */
export type Params = {
  placeType: PlaceType;
  size: Size;                   // derived from placeType, max 20x20
  light: Light;
  condition: Condition;
  clutter: number;
  features: string[];
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
