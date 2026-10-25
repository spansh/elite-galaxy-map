import { CENTRE_DOT_RADIUS, markerOutlineCorners } from './markerShapes.js';
import { routeStopMarker, routeSystemsFromSpanshResult } from './spanshRoute.js';

// The map's control panel, in its top left corner. It only uses the map's
// public commands, methods and events, so anything it does a page can do
// too. Each section can be switched off through the map's user interface
// settings (see userInterface.js), and the panel folds away to its title.
//
// The data loading section doesn't load anything itself: Load raises a
// `loadrequest` event on the map with { url }, and Stop a `stoprequest`
// event, for the page's own loader. Clear stars removes every layer and
// raises `stoprequest` as well.

const STYLE_ELEMENT_ID = 'elite-galaxy-map-panel-styles';
const PANEL_STYLES = `
    .egm-panel {
        position: absolute;
        top: 12px;
        left: 12px;
        width: min(300px, calc(100% - 24px));
        max-height: calc(100% - 24px);
        overflow: auto;
        box-sizing: border-box;
        padding: 10px 12px;
        background: rgba(8, 14, 20, 0.85);
        border: 1px solid #22323a;
        border-radius: 6px;
        color: #c9dbe6;
        font: 13px/1.4 system-ui, sans-serif;
        z-index: 1;
    }
    .egm-panel[hidden], .egm-panel-section[hidden] {
        display: none;
    }
    .egm-panel-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 0;
        font-size: 14px;
        font-weight: 600;
    }
    .egm-panel-fold {
        padding: 0 6px;
        font-size: 14px;
        line-height: 1.4;
    }
    .egm-panel.egm-folded .egm-panel-section {
        display: none;
    }
    .egm-panel h2 {
        margin: 12px 0 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #7d97a6;
    }
    /* Two classes, so it wins over the general .egm-panel button style. */
    .egm-panel .egm-panel-section-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        padding: 0;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
        text-align: left;
        cursor: pointer;
    }
    .egm-panel .egm-panel-section-toggle:hover {
        color: #c9dbe6;
        border: none;
    }
    .egm-panel-section-summary {
        margin-left: auto;
        letter-spacing: normal;
        text-transform: none;
        font-weight: normal;
    }
    .egm-panel label {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 3px 0;
    }
    .egm-panel input[type="text"] {
        width: 100%;
        box-sizing: border-box;
        padding: 4px 6px;
        background: #0b141b;
        color: inherit;
        border: 1px solid #22323a;
        border-radius: 4px;
    }
    .egm-panel button {
        padding: 4px 10px;
        background: #13212a;
        color: inherit;
        border: 1px solid #22323a;
        border-radius: 4px;
        cursor: pointer;
    }
    .egm-panel button:hover {
        border-color: #ff9a2e;
    }
    .egm-panel-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
    }
    .egm-panel-swatch {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 50%;
    }
    .egm-panel-count {
        margin-left: auto;
        color: #7d97a6;
        font-variant-numeric: tabular-nums;
    }
    .egm-panel-note {
        color: #7d97a6;
        white-space: pre-line;
    }
    .egm-panel-note strong {
        color: #ff9a2e;
    }
    .egm-panel-key {
        display: inline-block;
        width: 12px;
        height: 12px;
        margin: 0 4px 0 8px;
        vertical-align: -1px;
    }
`;

function addStylesOnce() {
    if (document.getElementById(STYLE_ELEMENT_ID) !== null) {
        return;
    }
    const styleElement = document.createElement('style');
    styleElement.id = STYLE_ELEMENT_ID;
    styleElement.textContent = PANEL_STYLES;
    document.head.appendChild(styleElement);
}

// Builds an element with properties and children:
//     buildElement('button', { type: 'button' }, 'Load')
function buildElement(tagName, properties = {}, ...children) {
    const created = document.createElement(tagName);
    for (const [propertyName, value] of Object.entries(properties)) {
        if (propertyName === 'className') {
            created.className = value;
        } else if (propertyName in created) {
            created[propertyName] = value;
        } else {
            created.setAttribute(propertyName, value);
        }
    }
    created.append(...children);
    return created;
}

