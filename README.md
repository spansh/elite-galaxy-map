# elite-galaxy-map

A three.js map of the Elite Dangerous galaxy that draws into any element on a
page. Systems are streamed in as they arrive, so the map doesn't need to know
in advance what it will show, and millions of systems stay interactive.

```js
import { GalaxyMap } from 'elite-galaxy-map';

const galaxyMap = new GalaxyMap(document.getElementById('neutron-map'));

// The example loader from examples/spansh-loader/, copied to your site. The
// page must be allowed to read the dump: from the same site, as here, or
// from a server whose CORS headers allow the page's site (see "Loading dumps
// in the demo" below).
const loader = new Worker('/js/spansh-loader/spansh-loader-worker.js', { type: 'module' });
loader.addEventListener('message', event => galaxyMap.dispatch(event.data));
loader.postMessage({ type: 'startLoading', url: '/dumps/systems_neutron.json.gz' });

galaxyMap.addEventListener('systemselect', event => console.log(event.detail.system));
```

The element needs a size (for example `height: 70vh`). If it has no height, the
map makes it 16:10. A map made in a hidden element (an inactive tab, say)
waits until the element is shown.

## Builds

| Import | For |
| --- | --- |
| `elite-galaxy-map` | The map, for bundlers (Vite, webpack 5, esbuild, Rollup). The source as it is; nothing needs building. |
| `elite-galaxy-map/spansh-loader-worker.js` | The example loader worker. |
| `elite-galaxy-map/read-lines.js` | Its dump-reading helpers (`readLines`, `parseDumpLine`, `unpackIfGzipped`). |
| `elite-galaxy-map/star-classes.js` | Its sorting of main star types into layers (`layerForMainStar`, `STAR_CLASS_LAYERS`). |
| `elite-galaxy-map/spansh-route.js` | `routeSystemsFromSpanshResult`, `routeStopMarker`, `routeStopLegend`, `ROUTE_STOP_COLOURS` and `ROUTE_STOP_LABELS` (also exported by the map). |

The source finds its font and density map with
`new URL('../assets/...', import.meta.url)`, which bundlers follow and copy
into the build. Nothing needs building for bundlers, so the package also
works installed straight from its git repository.

`three` is a peer dependency (0.170 or later).

Type declarations come with it (`types/`), so editors autocomplete options,
commands and events, and TypeScript projects check them, without the map
itself needing building. They don't need three's own type package.

