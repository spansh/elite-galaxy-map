// Type declarations for elite-galaxy-map. The package itself is plain
// JavaScript (src/), so nothing needs building; these describe its public
// API for editors and TypeScript projects.

// ---- Shared shapes ---------------------------------------------------------

/** Galactic coordinates in light years, as in the journal and Spansh dumps. */
export interface Coordinates {
  x: number;
  y: number;
  z: number;
}

/** 'angled' looks down at about 50 degrees from the south; 'topDown' looks straight down with the core at the top. */
export type CameraView = 'angled' | 'topDown';

/** Shapes a highlight's ring can take, to tell kinds of system apart without relying on colour. */
export type MarkerShape = 'circle' | 'diamond' | 'square' | 'triangle';

/** true names every system, 'ifRoom' names those whose label fits, false names none (they still show on hover). */
export type NamingRule = boolean | 'ifRoom';

export type BackdropStyle = 'volumetric' | 'none';

export type LegendCorner = 'topRight' | 'topLeft' | 'bottomRight' | 'bottomLeft';

/** A system from a loaded layer, as given in hover and select events. */
export interface LoadedSystem {
  layer: string;
  name?: string;
  key?: unknown;
  coordinates: Coordinates;
}

/** A system to highlight with a ring (and its name). Returned as given, so extra fields are kept. */
export interface HighlightedSystem {
  name?: string;
  coordinates: Coordinates;
  /** Anything you want back when the system is picked, such as its id64. */
  key?: unknown;
  /** CSS colour; the map's highlightColour if left out. */
  colour?: string;
  shape?: MarkerShape;
  /** A dot in the middle of the ring. */
  centreDot?: boolean;
  /** Overrides showNames for this system. */
  showName?: NamingRule;
  /** The star system's name, for a station; stations at one place with the same system are listed under it. */
  system?: string;
  /** The station's name, listed under `system` where a place has several stops. */
  station?: string;
  [extraField: string]: unknown;
}

/** A system to select: from a layer, a highlight, or anywhere (for example a search box). */
export interface SelectableSystem {
  name?: string;
  coordinates: Coordinates;
  key?: unknown;
  layer?: string;
  [extraField: string]: unknown;
}

export type System = LoadedSystem | HighlightedSystem;

export interface LegendEntry {
  label: string;
  /** CSS colour; the map's highlightColour if left out. */
  colour?: string;
  shape?: MarkerShape;
  centreDot?: boolean;
  /** Shown beside the label. */
  count?: number;
}

export interface LayerAppearance {
  /** CSS colour. */
  colour?: string;
  starSizeInLightYears?: number;
  minimumPixelSize?: number;
  maximumPixelSize?: number;
  /** The dimmest a distant star may get, 0 to 1. */
  minimumBrightness?: number;
  opacity?: number;
}

export interface LayerSummary {
  layer: string;
  label: string;
  order: number;
  systemCount: number;
  visible: boolean;
  colour: string;
}

export interface BackdropState {
  style: BackdropStyle;
  showGalaxyImage: boolean;
}

export interface FrameStatistics {
  starsLoaded: number;
  starsDrawn: number;
  cellsOnScreen: number;
  crossFadesInProgress: number;
  drawCalls?: number;
  resolutionScale?: number;
  isMoving?: boolean;
  cpuMilliseconds?: number;
}

/** The area of the galaxy a density map covers. */
export interface DensityMapArea {
  centreX: number;
  centreZ: number;
  widthInLightYears: number;
}

export interface VolumetricSettings {
  thinnestDiscLightYears?: number;
  thickestBulgeLightYears?: number;
  boxHeightLightYears?: number;
  planeGalacticHeight?: number;
  stepCount?: number;
  brightness?: number;
}

export interface GridAppearance {
  /** One colour for each grid: 10, 100, 1,000 and 10,000 ly. */
  gridColours?: [string, string, string, string];
  gridOpacities?: [number, number, number, number];
  axisColour?: string;
  axisOpacity?: number;
  labelColour?: string;
  labelOpacity?: number;
}

export interface RegionAppearance {
  borderColour?: string;
  borderOpacity?: number;
  labelColour?: string;
  labelOpacity?: number;
  /** In CSS pixels. */
  labelFontSize?: number;
}

