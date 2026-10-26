import Stats from 'three/addons/libs/stats.module.js';
import { GalaxyMap } from '../src/index.js';

// Spansh's download server lets any page read its dumps. A copy put in
// examples/public/ loads from /systems_neutron.json.gz instead (?data=).
const DEFAULT_DUMP_URL = 'https://downloads.spansh.co.uk/systems_neutron.json.gz';
const pageParameters = new URLSearchParams(location.search);

// The demo turns on the panel's data loading section, which the map leaves
// off by default. ?disable=name and ?enable=name (repeatable) switch other
// parts of the interface, for example ?disable=rotate&disable=panel.
const userInterface = { dataLoading: true };
for (const settingName of pageParameters.getAll('disable')) {
    userInterface[settingName] = false;
}
for (const settingName of pageParameters.getAll('enable')) {
    userInterface[settingName] = true;
}

// ?backdrop=none turns the glow off; ?densityMap=/your-map.png tries a density map
// built with scripts/build-density-map.mjs and put in examples/public/.
const mapOptions = {
    backdropStyle: pageParameters.get('backdrop') ?? 'volumetric',
    userInterface,
    panelDataUrl: pageParameters.get('data') ?? DEFAULT_DUMP_URL,
};
// ?foldLayers starts with the layer list folded.
if (pageParameters.has('foldLayers')) {
    mapOptions.panelLayerListFolded = true;
}
if (pageParameters.has('densityMap')) {
    mapOptions.densityMapUrl = pageParameters.get('densityMap');
}
// ?view=topDown opens looking straight down.
if (pageParameters.has('view')) {
    mapOptions.initialView = pageParameters.get('view');
}
// Each ?highlight=Name,x,y,z adds a highlighted system, in order; ?route
// joins them with a line. The coordinates are the last three values, so
// names containing commas still work.
const highlightedSystems = pageParameters.getAll('highlight').map(highlightText => {
    const parts = highlightText.split(',');
    const [x, y, z] = parts.slice(-3).map(Number);
    return { name: parts.slice(0, -3).join(','), coordinates: { x, y, z } };
});
if (highlightedSystems.length > 0) {
    mapOptions.highlightedSystems = highlightedSystems;
    mapOptions.highlightsAreRoute = pageParameters.has('route');
}
const galaxyMap = new GalaxyMap(document.getElementById('galaxy-map'), mapOptions);
// Handy for poking at the map from the browser console.
window.galaxyMap = galaxyMap;

// The map doesn't load data itself; the panel's Load and Stop buttons ask
// the page to, and the page runs the example Spansh loader in a worker.
let loader = null;
function stopLoading() {
    loader?.terminate();
    loader = null;
    galaxyMap.dispatch({ type: 'loadingFinished' });
}
function startLoading(url) {
    stopLoading();
    galaxyMap.dispatch({ type: 'removeAllLayers' });
    loader = new Worker(new URL('./spansh-loader/spansh-loader-worker.js', import.meta.url), { type: 'module' });
    loader.addEventListener('message', event => galaxyMap.dispatch(event.data));
    loader.postMessage({ type: 'startLoading', url });
}
galaxyMap.addEventListener('loadrequest', event => startLoading(event.detail.url));
galaxyMap.addEventListener('stoprequest', stopLoading);

// ?routeFile=<url> shows a Spansh route, as the panel's file picker does.
if (pageParameters.has('routeFile')) {
    const routeUrl = pageParameters.get('routeFile');
    fetch(routeUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then(routeResult => galaxyMap.controlPanel.showRoute(routeResult))
        .catch(error => galaxyMap.controlPanel.showRouteMessage(`Could not load ${routeUrl}: ${error.message}`));
}

// A frame rate meter. It counts the frames the map actually draws, so it
// reads zero when nothing moves (the map draws nothing then) and shows the
// real rate while you rotate or pan.
let stats = null;
document.getElementById('stats-button').addEventListener('click', () => {
    if (stats !== null) {
        return;
    }
    stats = new Stats();
    Object.assign(stats.dom.style, { left: 'auto', right: '0' });
    document.body.appendChild(stats.dom);
    // How many stars the level of detail is drawing, out of how many loaded.
    const starCount = document.createElement('div');
    Object.assign(starCount.style, {
        position: 'fixed', right: '0', top: '48px', padding: '2px 6px', background: 'rgba(0, 0, 0, 0.7)',
        color: '#7cc4ff', font: '11px system-ui, sans-serif', pointerEvents: 'none',
    });
    document.body.appendChild(starCount);
    const millions = count => `${(count / 1e6).toFixed(2)}M`;
    galaxyMap.addEventListener('framerender', event => {
        stats.update();
        const frame = event.detail;
        starCount.textContent = `${millions(frame.starsDrawn)} of ${millions(frame.starsLoaded)} stars, `
            + `${frame.drawCalls} draws, ${frame.cpuMilliseconds.toFixed(1)} ms${frame.isMoving ? ', moving' : ''}`;
    });
});

if (pageParameters.has('autoload')) {
    startLoading(galaxyMap.options.panelDataUrl);
}

// Under `pnpm run demo`, reload when a change has been built (see
// scripts/serve-demo.mjs). A built demo served by a web server has no such
// connection, so this is left out of it.
if (import.meta.env?.MODE === 'demo-watch') {
    const rebuildEvents = new EventSource('/__demo-reload');
    rebuildEvents.addEventListener('rebuilt', () => location.reload());
    rebuildEvents.addEventListener('buildfailed', event => console.error('The demo failed to build:', JSON.parse(event.data)));
}