// A small picture of a highlight marker, drawn as the map draws it: its
// shape, colour and any centre dot. For the route legend.
function buildMarkerSymbol({ colour, shape = 'circle', centreDot = false }) {
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const symbol = document.createElementNS(svgNamespace, 'svg');
    symbol.setAttribute('class', 'egm-panel-key');
    symbol.setAttribute('viewBox', '-8 -8 16 16');
    symbol.setAttribute('aria-hidden', 'true');
    const markerRadius = 6;
    // SVG's y points down, the map's up.
    const corners = markerOutlineCorners(shape, markerRadius)
        .map(corner => `${corner.x.toFixed(2)},${(-corner.y).toFixed(2)}`)
        .join(' ');
    const outline = document.createElementNS(svgNamespace, 'polygon');
    outline.setAttribute('points', corners);
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', colour);
    outline.setAttribute('stroke-width', '1.6');
    symbol.append(outline);
    if (centreDot) {
        const dot = document.createElementNS(svgNamespace, 'circle');
        dot.setAttribute('r', String(CENTRE_DOT_RADIUS * markerRadius));
        dot.setAttribute('fill', colour);
        symbol.append(dot);
    }
    return symbol;
}

export class ControlPanel {
    constructor(galaxyMap, containerElement, { dataUrl = '', layerListFolded = false } = {}) {
        this.galaxyMap = galaxyMap;
        addStylesOnce();
        this.element = buildElement('div', { className: 'egm-panel' });

        this.foldButton = buildElement('button', { type: 'button', className: 'egm-panel-fold', title: 'Fold the panel away' }, '–');
        this.foldButton.addEventListener('click', () => this.setFolded(!this.element.classList.contains('egm-folded')));
        this.element.append(buildElement('h1', { className: 'egm-panel-title' }, 'Galaxy map', this.foldButton));

        this.sections = {
            dataLoading: this.createDataLoadingSection(dataUrl),
            layerList: this.createLayerListSection(),
            routePicker: this.createRoutePickerSection(),
            displaySettings: this.createDisplaySettingsSection(),
            selectionDetails: this.createSelectionDetailsSection(),
        };
        this.element.append(...Object.values(this.sections));
        containerElement.appendChild(this.element);

        this.handleUserInterfaceChange = event => this.applyUserInterface(event.detail.userInterface);
        this.handleLayersChange = event => this.showLayers(event.detail.layers);
        this.handleSelectionChange = event => this.showSelectedSystem(event.detail.system);
        this.handleBackdropChange = event => this.showBackdrop(event.detail);
        galaxyMap.addEventListener('userinterfacechange', this.handleUserInterfaceChange);
        galaxyMap.addEventListener('layerschange', this.handleLayersChange);
        galaxyMap.addEventListener('systemselect', this.handleSelectionChange);
        galaxyMap.addEventListener('backdropchange', this.handleBackdropChange);
        this.applyUserInterface(galaxyMap.getUserInterface());
        this.showLayers(galaxyMap.getLayers());
        this.setLayerListFolded(layerListFolded);
    }

    setFolded(isFolded) {
        this.element.classList.toggle('egm-folded', isFolded);
        this.foldButton.textContent = isFolded ? '+' : '–';
        this.foldButton.title = isFolded ? 'Open the panel' : 'Fold the panel away';
    }

    applyUserInterface(userInterface) {
        this.element.hidden = !userInterface.panel;
        for (const [settingName, section] of Object.entries(this.sections)) {
            section.hidden = !userInterface[settingName];
        }
        this.gridCheckbox.checked = userInterface.grid;
    }

    createDataLoadingSection(dataUrl) {
        const urlInput = buildElement('input', { type: 'text', value: dataUrl, 'aria-label': 'Address of a systems dump' });
        const loadButton = buildElement('button', { type: 'button' }, 'Load');
        const stopButton = buildElement('button', { type: 'button' }, 'Stop');
        const clearButton = buildElement('button', { type: 'button' }, 'Clear stars');
        loadButton.addEventListener('click', () => {
            this.galaxyMap.dispatchEvent(new CustomEvent('loadrequest', { detail: { url: urlInput.value.trim() } }));
        });
        stopButton.addEventListener('click', () => {
            this.galaxyMap.dispatchEvent(new CustomEvent('stoprequest'));
        });
        clearButton.addEventListener('click', () => {
            this.galaxyMap.dispatchEvent(new CustomEvent('stoprequest'));
            this.galaxyMap.dispatch({ type: 'removeAllLayers' });
            this.galaxyMap.dispatch({ type: 'loadingFinished' });
        });
        return buildElement('div', { className: 'egm-panel-section' },
            buildElement('h2', {}, 'Data'),
            urlInput,
            buildElement('div', { className: 'egm-panel-buttons' }, loadButton, stopButton, clearButton));
    }