/** One of the galaxy's 42 regions. */
export interface GalaxyRegion {
  /** 1 to 42, as in the game's codex. */
  number: number;
  name: string;
  /** Where its name is drawn, in galactic light years. */
  labelX: number;
  labelZ: number;
  /** Its size, in cells of about 49.35 ly each way. */
  areaInCells: number;
}

// ---- User interface --------------------------------------------------------

/** Parts of the map's own interface that can be switched on or off. */
export interface UserInterfaceSettings {
  rotate: boolean;
  pan: boolean;
  zoom: boolean;
  keyboardMovement: boolean;
  hover: boolean;
  selectByClick: boolean;
  flyToSelection: boolean;
  grid: boolean;
  gridLabel: boolean;
  loadingOverlay: boolean;
  legend: boolean;
  /** The borders and names of the galaxy's regions. Off by default. */
  regions: boolean;
  panel: boolean;
  layerList: boolean;
  displaySettings: boolean;
  routePicker: boolean;
  selectionDetails: boolean;
  /** Off by default: the panel's Load, Stop and Clear stars only raise loadrequest and stoprequest. */
  dataLoading: boolean;
}

export const DEFAULT_USER_INTERFACE: Readonly<UserInterfaceSettings>;

// ---- Text ------------------------------------------------------------------

/** The names of the map's texts; DEFAULT_TEXT gives each one's English. */
export type MapTextKey =
  | 'panelTitle'
  | 'foldPanel'
  | 'openPanel'
  | 'dataHeading'
  | 'dumpAddress'
  | 'load'
  | 'stop'
  | 'clearStars'
  | 'layersHeading'
  | 'layersSummary'
  | 'showLayers'
  | 'foldLayers'
  | 'noStarsLoaded'
  | 'routeHeading'
  | 'routeFile'
  | 'noRouteLoaded'
  | 'clearRoute'
  | 'routeFileUnreadable'
  | 'routeUnreadable'
  | 'routeEmpty'
  | 'routeSummary'
  | 'tradeRouteSummary'
  | 'displayHeading'
  | 'galaxyGlow'
  | 'galaxyImage'
  | 'grid'
  | 'regions'
  | 'selectedSystemHeading'
  | 'selectPrompt'
  | 'selectedSystemCoordinates'
  | 'distanceFromSol'
  | 'unnamedSystem'
  | 'legend'
  | 'neutronBoostStop'
  | 'refuelStop'
  | 'neutronBoostAndRefuelStop'
  | 'otherStop'
  | 'loadingSystemsOfSize'
  | 'loadingSystems'
  | 'loadingOfSize'
  | 'loading'
  | 'loadingFailed';

/** The map's own text as ICU messages by key; keys left out stay in English. */
export type MapText = Partial<Record<MapTextKey, string>>;

export const DEFAULT_TEXT: Readonly<Record<MapTextKey, string>>;

// ---- Options ---------------------------------------------------------------

export interface GalaxyMapOptions {
  cellSizeInLightYears: number;
  backdropStyle: BackdropStyle;
  showGalaxyImage: boolean;
  densityMapUrl: string;
  densityMapArea: DensityMapArea;
  backdropSettings: { volumetric?: VolumetricSettings };
  /** A .ttf, .otf or .woff font for labels. */
  fontUrl: string;
  gridAppearance: GridAppearance;
  /** The region map, for region borders, names and findRegion; null for none. Defaults to the one bundled. */
  regionMapUrl: string | null;
  regionAppearance: RegionAppearance;
  userInterface: Partial<UserInterfaceSettings>;
  panelDataUrl: string;
  panelLayerListFolded: boolean;
  initialTarget: Coordinates;
  initialDistance: number;
  initialView: CameraView;
  highlightedSystems: HighlightedSystem[];
  /** Start with the camera fitting the highlights on screen. */
  frameHighlightedSystems: boolean;
  /** Closest the camera comes when framing, in light years. */
  framingMinimumDistance: number;
  highlightsAreRoute: boolean;
  showHighlightNames: NamingRule;
  highlightColour: string;
  legend: LegendEntry[];
  legendCorner: LegendCorner;
  text: MapText;
  /** A language tag such as 'fr', for plurals and numbers; null for the browser's language. */
  locale: string | null;
  backgroundColour: string;
  exposure: number;
  maximumPixelRatio: number;
  pickTolerancePixels: number;
  highlightPickTolerancePixels: number;
  selectionFlightMilliseconds: number;
  selectionViewDistance: { minimum: number; maximum: number };
  keyboardMovementSpeed: number;
  maximumStarsPerPixel: number;
  starBudget: number;
  starBudgetWhileMoving: number;
  pixelRatioWhileMoving: number;
  starDimmingWithHighlights: number;
}

