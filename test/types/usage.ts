// Uses the map's API as a page would, so `pnpm run typecheck` catches the
// type declarations (types/) drifting from the code. The lines marked as
// expected errors must fail: they are mistakes the declarations should catch.

import {
  GalaxyMap, DEFAULT_OPTIONS, COMMAND_TYPES, validateCommand, MARKER_SHAPE_NAMES,
  routeStopLegend, routeStopMarker, routeSystemsFromSpanshResult, galacticToScene, loadGalaxyRegions, DEFAULT_TEXT,
  type GalaxyMapCommand, type HighlightedSystem, type LegendEntry, type MapText,
} from 'elite-galaxy-map';
import { ROUTE_STOP_LABELS } from 'elite-galaxy-map/spansh-route.js';
import { layerForMainStar, STAR_CLASS_LAYERS } from 'elite-galaxy-map/star-classes.js';
import { parseDumpLine } from 'elite-galaxy-map/read-lines.js';
import DefaultGalaxyMap from 'elite-galaxy-map';

declare const element: HTMLElement;

const routeSystems: HighlightedSystem[] = [
  { name: 'Sol', key: '10477373803', coordinates: { x: 0, y: 0, z: 0 }, ...routeStopMarker({ has_neutron: true }) },
  { name: 'Colonia', coordinates: { x: -9530.5, y: -910.28, z: 19808.13 }, showName: true },
];
const legend: LegendEntry[] = routeStopLegend(routeSystems, { labels: { neutronBoost: 'Neutron', other: 'Jump' } });

const galaxyMap = new GalaxyMap(element, {
  highlightedSystems: routeSystems,
  highlightsAreRoute: true,
  legend,
  legendCorner: 'bottomRight',
  framingMinimumDistance: 2000,
  userInterface: { layerList: false, routePicker: false, regions: true },
  regionAppearance: { borderOpacity: 0.7 },
});
new GalaxyMap(element, { regionMapUrl: null });
const frenchText: MapText = { load: 'Charger', routeSummary: '{start} → {end}, {jumpCount, plural, one {# saut} other {# sauts}}' };
new GalaxyMap(element, { text: frenchText, locale: 'fr' });
new GalaxyMap(element, {
  // @ts-expect-error A text key that doesn't exist.
  text: { loadButton: 'Charger' },
});

// @ts-expect-error GalaxyMap is a named export: the default import isn't the map.
new DefaultGalaxyMap(element);

new GalaxyMap(element, {
  // @ts-expect-error A misspelt option.
  highlightColor: '#fff',
});
new GalaxyMap(element, {
  // @ts-expect-error A user interface setting that doesn't exist.
  userInterface: { routeLoader: false },
});

galaxyMap.dispatch({ type: 'moveCamera', view: 'topDown' });
galaxyMap.dispatch({ type: 'highlightSystems', systems: routeSystemsFromSpanshResult({}), asRoute: true, showNames: 'ifRoom', numberStops: 'all', frame: true });
galaxyMap.dispatch({ type: 'setLegend', entries: [{ label: 'Reference', colour: '#6ea8fe', shape: 'square' }] });
galaxyMap.dispatch({ type: 'setUserInterface', panel: false });
galaxyMap.dispatch({ type: COMMAND_TYPES.clearHighlights });
galaxyMap.dispatch({ type: 'setText', text: { stop: 'Arrêter' }, locale: 'fr' });
galaxyMap.addEventListener('textchange', event => console.log(event.detail.locale, DEFAULT_TEXT.load));
galaxyMap.dispatch({ type: 'addSystems', layer: 'neutron', positions: new Float32Array(3), names: 'Sol' });
galaxyMap.dispatch({ type: 'defineLayer', ...layerForMainStar('Neutron Star') });
// @ts-expect-error A command type that doesn't exist.
galaxyMap.dispatch({ type: 'highlight', systems: [] });
// @ts-expect-error A shape that doesn't exist.
galaxyMap.dispatch({ type: 'setLegend', entries: [{ label: 'Odd', shape: 'star' }] });
// @ts-expect-error A camera view that doesn't exist.
galaxyMap.dispatch({ type: 'moveCamera', view: 'side' });

galaxyMap.addEventListener('systemselect', event => {
  const system = event.detail.system;
  if (system !== null) {
    console.log(system.name, system.coordinates.x);
  }
});
galaxyMap.addEventListener('framerender', event => console.log(event.detail.starsDrawn));
galaxyMap.controlPanel.showRoute({});
galaxyMap.findRegion({ x: 0, y: 0, z: 0 }).then(region => console.log(region?.name.toUpperCase()));
loadGalaxyRegions().then(regions => console.log(regions.regionAt({ x: 0, y: 0, z: 0 })?.number));

const message: unknown = JSON.parse('{}');
validateCommand(message);
const checked: GalaxyMapCommand = message;

const shapes: readonly string[] = MARKER_SHAPE_NAMES;
const exposure: number = DEFAULT_OPTIONS.exposure;
const label: string = ROUTE_STOP_LABELS.other + STAR_CLASS_LAYERS.neutron.label;
const sceneX: number = galacticToScene({ x: 1, y: 2, z: 3 }).x;
const parsed = parseDumpLine('{}');
galaxyMap.dispose();
export { checked, shapes, exposure, label, sceneX, parsed };