    // The layer list can be long (one layer per star class), so its heading
    // folds it away, leaving a one line summary.
    createLayerListSection() {
        this.layerList = buildElement('div', {}, buildElement('div', { className: 'egm-panel-note' }, 'No stars loaded.'));
        this.layerListArrow = buildElement('span', { 'aria-hidden': 'true' }, '▾');
        this.layerListSummary = buildElement('span', { className: 'egm-panel-section-summary' });
        this.layerListToggle = buildElement('button', { type: 'button', className: 'egm-panel-section-toggle' },
            this.layerListArrow, 'Layers', this.layerListSummary);
        this.layerListToggle.addEventListener('click', () => this.setLayerListFolded(!this.layerList.hidden));
        return buildElement('div', { className: 'egm-panel-section' }, buildElement('h2', {}, this.layerListToggle), this.layerList);
    }

    setLayerListFolded(isFolded) {
        this.layerList.hidden = isFolded;
        this.layerListArrow.textContent = isFolded ? '▸' : '▾';
        this.layerListToggle.setAttribute('aria-expanded', String(!isFolded));
        this.layerListToggle.title = isFolded ? 'Show the layers' : 'Fold the layers away';
    }

    showLayers(layers) {
        // Shown beside the heading, so a folded list still says what's loaded.
        const visibleCount = layers.filter(layer => layer.visible).length;
        const systemCount = layers.reduce((total, layer) => total + layer.systemCount, 0);
        this.layerListSummary.textContent = layers.length === 0
            ? ''
            : `${visibleCount} of ${layers.length} shown, ${systemCount.toLocaleString()} stars`;
        if (layers.length === 0) {
            this.layerList.replaceChildren(buildElement('div', { className: 'egm-panel-note' }, 'No stars loaded.'));
            return;
        }
        this.layerList.replaceChildren(...layers.map(layer => {
            const checkbox = buildElement('input', { type: 'checkbox', checked: layer.visible });
            checkbox.addEventListener('change', () => {
                this.galaxyMap.dispatch({ type: 'setLayerVisibility', layer: layer.layer, visible: checkbox.checked });
            });
            const swatch = buildElement('span', { className: 'egm-panel-swatch' });
            swatch.style.background = layer.colour;
            return buildElement('label', {},
                checkbox, swatch, layer.label,
                buildElement('span', { className: 'egm-panel-count' }, layer.systemCount.toLocaleString()));
        }));
    }

    createRoutePickerSection() {
        const fileInput = buildElement('input', { type: 'file', accept: '.json,application/json' });
        this.routeDetails = buildElement('div', { className: 'egm-panel-note' }, 'No route loaded.');
        const clearButton = buildElement('button', { type: 'button' }, 'Clear route');
        fileInput.addEventListener('change', async () => {
            const routeFile = fileInput.files[0];
            if (routeFile === undefined) {
                return;
            }
            try {
                this.showRoute(JSON.parse(await routeFile.text()));
            } catch (error) {
                this.routeDetails.textContent = `Could not read ${routeFile.name}: ${error.message}`;
            }
        });
        clearButton.addEventListener('click', () => {
            this.galaxyMap.dispatch({ type: 'clearHighlights' });
            this.routeDetails.textContent = 'No route loaded.';
            fileInput.value = '';
        });
        return buildElement('div', { className: 'egm-panel-section' },
            buildElement('h2', {}, 'Route'),
            buildElement('label', {}, 'Spansh route file', fileInput),
            this.routeDetails,
            buildElement('div', { className: 'egm-panel-buttons' }, clearButton));
    }