export const DEFAULT_OPTIONS: Readonly<GalaxyMapOptions>;

// ---- Commands --------------------------------------------------------------

export interface DefineLayerCommand extends LayerAppearance {
  type: 'defineLayer';
  layer: string;
  label?: string;
  order?: number;
  visible?: boolean;
}

export interface AddSystemsCommand {
  type: 'addSystems';
  layer: string;
  /** x, y, z for each system, one after another. Send it as a transferable from a worker. */
  positions: Float32Array;
  /** An array, or one string with a newline between names (much cheaper to post). */
  names?: string[] | string;
  keys?: unknown[];
}

export interface ClearLayerCommand { type: 'clearLayer'; layer: string }
export interface RemoveLayerCommand { type: 'removeLayer'; layer: string }
export interface RemoveAllLayersCommand { type: 'removeAllLayers' }
export interface SetLayerVisibilityCommand { type: 'setLayerVisibility'; layer: string; visible: boolean }

export interface SelectSystemCommand {
  type: 'selectSystem';
  /** null clears the selection. */
  system: SelectableSystem | null;
  flyTo?: boolean;
}

export interface MoveCameraCommand {
  type: 'moveCamera';
  target?: Coordinates;
  distance?: number;
  view?: CameraView;
}

export interface HighlightSystemsCommand {
  type: 'highlightSystems';
  systems: HighlightedSystem[];
  asRoute?: boolean;
  showNames?: NamingRule;
  frame?: boolean;
  view?: CameraView;
}

export interface ClearHighlightsCommand { type: 'clearHighlights' }

export interface SetLegendCommand {
  type: 'setLegend';
  /** An empty list hides the legend. */
  entries: LegendEntry[];
}

export interface SetTextCommand {
  type: 'setText';
  /** Replaces the map's text; keys left out go back to English. */
  text: MapText;
  locale?: string | null;
}

export interface SetGridHeightCommand { type: 'setGridHeight'; y: number }
export interface SetGridVisibilityCommand { type: 'setGridVisibility'; visible: boolean }

export interface SetUserInterfaceCommand extends Partial<UserInterfaceSettings> {
  type: 'setUserInterface';
}

export interface SetBackdropCommand {
  type: 'setBackdrop';
  style?: BackdropStyle;
  showGalaxyImage?: boolean;
}

export interface SetExposureCommand { type: 'setExposure'; exposure: number }

export interface LoadingProgressCommand {
  type: 'loadingProgress';
  loadedBytes: number;
  totalBytes?: number;
  systemCount?: number;
}

export interface LoadingFinishedCommand { type: 'loadingFinished'; systemCount?: number }
export interface LoadingFailedCommand { type: 'loadingFailed'; message: string }

export type GalaxyMapCommand =
  | DefineLayerCommand
  | AddSystemsCommand
  | ClearLayerCommand
  | RemoveLayerCommand
  | RemoveAllLayersCommand
  | SetLayerVisibilityCommand
  | SelectSystemCommand
  | MoveCameraCommand
  | HighlightSystemsCommand
  | ClearHighlightsCommand
  | SetLegendCommand
  | SetTextCommand
  | SetGridHeightCommand
  | SetGridVisibilityCommand
  | SetUserInterfaceCommand
  | SetBackdropCommand
  | SetExposureCommand
  | LoadingProgressCommand
  | LoadingFinishedCommand
  | LoadingFailedCommand;

export type GalaxyMapCommandType = GalaxyMapCommand['type'];

export const COMMAND_TYPES: Readonly<{ [Type in GalaxyMapCommandType]: Type }>;

/** Throws an error saying what's wrong if the command isn't one the map accepts. */
export function validateCommand(command: unknown): asserts command is GalaxyMapCommand;