For a page without a bundler, `pnpm run build` writes
`dist/galaxy-map.standalone.js`, with everything but `three` built in; copy
it to your site and load it with an import map. `dist/` isn't kept in git,
so a git install doesn't include it. `examples/importmap.html` shows the
page, and needs serving from the repository's root folder by a plain web
server (the demo's server would serve the source instead):

```html
<script type="importmap">
  {
    "imports": {
      "three": "/js/three.module.js",
      "three/addons/": "/js/examples/jsm/",
      "elite-galaxy-map": "/js/galaxy-map.standalone.js"
    }
  }
</script>
```

## Feeding it data

The map doesn't load anything itself. You send it messages with
`galaxyMap.dispatch(message)`. Every message is a plain object with a `type`,
so a loader in a Web Worker can post them and the page passes them straight
through.

Positions are galactic coordinates (as in the journal and Spansh dumps): x, y
and z for each system, one after another, in a `Float32Array`. Send it as a
transferable so it isn't copied between threads.

| `type` | Fields | Does |
| --- | --- | --- |
| `defineLayer` | `layer`, `colour`, `label`, `order`, `visible`, `starSizeInLightYears`, `minimumPixelSize`, `maximumPixelSize`, `minimumBrightness`, `opacity` | Creates a layer, or changes one. A layer is a set of systems drawn alike. Layers are listed by `order`, then in the order defined. Up to 64 at once; they share draw calls, so more layers cost nothing extra. |
| `addSystems` | `layer`, `positions`, `names`, `keys` | Adds systems. `names` is an array, or one string with a newline between names (much cheaper to send). `keys` are anything you want back when a system is picked. |
| `clearLayer` | `layer` | Removes a layer's systems, keeping its appearance. |
| `removeLayer` | `layer` | Removes the layer. |
| `setLayerVisibility` | `layer`, `visible` | |
| `selectSystem` | `system`, `flyTo` | Selects `{ name, coordinates: { x, y, z } }` (for example from a search box), or `null` to clear. |
| `moveCamera` | `target`, `distance`, `view` | Flies to look at `target`. Anything left out stays as it is, so `{ type: 'moveCamera', view: 'topDown' }` turns to look straight down at the same point. |
| `highlightSystems` | `systems`, `asRoute`, `showNames`, `numberStops`, `frame`, `view` | Shows systems with a ring and their name, replacing earlier highlights. See below. |
| `clearHighlights` | | |
| `setLegend` | `entries` | Shows a key to the highlight markers. See [Legend](#legend). |
| `setText` | `text`, `locale` | Replaces the map's own text. See [Text and translations](#text-and-translations). |
| `setGridHeight` | `y` | Moves the grid. Selecting a system also does this. |
| `setGridVisibility` | `visible` | The same as `setUserInterface` with `grid`. |
| `setUserInterface` | any of the settings below | Switches parts of the map's interface on or off. See [User interface](#user-interface). |
| `removeAllLayers` | | Removes every layer of stars. |
| `setBackdrop` | `style`, `showGalaxyImage` | `style` is `volumetric` (the glow on) or `none` (off); `showGalaxyImage` shows or hides the flat galaxy image. Either can be left out. |
| `setExposure` | `exposure` | How bright the map is overall (default 1.2). |
| `loadingProgress` | `loadedBytes`, `totalBytes`, `systemCount` | Shows the progress bar along the bottom. |
| `loadingFinished` | | Hides it. |
| `loadingFailed` | `message` | Shows the error. |

An unknown `type`, a missing layer name, or names that don't match the
positions throw an error saying what's wrong.

### Events

`GalaxyMap` is an `EventTarget`:

| Event | `event.detail` |
| --- | --- |
| `systemhover` | `{ system }`, `null` when the pointer leaves a star |
| `systemselect` | `{ system }`, `null` when cleared |
| `layerschange` | `{ layers }`, the same as `galaxyMap.getLayers()` |
| `backdropchange` | `{ style, showGalaxyImage }`, the same as `galaxyMap.getBackdrop()` |
| `userinterfacechange` | `{ userInterface }`, the same as `galaxyMap.getUserInterface()` |
| `framerender` | How the frame just drawn went, the same as `galaxyMap.getFrameStatistics()` |
| `loadrequest` | `{ url }`, when the panel's Load button is pressed (see [User interface](#user-interface)) |
| `stoprequest` | none, when the panel's Stop or Clear stars button is pressed |
| `textchange` | `{ locale }`, after `setText` |

A `system` from a loaded layer is `{ layer, name, key, coordinates: { x, y, z } }`.
A highlighted system is returned as it was given to `highlightSystems`
(without `layer`). `galaxyMap.getHighlightedSystems()` returns the current
highlights.

### The example loader

`examples/spansh-loader/spansh-loader-worker.js` streams a Spansh dump and
posts the messages above. It:

- reads the body as a stream, so systems appear while it downloads;
- unpacks gzip itself, recognising it by the file's first bytes rather than
  its name or headers (`downloads.spansh.co.uk` serves `.gz` files as they
  are, while other servers have the browser unpack them on the way), so it
  downloads 182 MB instead of 872 MB for the neutron dump;
- stops sending anything once told to stop, or when a new load replaces it;
- splits systems into layers by main star class (`starClasses.js`): one per
  spectral letter, hottest first (O B A F G K M, then the L T Y brown
  dwarfs; giants go with their letter), then T Tauri and Herbig stars,
  Wolf-Rayet, carbon, S and MS type, white dwarfs, neutron stars, black
  holes, and anything else. Each has a colour after its class; the millions
  of common stars are drawn faint when far away, the rare classes brighter;
- sends batches of up to 100,000, but also sends whatever it has every 0.4 s,
  so the first stars and the small layers show up straight away;
- sends the last partial batch at the end, however few systems it holds.

It accepts `{ type: 'startLoading', url, batchSize, includeNames }` and
`{ type: 'stopLoading' }`.

## Options

`new GalaxyMap(element, options)`, all optional:

| Option | Default | |
| --- | --- | --- |
| `backdropStyle` | `'volumetric'` | `'volumetric'` for the galaxy glow, or `'none'` |
| `showGalaxyImage` | `true` | The density map as a flat galaxy picture, faded in when zoomed right out |
| `densityMapUrl` | `assets/galaxy-density.png` (bundled) | Top-down picture of the galaxy the backdrop is made from |
| `densityMapArea` | `GALAXY_DENSITY_MAP_AREA` | The area that picture covers |
| `backdropSettings` | `{}` | `{ volumetric: {...} }`, see `src/backdrop/VolumetricBackdrop.js` |
| `fontUrl` | Rajdhani (bundled) | `.ttf`, `.otf` or `.woff` for labels |
| `gridAppearance` | | Colours and opacities, see `GalacticGrid.js` |
| `regionMapUrl` | `assets/galaxy-regions.json` (bundled) | The region map, for region borders and names and `findRegion`; `null` for none. See [Regions](#regions). |
| `regionAppearance` | | Border and name colours, opacities and the name size, see `RegionOverlay.js` |
| `initialTarget`, `initialDistance` | above the galaxy | Starting view, galactic coordinates |
| `initialView` | `'angled'` | `'angled'`, or `'topDown'` to look straight down with the core direction at the top |
| `highlightedSystems` | `[]` | Systems to highlight from the start, as for `highlightSystems` |
| `highlightsAreRoute` | `false` | Join the starting highlights in order with a line |
| `showHighlightNames` | `true` | `true` names every highlighted system, `'ifRoom'` those whose name fits, `false` none |
| `highlightStopNumbers` | `'shared'` | Stop numbers on a route: `'shared'`, `'all'` or `'none'` (see [Highlighted systems and routes](#highlighted-systems-and-routes)) |
| `frameHighlightedSystems` | `true` | Start with the camera fitting the highlights on screen, instead of at `initialTarget` |
| `framingMinimumDistance` | `1000` | Closest the camera comes when framing, in light years, for example on one system |
| `highlightColour` | `'#ffd27a'` | Rings, names and route lines of highlights |
| `legend` | `[]` | A key to the highlight markers, as for `setLegend`. See [Legend](#legend). |
| `legendCorner` | `'topRight'` | Where the legend sits: `'topRight'`, `'topLeft'`, `'bottomRight'` or `'bottomLeft'` |
| `text` | `{}` | The map's own text, by key. See [Text and translations](#text-and-translations). |
| `locale` | `null` | Language for plurals and numbers, such as `'fr'`; `null` for the browser's |
| `cellSizeInLightYears` | `4000` | Size of the spatial cells stars are grouped into |
| `exposure` | `1.2` | How hard bright areas are compressed |
| `backgroundColour` | `'#03060a'` | Colour of empty space |
| `selectionFlightMilliseconds` | `900` | How long the flight to a selected system takes |
| `selectionViewDistance` | `{ minimum: 40, maximum: 2000 }` | How close the camera ends up to a selected system (it keeps its distance within this range) |
| `pickTolerancePixels` | `8` | How close the pointer must be to a star |
| `highlightPickTolerancePixels` | `14` | How close it must be to a highlighted system (such as a route stop), which wins over other stars |
| `keyboardMovementSpeed` | `0.8` | Fraction of the camera's distance from its target moved per second |
| `maximumPixelRatio` | `2` | Caps rendering resolution on high-DPI screens |
| `maximumStarsPerPixel` | `1` | Level of detail: each cell draws a sample of about this many stars per CSS pixel it covers |
| `starBudget` | `2000000` | At most about this many stars drawn per frame while still |
| `starBudgetWhileMoving` | `1000000` | ...and while the view is moving |
| `pixelRatioWhileMoving` | `1` | Stars and backdrop drawn at this many pixels per CSS pixel while moving; set it to `maximumPixelRatio` to never drop |
| `starDimmingWithHighlights` | `0.5` | Stars and backdrop drawn this bright while systems are highlighted, so routes stand out; `1` to leave them |
| `userInterface` | `{}` | Parts of the interface to switch on or off. See [User interface](#user-interface). |
| `panelDataUrl` | `''` | Address put in the control panel's data box |
| `panelLayerListFolded` | `false` | Start with the panel's layer list folded to its heading (click the heading to open or fold it; `galaxyMap.controlPanel.setLayerListFolded(true)` does the same) |

## Controls

Drag to rotate, right-drag to pan, and scroll to zoom towards the pointer.
Click a star to select it and fly to it.

Arrow keys glide the view level with the galactic plane while held: up and
down move away from and towards you, left and right slide sideways. Speed is
relative to how far out you are zoomed, so it feels the same looking at a
single system or the whole galaxy. The keys only work while the map has
focus (click it, or tab to it), so they still scroll the page and work in
text boxes everywhere else.

Page Up and Page Down move straight up and down, out of the galactic plane
(Shift with the up and down arrows does the same, for keyboards without Page
keys). The grid moves with you, so its coordinate label shows your height.

## User interface

Every part of the map's own interface, including its control panel, can be
switched off: give the `userInterface` option when creating the map, or
send `setUserInterface` later. Settings left out keep their current value.

```js
// A fixed view for embedding: no panel, no moving the camera.
const galaxyMap = new GalaxyMap(element, {
  initialView: 'topDown',
  userInterface: { panel: false, rotate: false, pan: false, zoom: false, keyboardMovement: false },
});

// Later, let people look around again.
galaxyMap.dispatch({ type: 'setUserInterface', rotate: true, pan: true, zoom: true });
```

| Setting | Default | Controls |
| --- | --- | --- |
| `rotate` | on | Dragging to turn the view |
| `pan` | on | Right-dragging to move across the galaxy |
| `zoom` | on | The mouse wheel or pinching |
| `keyboardMovement` | on | Arrow keys, Page Up and Page Down |
| `hover` | on | Ring and name on the star under the pointer |
| `selectByClick` | on | Clicking a star to select it |
| `flyToSelection` | on | Flying to a clicked star (off: selected where it is) |
| `grid` | on | The grid |
| `gridLabel` | on | The grid's coordinate label |
| `loadingOverlay` | on | The progress bar while data loads |
| `legend` | on | The key to the highlight markers, when the page has given one |
| `regions` | off | The borders and names of the galaxy's regions |
| `panel` | on | The whole control panel |
| `layerList` | on | Panel: the layers, with a box to show or hide each |
| `displaySettings` | on | Panel: the Galaxy glow, Galaxy image, Grid and Regions checkboxes |
| `routePicker` | on | Panel: choosing a Spansh route file |
| `selectionDetails` | on | Panel: the selected system's name, coordinates and distance |
| `dataLoading` | off | Panel: a data address with Load, Stop and Clear stars |

Switching off an interaction only stops the person using the map; the page
can still move the camera or select systems with commands. An unknown
setting, or one that isn't `true` or `false`, throws an error naming it.
`galaxyMap.getUserInterface()` returns the current settings, and the map
raises `userinterfacechange` when they change.

The map doesn't load data itself, which is why `dataLoading` is off by
default. With it on, Load raises a `loadrequest` event with `{ url }` and
Stop a `stoprequest` event, for the page's own loader to act on; Clear stars
removes every layer and raises `stoprequest` too. The demo shows this with
the example Spansh loader. The panel can also be folded away to its title,
and `galaxyMap.controlPanel.showRoute(routeResult)` shows a Spansh route as
the file picker does.

### Text and translations

Every piece of text the map shows can be replaced: the control panel, the
loading bar, the legend's label for screen readers, the route stop names the
panel's route picker puts in the legend, and the name shown for a system
without one. Each is an [ICU message](https://formatjs.github.io/docs/core-concepts/icu-syntax/),
the format ember-intl and most translation tools use, formatted with
[intl-messageformat](https://www.npmjs.com/package/intl-messageformat).
Give only the keys you want to change; the rest stay in English.
`DEFAULT_TEXT`, exported by the map, lists every key with its English.

```js
const galaxyMap = new GalaxyMap(element, {
  locale: 'fr',
  text: {
    load: 'Charger',
    routeSummary: '{start} → {end}, {jumpCount, plural, one {# saut} other {# sauts}}',
    tradeRouteSummary: '{start} → {end}, {hopCount, plural, one {# étape} other {# étapes}}',
  },
});

// Later, in another language. Keys left out go back to English.
galaxyMap.dispatch({ type: 'setText', locale: 'de', text: { load: 'Laden' } });
```

With ember-intl, the page's own translations can be passed in, for example
`{ load: this.intl.lookup('galaxy_map.load') }`. `locale` decides plural
forms and how numbers are written; left as `null`, it is the browser's
language. Everything on screen is shown again in the new text after
`setText`, and the map raises `textchange`. An unknown key, a message that
isn't valid ICU or a locale that isn't a language tag throws an error naming
it.

Some text is not the map's own, so it doesn't change: details of an error
(why a dump or route couldn't be read) come from the browser or the route
reader, layer names come from the page's `defineLayer` commands, region
names are the game's, and a page's legend entries are its own.

## Highlighted systems and routes

To open the map looking straight down at some systems, each already named:

```js
const galaxyMap = new GalaxyMap(element, {
  initialView: 'topDown',
  highlightedSystems: [
    { name: 'Sol', coordinates: { x: 0, y: 0, z: 0 } },
    { name: 'Colonia', coordinates: { x: -9530.5, y: -910.28125, z: 19808.125 } },
  ],
});
```

The camera starts framing them all, with the grid at their average height.
Add `highlightsAreRoute: true` and they are joined in order by a line, as a
route, with an arrowhead half way along each leg pointing the way the route
goes. Arrows stay the same size on screen and are left off legs too short on
screen to fit one.

A route may come back to where it has been, or stop more than once in one
star system (two stations, say); pass every stop, in order. Systems at the
same coordinates share one ring, and its name lists each of them. On a route,
such a place numbers its stops, counting the first system as 1, so the order
can be followed where the route crosses itself:

```
3. Cemiess - Meech Dock
5. Cemiess - Titius Station
```

A stop visited twice reads `1, 7. Fuelum - Wollheim Vision`. Stops that give
the star system's name as `system` and a `station` are listed under the
system when it has more than one stop:

```
Cemiess
  3. Meech Dock
  5. Titius Station
```

`numberStops` chooses which stops are numbered, defaulting to the
`highlightStopNumbers` option: `'shared'` (its default) only those at places
with more than one stop in the label, `'all'` every named stop, such as `2. Gongalungul - Andoyer Station`,
which suits short routes such as trade routes, and `'none'` none. The
panel's route picker numbers every stop of a trade route.

Systems count as the same place within 0.1 light years. Clicking the shared
ring picks the first system named on it. The ring takes the shape of the
first system with one, and that system's colour, and a centre dot if any
system there has one. A system with `showName: false` is left out of the
name unless none there is named. On a leg the route also travels the other
way, each arrow moves along towards its own leg's end, so the two don't sit
on top of each other.

Naming is set by `showNames` (or the `showHighlightNames` option), and a
system's own `showName` overrides it:

- `true`: always named; a name moves up or down to find room.
- `'ifRoom'`: named wherever the name fits beside the system without covering
  another name, ring or the grid label. Zooming in makes room for more. This
  suits long routes.
- `false`: not named, though the name still shows on hover.

To change them later:

```js
galaxyMap.dispatch({ type: 'highlightSystems', systems: routeSystems, asRoute: true, frame: true, view: 'topDown' });
```

A system may also carry `key` (returned when it is clicked), `colour`, and
two marks that set kinds of system apart without relying on colour:

- `shape`: the ring's shape, `'circle'` (the default), `'diamond'`,
  `'square'` or `'triangle'` (`MARKER_SHAPE_NAMES`).
- `centreDot`: `true` adds a dot in the middle of the ring.

Highlighted systems can be clicked to select them even when no loaded layer
contains them. The pointer snaps to them: within 14 pixels of one
(`highlightPickTolerancePixels`), it is picked ahead of any other star, even
one nearer the pointer. Names that would overlap step up or down until they
find room, and are hidden if there is none nearby. Systems that always show
their name (a route's start and end) get first choice, then systems marked
out by colour, shape or centre dot, then the rest in list order.

In the demo: `?view=topDown&highlight=Sol,0,0,0&highlight=Lave,75.75,48.75,70.75&route`.

### Legend

A key to the markers can sit in a corner of the map. Each entry draws a
marker as the map draws it (shape, colour and centre dot), with a label and,
if given, a count:

```js
galaxyMap.dispatch({
  type: 'setLegend',
  entries: [
    { label: 'Search result', count: 48 },
    { label: 'Reference system', colour: '#6ea8fe', shape: 'square' },
  ],
});
```

An entry without a `colour` gets the highlight colour, as a highlight does.
An empty list hides the legend. The legend is set separately from the
highlights, so `clearHighlights` leaves it as it is. Set one from the start
with the `legend` option. `legendCorner` chooses where it sits:
`'topRight'` (the default), `'topLeft'`, `'bottomRight'` or `'bottomLeft'`.

### Spansh routes

`routeSystemsFromSpanshResult()`, exported by the library, turns a route
from Spansh's plotters into highlighted systems. The control panel's route
picker uses it, or you can call it yourself:

```js
import { routeStopLegend, routeSystemsFromSpanshResult } from 'elite-galaxy-map';

const routeResult = await (await fetch(routeUrl)).json();
const systems = routeSystemsFromSpanshResult(routeResult);
galaxyMap.dispatch({ type: 'highlightSystems', systems, asRoute: true, showNames: false, frame: true });
galaxyMap.dispatch({ type: 'setLegend', entries: routeStopLegend(systems) });
```

It is tested against the exact plotter's results (`result.jumps`). It also
accepts `result.system_jumps` with `system` names, as the neutron and
tourist plotters use, and a plain list of jumps. The start and end are named;
every other stop shows its name when hovered. Stops are marked so they can
be told apart without relying on colour: the shape shows a neutron boost, and
a centre dot a refuel stop.

A trade route (a list of hops, each with a `source` and `destination`
station) gives the first hop's source and then each hop's destination, named
`System - Station`. Each stop also has `system`, `station`, `systemId64` and
`marketId`, and its `key` is the market id. Its stops are not marked out.

| Stop | Marker | Colour |
|---|---|---|
| Neutron boost | Diamond | Blue |
| Refuel stop | Circle with a centre dot | Green |
| Both | Diamond with a centre dot | Purple |
| Any other | Circle | The highlight colour |

`routeStopMarker(jump)` gives the fields for one jump, for pages that build
their own route systems:
`{ name, coordinates, ...routeStopMarker(jump) }`.

`routeStopLegend(systems)` gives [legend](#legend) entries for the kinds of
stop a route has, with how many of each. It gives an empty list for a route
with only ordinary stops. The panel's route picker shows this legend.
Its labels are in English; pass others, such as translations, by kind of
stop, and any left out keep their English label (`ROUTE_STOP_LABELS`):

```js
routeStopLegend(systems, {
  labels: { neutronBoost: '…', refuel: '…', neutronBoostAndRefuel: '…', other: '…' },
});
```

Unnamed stops are drawn as small rings. When the route is seen from far away
and rings would overlap, only some are drawn: the named ends first, then
neutron and refuel stops, then the rest. More appear as you zoom in. Neutron
and refuel stops have slightly larger rings than ordinary ones, so their shape
and dot stay clear.

In the demo, choose a route file in the panel, or open with
`?routeFile=<url of the route JSON>`. The demo also takes `?disable=` and
`?enable=` with any user interface setting, repeated as needed, for example
`?disable=panel&disable=zoom`.

## Regions

The galaxy's 42 regions (the codex regions, such as Inner Orion Spur) can be
drawn as borders with their names. They're off by default; switch them on
with the panel's Regions box, the `regions` user interface setting, or:

```js
galaxyMap.dispatch({ type: 'setUserInterface', regions: true });
```

Regions are areas on the galactic plane, so the borders are drawn on the
grid's plane and follow it to the selected system's height. They're lines a
few pixels wide at any zoom, rather than coloured areas, so they can be
read without telling colours apart. Names face the camera, bigger regions
first. A name that would cover a system's name, a ring or the grid label is
left out, as is the name of a region too small on screen to hold it, or one
cut off by the edge of the map.

The panel shows the selected system's region. Pages can look it up too:

```js
const region = await galaxyMap.findRegion({ x: 0, y: 0, z: 0 });   // { number: 18, name: 'Inner Orion Spur' }
```

Without a map on the page, `loadGalaxyRegions()` loads the same data:

```js
import { loadGalaxyRegions } from 'elite-galaxy-map';

const regions = await loadGalaxyRegions();
regions.regionAt({ x: -9530.5, y: -910.28, z: 19808.13 }).name;   // 'Inner Scutum-Centaurus Arm'
```

This gives the region at a system's coordinates, as the game shows when
jumping there. The journal and codex use the region at the corner of the
system's boxel instead, which differs for a few systems right by a border.

The region map is loaded the first time it's needed (about 37 KB
compressed). It comes from klightspeed's
[EliteDangerousRegionMap](https://github.com/klightspeed/EliteDangerousRegionMap)
(MIT licence), mapped from the game's galaxy map onto the game's own grid of
4096 / 83 ly (about 49.35 ly) cells. `scripts/build-region-map.mjs` turns
its `RegionMapData.json` into `assets/galaxy-regions.json`, working out
where each name goes:

```sh
node scripts/build-region-map.mjs --input_file RegionMapData.json --output_file assets/galaxy-regions.json
```

## Grid

The grid has 10, 100, 1,000 and 10,000 ly squares on one plane, and
the plane moves to the height of the selected system. Instead of switching
whole grids on and off at fixed zoom levels, each grid fades out pixel by
pixel as its lines get closer together on screen, so the fine grids fade
smoothly when zooming out and towards the horizon. Lines through Sol are
picked out in orange.

The grid corner nearest the point the camera orbits around is labelled with
its coordinates, laid flat on the grid and turned to face the camera. The
label uses the finest grid with room for the text.

## Backdrop

The galaxy is decorated even before any stars load. The backdrop has two
parts, each shown or hidden on its own, both made from one density map, a
top-down picture where brighter means more stars:

- **Galaxy glow** (`backdropStyle: 'volumetric'`, the default): each pixel on
  screen marches a ray through a box the size of the galaxy, adding up light
  from the density map with a soft falloff above and below the plane
  (thicker where denser, so the core bulges). It has no graininess, looks
  right edge-on, and costs per pixel.
- **Galaxy image** (`showGalaxyImage`): the density map laid flat on the
  plane, fading in as you zoom out.

The bundled density map, `assets/galaxy-density.png`, was built from Spansh's
full systems dump (`systems.json.gz`) with:

```sh
node scripts/build-density-map.mjs --input_file systems.json.gz --output_file assets/galaxy-density.png --median_radius 8 --blur_radius 3 --image_size 2048
```

It estimates density from id64s (see below), so it shows the galaxy's arms
rather than where players have travelled.

To build one from other data:

```sh
node scripts/build-density-map.mjs --input_file systems_neutron.json.gz --output_file neutron-density.png
```

```js
new GalaxyMap(element, { densityMapUrl: '/neutron-density.png' });
```

### Estimating density from id64s

Counting systems shows where people have been as much as where systems
are, so the script estimates the real density instead (`--method id64`, the
default). Each system's id64
names its boxel (a cube of space sized by the system's mass code) and its
index among that boxel's systems, so the boxel holds at least index + 1
systems. One visited system tells you roughly how full its whole boxel is,
and visiting an area again and again adds nothing, so busy routes don't
show and the galaxy's arms come out clearly.

```sh
node scripts/build-density-map.mjs --input_file galaxy.json.gz --output_file galaxy-density.png --image_size 1024 --median_radius 4 --blur_radius 2
```

Only mass codes d to h are used by default (`--mass_code`, once per letter).
The 10 to 40 ly boxels of codes a to c are visited too rarely to cover the
galaxy. For each pixel the estimates of the boxels anyone has visited are
averaged, so it only matters that some boxels nearby were visited, not how
many. Each line's id64 is read as text, since id64s can be larger than a
JavaScript number holds exactly; the JSON itself isn't parsed, which makes
this method quicker per line than counting.

`--method count` counts the systems in the dump above each pixel instead.
Heavily travelled routes then show up as sharp bright lines, because those
systems are far more thoroughly explored than their surroundings;
`--median_radius` and `--blur_radius` soften them:

```sh
node scripts/build-density-map.mjs --input_file galaxy.json.gz --output_file galaxy-density.png --method count --median_radius 3 --blur_radius 1
```

### Image size

`--image_size` sets the width and height in pixels, covering 104,000 ly
either way:

| Size | ly per pixel | Median / blur | Notes |
| --- | --- | --- | --- |
| 512 | 203 | 2 / 1 | Visibly blocky in the galaxy image; fine for the glow alone. |
| 1024 | 102 | 4 / 2 | Recommended. Matches the galaxy's size on screen when zoomed out on most displays. |
| 2048 | 51 | 8 / 3 | Sharper arm edges once zoomed in, but finer than the data: with `--method id64` the 80 ly boxels of mass code d leave many pixels empty, which shows as grain. Worth it for the full galaxy dump. The median filter takes about 35 s. |

Larger than 2048 adds nothing the data can fill. A 4096 texture also uses
about 90 MB of graphics memory, and some phones can't load one at all. Scale
`--median_radius` and `--blur_radius` with the size, as in the table, since
both are measured in pixels.

While it reads, the script shows how far through the file it is, how many
systems it has read and roughly how long is left, on standard error. On a
terminal that is one line updating in place; in a log it is a line every 10
seconds.

`--median_radius` replaces each pixel with the middle value of the square
around it, which removes lines narrower than about that many pixels while
keeping the edges of arms and the core. `--blur_radius` then softens what is
left. Both are in pixels, so scale them with `--image_size`.

A map built from a dump shows where systems are *known*, so it carries player
exploration patterns: the bubble, popular routes. A map from the full galaxy
dump will look more like the galaxy than one from a single star type.

## Performance

The map is built to stay smooth with tens of millions of stars:

- **Level of detail.** From far away many stars share each pixel, so each
  region of space draws an even sample of its stars, about one per pixel it
  covers (`maximumStarsPerPixel`), up to a total (`starBudget`). The sample
  is brightened to keep the same overall light, and changes in it fade
  rather than pop. Close up, every star is drawn. The rarest star types in
  each region are always drawn in full, so they don't vanish into a sample.
- **While moving.** Stars and the backdrop are drawn at lower resolution and
  with fewer stars (`pixelRatioWhileMoving`, `starBudgetWhileMoving`). Full
  quality returns as soon as the view stops. The grid, text and markers stay
  at full resolution throughout.
- **Loading.** Stars can be added in batches while the rest is still
  arriving, so they appear as they load; how the data is fetched is up to
  the caller (the example loader reads a dump in a Web Worker). New stars
  dissolve in rather than flicker.
- **Drawing.** Stars are grouped into 4,000 ly regions, one draw each, so
  regions off screen cost nothing, and any number of layers share the same
  draws. Nothing is drawn while nothing changes.
- **Picking.** Finding the star under the pointer only looks near the
  pointer, so it stays quick however many stars are loaded.
- **Brightness.** Light is added up in a high-range buffer and bright areas
  are compressed, so the dense core keeps its shape instead of turning
  white.

`galaxyMap.getFrameStatistics()` and the `framerender` event report what each
frame drew; the demo's Stats button shows them. `bench/layer-bench.mjs <dump>`
times adding stars and picking in Node.

## Development

```sh
pnpm install
pnpm run demo        # the demo on http://localhost:5173/; ?autoload starts loading
pnpm test
pnpm run lint        # pnpm run lint --fix fixes what it can
pnpm run typecheck
pnpm run build       # dist/galaxy-map.standalone.js
pnpm run build:demo  # dist-demo/, the demo as plain files
```

On GitHub, `.github/workflows/checks.yml` runs the lint, the tests, the type
check and both builds for every push and pull request, on Node.js 24 and 26.

The type declarations in `types/` are written by hand. A test fails if the
code gains an export, option, user interface setting or command they don't
list, and `pnpm run typecheck` compiles `test/types/usage.ts` against them,
including mistakes that must be caught. Update both when the API changes.

### The demo

`pnpm run demo` (`scripts/serve-demo.mjs`) works like `ember serve`: Vite
builds the demo into `dist-demo/`, rebuilds it within a second or so of any
change, and the page reloads itself. It's served by a small static file
server that only serves the files in `dist-demo/` and `examples/public/`
(no dotfiles): it lists them, and a request can only fetch a path on that
list. Vite's own development server isn't used at all, since it serves files
from the machine on request and scanners on the internet attack it; running
`vite` on its own just says so.

`pnpm run build:demo` writes the same demo without the reloading: plain
files to put behind any web server, for a public demo.

Demo parameters: `?data=<url>`, `?autoload`, `?view=topDown`,
`?backdrop=none`, `?densityMap=<url>`, `?routeFile=<url>`, `?foldLayers`,
repeatable `?highlight=Name,x,y,z` with `?route`, and repeatable
`?disable=<setting>` and `?enable=<setting>` (for example `?enable=regions`).

### Loading dumps in the demo

The demo loads `https://downloads.spansh.co.uk/systems_neutron.json.gz` by
default: Spansh's download server allows any page to read its dumps. For
other dumps, give their address with `?data=` or in the data box.

To work offline, or try your own files, put them in `examples/public/`,
which the demo serves from its root, and load them by path:

```sh
curl -o examples/public/systems_neutron.json.gz https://downloads.spansh.co.uk/systems_neutron.json.gz
```

Then open `http://localhost:5173/?data=/systems_neutron.json.gz&autoload`.
The same goes for density maps (`?densityMap=/your-map.png`) and route files
(`?routeFile=/your-route.json`). Files added while the demo runs are found
straight away. (`*.json.gz` files are in `.gitignore`.)

`examples/importmap.html` uses the standalone build without a bundler. It
loads files from `node_modules/` and `dist/`, so after `pnpm run build`,
open it through any static file server started in the repository folder
and listening on localhost only.

### Choosing the port

The demo uses port 5173. Set `DEMO_PORT` for another:

```sh
DEMO_PORT=8080 pnpm run demo
```

### Reaching the demo from another machine

The demo listens on this machine only. Keep it that way, or reach it over
an SSH tunnel or VPN. Development servers aren't built to face the
internet, and scanners look for them constantly: within an hour of being
published, a Vite development server running an earlier version of this
demo had files read off its machine through a hole in Vite, despite Vite's
own restrictions.

To reach it from outside a container, listen on every interface inside the
container, and publish the port on the host's loopback address only:

```sh
# Inside the container
DEMO_HOST=0.0.0.0 pnpm run demo
# Starting the container: 127.0.0.1 keeps the port off the network
docker run -p 127.0.0.1:5173:5173 ...
# From your own machine
ssh -L 5173:localhost:5173 your-server
```

Docker's `-p 5173:5173` without an address publishes the port on every
interface, and its firewall rules go around ufw's, so a port published that
way is open to the internet even when ufw would block it.

### Opening the demo by another host name

The demo answers to `localhost` and plain IP addresses only, against DNS
rebinding. To open it by another host name, list the names in
`DEMO_ALLOWED_HOSTS`, separated by commas; a leading dot allows every name
under a domain:

```sh
DEMO_ALLOWED_HOSTS=dev.example.com,.example.org pnpm run demo
```

With Docker, pass it into the container with
`-e DEMO_ALLOWED_HOSTS=dev.example.com`.

### What the demo logs

The demo logs the requests it refuses: a host name it doesn't answer to, a
method other than GET or HEAD, or a path it doesn't serve (apart from
`/favicon.ico`, which browsers ask for on their own). In normal use there
are none, so a run of them, such as `/@fs/…` or `/.env`, means something
is probing the server. Each line gives the time, remote address, method,
Host header, path and status; what the visitor sent is written as JSON
strings, so it can't add lines of its own. Inside a container the remote
address is usually the container network's gateway rather than the visitor.
Set `DEMO_LOG=all` to log every request.

## Licence

MIT, see [LICENSE](LICENSE). Third-party material (the Rajdhani font, the
region map, and the libraries bundled into the standalone build) is listed,
with its licences, in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Credits

- Created by Spansh. Much of the code and documentation was written with the
  help of [Claude](https://www.anthropic.com/claude), an AI assistant made by
  [Anthropic](https://www.anthropic.com), working under Spansh's direction.
- Drawn with [three.js](https://threejs.org), with text by
  [troika-three-text](https://github.com/protectwise/troika).
- Labels use the Rajdhani font by Indian Type Foundry.
- The region map is from Ben Peddell (klightspeed)'s
  [EliteDangerousRegionMap](https://github.com/klightspeed/EliteDangerousRegionMap),
  built on the Frontier forum's work mapping the regions' edges.
- Star data from [Spansh](https://spansh.co.uk)'s galaxy dumps, from the
  journal data uploaded by Elite Dangerous players.
- Elite Dangerous is a game by Frontier Developments. This project isn't
  affiliated with or endorsed by Frontier.
