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
| `elite-galaxy-map/spansh-route.js` | `routeSystemsFromSpanshResult`, `routeStopMarker` and `ROUTE_STOP_COLOURS` (also exported by the map). |

The source finds its font and density map with
`new URL('../assets/...', import.meta.url)`, which bundlers follow and copy
into the build. Nothing needs building for bundlers, so the package also
works installed straight from its git repository.

`three` is a peer dependency (0.170 or later).

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
| `highlightSystems` | `systems`, `asRoute`, `showNames`, `frame`, `view` | Shows systems with a ring and their name, replacing earlier highlights. See below. |
| `clearHighlights` | | |
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
| `initialTarget`, `initialDistance` | above the galaxy | Starting view, galactic coordinates |
| `initialView` | `'angled'` | `'angled'`, or `'topDown'` to look straight down with the core direction at the top |
| `highlightedSystems` | `[]` | Systems to highlight from the start, as for `highlightSystems` |
| `highlightsAreRoute` | `false` | Join the starting highlights in order with a line |
| `showHighlightNames` | `true` | `true` names every highlighted system, `'ifRoom'` those whose name fits, `false` none |
| `frameHighlightedSystems` | `true` | Start with the camera fitting the highlights on screen, instead of at `initialTarget` |
| `framingMinimumDistance` | `1000` | Closest the camera comes when framing, in light years, for example on one system |
| `highlightColour` | `'#ffd27a'` | Rings, names and route lines of highlights |
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
| `panel` | on | The whole control panel |
| `layerList` | on | Panel: the layers, with a box to show or hide each |
| `displaySettings` | on | Panel: the Galaxy glow, Galaxy image and Grid checkboxes |
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

### Spansh routes

`routeSystemsFromSpanshResult()`, exported by the library, turns a route
from Spansh's plotters into highlighted systems. The control panel's route
picker uses it, or you can call it yourself:

```js
import { routeSystemsFromSpanshResult } from 'elite-galaxy-map';

const routeResult = await (await fetch(routeUrl)).json();
galaxyMap.dispatch({
    type: 'highlightSystems',
    systems: routeSystemsFromSpanshResult(routeResult),
    asRoute: true,
    showNames: false,
    frame: true,
});
```

It is tested against the exact plotter's results (`result.jumps`). It also
accepts `result.system_jumps` with `system` names, as the neutron and
tourist plotters use, and a plain list of jumps. The start and end are named;
every other stop shows its name when hovered. Stops are marked so they can
be told apart without relying on colour: the shape shows a neutron boost, and
a centre dot a refuel stop.

| Stop | Marker | Colour |
|---|---|---|
| Neutron boost | Diamond | Blue |
| Refuel stop | Circle with a centre dot | Green |
| Both | Diamond with a centre dot | Purple |
| Any other | Circle | The highlight colour |

`routeStopMarker(jump)` gives the fields for one jump, for pages that build
their own route systems:
`{ name, coordinates, ...routeStopMarker(jump) }`.

Unnamed stops are drawn as small rings. When the route is seen from far away
and rings would overlap, only some are drawn: the named ends first, then
neutron and refuel stops, then the rest. Neutron and refuel stops have
slightly larger rings than ordinary ones, so their shape and dot stay clear. More appear as you zoom in.

In the demo, choose a route file in the panel, or open with
`?routeFile=<url of the route JSON>`. The demo also takes `?disable=` and
`?enable=` with any user interface setting, repeated as needed, for example
`?disable=panel&disable=zoom`.

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
pnpm run demo     # examples/ on http://localhost:5173/; ?autoload starts loading
pnpm test
pnpm run lint     # pnpm run lint --fix fixes what it can
pnpm run build
```

On GitHub, `.github/workflows/checks.yml` runs the lint, the tests and the
build for every push and pull request, on Node.js 24 and 26.

Demo parameters: `?data=<url>`, `?autoload`, `?view=topDown`,
`?backdrop=none`, `?densityMap=<url>`,
`?routeFile=<url>`, `?foldLayers`, repeatable `?highlight=Name,x,y,z` with `?route`, and
repeatable `?disable=<setting>` and `?enable=<setting>`. Files in
`examples/public/` are served from the root of the demo, so a density map
you've built can be tried there with `?densityMap=/your-map.png`.

### Loading dumps in the demo

The demo can't load dumps straight from `downloads.spansh.co.uk`: that
server doesn't send CORS headers allowing the demo's address (localhost, or
your development host) to read its files, so the browser blocks the request
and loading fails. Download the dump into `examples/public/` and load it from
the demo's own server instead; the demo's data box suggests
`/systems_neutron.json.gz`, so that one works as it is:

```sh
curl -o examples/public/systems_neutron.json.gz https://downloads.spansh.co.uk/systems_neutron.json.gz
```

Then press Load, or open `http://localhost:5173/?autoload`. For another dump,
download it the same way and give its path with `?data=/its-name.json.gz` or
in the data box. (`*.json.gz` files are in `.gitignore`.) The same applies
to route files given with `?routeFile=`.

### Choosing the port

The demo uses Vite's usual port, 5173. Set `DEMO_PORT` for another; the
demo then fails to start, rather than moving to a different port, if that
one is taken:

```sh
DEMO_PORT=8080 pnpm run demo
```

### Opening the demo by another host name

The demo answers to `localhost` and plain IP addresses only. To open it by
another host name (for example from outside a container), list the names in
`DEMO_ALLOWED_HOSTS`, separated by commas; a leading dot allows every name
under a domain:

```sh
DEMO_ALLOWED_HOSTS=dev.example.com,.example.org pnpm run demo
```

With Docker, pass it into the container with
`-e DEMO_ALLOWED_HOSTS=dev.example.com`.

## Licence

MIT, see [LICENSE](LICENSE). Third-party material (the Rajdhani font, and the
libraries bundled into the standalone build) is listed, with its licences, in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Credits

- Created by Spansh. Much of the code and documentation was written with the
  help of [Claude](https://www.anthropic.com/claude), an AI assistant made by
  [Anthropic](https://www.anthropic.com), working under Spansh's direction.
- Drawn with [three.js](https://threejs.org), with text by
  [troika-three-text](https://github.com/protectwise/troika).
- Labels use the Rajdhani font by Indian Type Foundry.
- Star data from [Spansh](https://spansh.co.uk)'s galaxy dumps, from the
  journal data uploaded by Elite Dangerous players.
- Elite Dangerous is a game by Frontier Developments. This project isn't
  affiliated with or endorsed by Frontier.