// ---- Events ----------------------------------------------------------------

export interface GalaxyMapEventDetails {
  systemhover: { system: System | null };
  systemselect: { system: System | SelectableSystem | null };
  layerschange: { layers: LayerSummary[] };
  backdropchange: BackdropState;
  userinterfacechange: { userInterface: UserInterfaceSettings };
  framerender: FrameStatistics;
  loadrequest: { url: string };
  stoprequest: undefined;
  textchange: { locale: string };
}

export type GalaxyMapEventMap = {
  [EventName in keyof GalaxyMapEventDetails]: CustomEvent<GalaxyMapEventDetails[EventName]>;
};

// ---- The map ---------------------------------------------------------------

export interface ControlPanel {
  /** Shows a route from one of Spansh's plotters, as the panel's file picker does. */
  showRoute(routeResult: unknown): void;
  showRouteMessage(message: string): void;
  setFolded(isFolded: boolean): void;
  setLayerListFolded(isFolded: boolean): void;
}

export class GalaxyMap extends EventTarget {
  constructor(containerElement: HTMLElement, options?: Partial<GalaxyMapOptions>);

  readonly options: Readonly<GalaxyMapOptions>;
  readonly controlPanel: ControlPanel;

  /** Sends the map a command. Throws if the command is invalid. */
  dispatch(command: GalaxyMapCommand): void;

  getLayers(): LayerSummary[];
  getBackdrop(): BackdropState;
  getUserInterface(): UserInterfaceSettings;
  getHighlightedSystems(): HighlightedSystem[];
  getFrameStatistics(): FrameStatistics;

  /** The region at galactic coordinates (only x and z matter), or null outside the map. Loads the region map if need be. */
  findRegion(coordinates: Coordinates): Promise<{ number: number; name: string } | null>;

  /** Stops drawing and frees everything the map made, including its canvas. */
  dispose(): void;

  addEventListener<EventName extends keyof GalaxyMapEventMap>(
    type: EventName,
    listener: (event: GalaxyMapEventMap[EventName]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;

  removeEventListener<EventName extends keyof GalaxyMapEventMap>(
    type: EventName,
    listener: (event: GalaxyMapEventMap[EventName]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}

// ---- Spansh routes ---------------------------------------------------------

export * from './spansh-route';

// ---- Backdrop, markers, legend and coordinates -----------------------------

export const BACKDROP_STYLES: readonly BackdropStyle[];
export const GALAXY_DENSITY_MAP_AREA: Readonly<DensityMapArea>;
export const MARKER_SHAPE_NAMES: readonly MarkerShape[];
export const LEGEND_CORNERS: readonly LegendCorner[];

// ---- Galactic regions ------------------------------------------------------

/** The address of the bundled region map (from klightspeed's EliteDangerousRegionMap, MIT licence). */
export const GALAXY_REGIONS_URL: string;
export const DEFAULT_REGION_APPEARANCE: Readonly<Required<RegionAppearance>>;

/** The galaxy's regions, for looking up which one a position is in without a map on the page. */
export class GalaxyRegions {
  constructor(data: unknown);
  /** The region at galactic coordinates (only x and z matter), or null outside the map. */
  regionAt(coordinates: Coordinates): GalaxyRegion | null;
  readonly allRegions: GalaxyRegion[];
  readonly cellSizeInLightYears: number;
}

/** Loads a region map: the bundled one unless another address is given. */
export function loadGalaxyRegions(url?: string): Promise<GalaxyRegions>;

/** Sagittarius A*, the centre of the galaxy, in galactic coordinates. */
export const SAGITTARIUS_A_STAR: Readonly<Coordinates>;

/** A three.js Vector3, described here so using the map doesn't need three's own type package. */
export interface SceneVector {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
}

/** Galactic coordinates to the map's three.js scene coordinates (z is flipped). Returns a three.js Vector3, or fills in the one given. */
export function galacticToScene<Vector extends SceneVector>(galacticCoordinates: Coordinates, targetVector: Vector): Vector;
export function galacticToScene(galacticCoordinates: Coordinates): SceneVector;
export function sceneToGalactic(sceneVector: Coordinates): Coordinates;