    // Shows a route from one of Spansh's plotters, as a parsed JSON result.
    // Pages can call this too, for example with a route fetched from a URL.
    showRoute(routeResult) {
        let systems;
        try {
            systems = routeSystemsFromSpanshResult(routeResult);
        } catch (error) {
            this.routeDetails.textContent = `Could not read the route: ${error.message}`;
            return;
        }
        if (systems.length === 0) {
            this.routeDetails.textContent = 'That route has no systems in it.';
            return;
        }
        this.galaxyMap.dispatch({ type: 'highlightSystems', systems, asRoute: true, showNames: 'ifRoom', frame: true });
        // A legend line for each kind of stop the route has, with its marker
        // drawn as the map draws it.
        const stopKinds = [
            { marker: routeStopMarker({ has_neutron: true }), description: 'neutron boosts' },
            { marker: routeStopMarker({ must_refuel: true }), description: 'refuel stops' },
            { marker: routeStopMarker({ has_neutron: true, must_refuel: true }), description: 'neutron boosts with refuel' },
        ];
        const legendLines = [];
        for (const { marker, description } of stopKinds) {
            const stopCount = systems.filter(system => system.shape === marker.shape && system.centreDot === marker.centreDot).length;
            if (stopCount > 0) {
                legendLines.push(buildElement('br'), buildMarkerSymbol(marker), `${stopCount.toLocaleString()} ${description}`);
            }
        }
        this.routeDetails.replaceChildren(
            `${systems[0].name} to ${systems[systems.length - 1].name}, ${(systems.length - 1).toLocaleString()} jumps.`,
            ...legendLines,
        );
    }

    // Shows a message in the route section, such as why a route couldn't load.
    showRouteMessage(message) {
        this.routeDetails.textContent = message;
    }

    createDisplaySettingsSection() {
        this.glowCheckbox = buildElement('input', { type: 'checkbox' });
        this.galaxyImageCheckbox = buildElement('input', { type: 'checkbox' });
        this.gridCheckbox = buildElement('input', { type: 'checkbox', checked: true });
        this.showBackdrop(this.galaxyMap.getBackdrop());
        // Each box changes only its own part, so neither undoes a change the
        // page made to the other with setBackdrop.
        this.glowCheckbox.addEventListener('change', () => {
            this.galaxyMap.dispatch({ type: 'setBackdrop', style: this.glowCheckbox.checked ? 'volumetric' : 'none' });
        });
        this.galaxyImageCheckbox.addEventListener('change', () => {
            this.galaxyMap.dispatch({ type: 'setBackdrop', showGalaxyImage: this.galaxyImageCheckbox.checked });
        });
        this.gridCheckbox.addEventListener('change', () => {
            this.galaxyMap.dispatch({ type: 'setUserInterface', grid: this.gridCheckbox.checked });
        });
        return buildElement('div', { className: 'egm-panel-section' },
            buildElement('h2', {}, 'Display'),
            buildElement('label', {}, this.glowCheckbox, 'Galaxy glow'),
            buildElement('label', {}, this.galaxyImageCheckbox, 'Galaxy image'),
            buildElement('label', {}, this.gridCheckbox, 'Grid'));
    }

    // Keeps the boxes in step with the backdrop, however it was changed.
    showBackdrop({ style, showGalaxyImage }) {
        this.glowCheckbox.checked = style === 'volumetric';
        this.galaxyImageCheckbox.checked = showGalaxyImage;
    }

    createSelectionDetailsSection() {
        this.selectionDetails = buildElement('div', { className: 'egm-panel-note' }, 'Click a star to select it.');
        return buildElement('div', { className: 'egm-panel-section' }, buildElement('h2', {}, 'Selected system'), this.selectionDetails);
    }

    showSelectedSystem(system) {
        if (system === null) {
            this.selectionDetails.textContent = 'Click a star to select it.';
            return;
        }
        const { x, y, z } = system.coordinates;
        const distanceFromSol = Math.hypot(x, y, z);
        this.selectionDetails.replaceChildren(
            buildElement('strong', {}, system.name ?? '(unnamed)'),
            `\n${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`,
            `\n${distanceFromSol.toLocaleString(undefined, { maximumFractionDigits: 0 })} ly from Sol`,
        );
    }

    dispose() {
        this.galaxyMap.removeEventListener('userinterfacechange', this.handleUserInterfaceChange);
        this.galaxyMap.removeEventListener('layerschange', this.handleLayersChange);
        this.galaxyMap.removeEventListener('systemselect', this.handleSelectionChange);
        this.galaxyMap.removeEventListener('backdropchange', this.handleBackdropChange);
        this.element.remove();
    }
}
