import { routeStopLegend, routeSystemsFromSpanshResult } from './spanshRoute.js';

// The map's control panel, in its top left corner. Apart from the map's
// text (see mapText.js), it only uses the map's public commands, methods
// and events, so anything it does a page can do too. Each section can be switched off through the map's user interface
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

export class ControlPanel {
  constructor(galaxyMap, containerElement, { dataUrl = '', layerListFolded = false } = {}) {
    this.galaxyMap = galaxyMap;
    // Elements whose text or attribute shows one of the map's texts as it
    // is, filled in again when the text changes.
    this.fixedTexts = [];
    // What the route and selection sections show, kept so they can be
    // shown again in new text.
    this.routeMessage = { key: 'noRouteLoaded' };
    this.selectedSystem = null;
    // The route the panel last showed, and the legend it set for it.
    this.shownRoute = null;
    addStylesOnce();
    this.element = buildElement('div', { className: 'egm-panel' });

    this.foldButton = buildElement('button', { type: 'button', className: 'egm-panel-fold' }, '–');
    this.foldButton.addEventListener('click', () => this.setFolded(!this.element.classList.contains('egm-folded')));
    this.element.append(buildElement('h1', { className: 'egm-panel-title' }, this.fixedText('panelTitle'), this.foldButton));

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
    this.handleTextChange = () => this.applyText();
    galaxyMap.addEventListener('userinterfacechange', this.handleUserInterfaceChange);
    galaxyMap.addEventListener('layerschange', this.handleLayersChange);
    galaxyMap.addEventListener('systemselect', this.handleSelectionChange);
    galaxyMap.addEventListener('backdropchange', this.handleBackdropChange);
    galaxyMap.addEventListener('textchange', this.handleTextChange);
    this.applyUserInterface(galaxyMap.getUserInterface());
    this.setFolded(false);
    this.setLayerListFolded(layerListFolded);
    this.applyText();
  }

  get mapText() {
    return this.galaxyMap.mapText;
  }

  // A span showing one of the map's texts, or with `attribute`, sets that
  // attribute of `element` to it.
  fixedText(key, { element = buildElement('span'), attribute } = {}) {
    this.fixedTexts.push({ element, key, attribute });
    return element;
  }

  applyText() {
    for (const { element, key, attribute } of this.fixedTexts) {
      if (attribute === undefined) {
        element.textContent = this.mapText.format(key);
      } else {
        element.setAttribute(attribute, this.mapText.format(key));
      }
    }
    this.setFolded(this.element.classList.contains('egm-folded'));
    this.setLayerListFolded(this.layerList.hidden);
    this.showLayers(this.galaxyMap.getLayers());
    this.showRouteText(this.routeMessage);
    this.showSelectedSystem(this.selectedSystem);
    // Only a legend the panel set is redone; a page's own is left alone.
    const legendIsStillTheRoutes = this.shownRoute !== null
      && JSON.stringify(this.galaxyMap.legend.getEntries()) === JSON.stringify(this.shownRoute.legendEntries);
    if (legendIsStillTheRoutes) {
      this.showRouteLegend(this.shownRoute.systems);
    }
  }

  setFolded(isFolded) {
    this.element.classList.toggle('egm-folded', isFolded);
    this.foldButton.textContent = isFolded ? '+' : '–';
    this.foldButton.title = this.mapText.format(isFolded ? 'openPanel' : 'foldPanel');
  }

  applyUserInterface(userInterface) {
    this.element.hidden = !userInterface.panel;
    for (const [settingName, section] of Object.entries(this.sections)) {
      section.hidden = !userInterface[settingName];
    }
    this.gridCheckbox.checked = userInterface.grid;
    this.regionsCheckbox.checked = userInterface.regions;
  }

  createDataLoadingSection(dataUrl) {
    const urlInput = this.fixedText('dumpAddress', { element: buildElement('input', { type: 'text', value: dataUrl }), attribute: 'aria-label' });
    const loadButton = buildElement('button', { type: 'button' }, this.fixedText('load'));
    const stopButton = buildElement('button', { type: 'button' }, this.fixedText('stop'));
    const clearButton = buildElement('button', { type: 'button' }, this.fixedText('clearStars'));
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
      buildElement('h2', {}, this.fixedText('dataHeading')),
      urlInput,
      buildElement('div', { className: 'egm-panel-buttons' }, loadButton, stopButton, clearButton));
  }

  // The layer list can be long (one layer per star class), so its heading
  // folds it away, leaving a one line summary.
  createLayerListSection() {
    this.layerList = buildElement('div');
    this.layerListArrow = buildElement('span', { 'aria-hidden': 'true' }, '▾');
    this.layerListSummary = buildElement('span', { className: 'egm-panel-section-summary' });
    this.layerListToggle = buildElement('button', { type: 'button', className: 'egm-panel-section-toggle' },
      this.layerListArrow, this.fixedText('layersHeading'), this.layerListSummary);
    this.layerListToggle.addEventListener('click', () => this.setLayerListFolded(!this.layerList.hidden));
    return buildElement('div', { className: 'egm-panel-section' }, buildElement('h2', {}, this.layerListToggle), this.layerList);
  }

  setLayerListFolded(isFolded) {
    this.layerList.hidden = isFolded;
    this.layerListArrow.textContent = isFolded ? '▸' : '▾';
    this.layerListToggle.setAttribute('aria-expanded', String(!isFolded));
    this.layerListToggle.title = this.mapText.format(isFolded ? 'showLayers' : 'foldLayers');
  }

  showLayers(layers) {
    // Shown beside the heading, so a folded list still says what's loaded.
    const visibleCount = layers.filter(layer => layer.visible).length;
    const starCount = layers.reduce((total, layer) => total + layer.systemCount, 0);
    this.layerListSummary.textContent = layers.length === 0
      ? ''
      : this.mapText.format('layersSummary', { visibleCount, layerCount: layers.length, starCount });
    if (layers.length === 0) {
      this.layerList.replaceChildren(buildElement('div', { className: 'egm-panel-note' }, this.mapText.format('noStarsLoaded')));
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
        buildElement('span', { className: 'egm-panel-count' }, this.mapText.formatNumber(layer.systemCount)));
    }));
  }

  createRoutePickerSection() {
    const fileInput = buildElement('input', { type: 'file', accept: '.json,application/json' });
    this.routeDetails = buildElement('div', { className: 'egm-panel-note' });
    const clearButton = buildElement('button', { type: 'button' }, this.fixedText('clearRoute'));
    fileInput.addEventListener('change', async () => {
      const routeFile = fileInput.files[0];
      if (routeFile === undefined) {
        return;
      }
      try {
        this.showRoute(JSON.parse(await routeFile.text()));
      } catch (error) {
        this.showRouteText({ key: 'routeFileUnreadable', values: { fileName: routeFile.name, message: error.message } });
      }
    });
    clearButton.addEventListener('click', () => {
      this.galaxyMap.dispatch({ type: 'clearHighlights' });
      this.galaxyMap.dispatch({ type: 'setLegend', entries: [] });
      this.shownRoute = null;
      this.showRouteText({ key: 'noRouteLoaded' });
      fileInput.value = '';
    });
    return buildElement('div', { className: 'egm-panel-section' },
      buildElement('h2', {}, this.fixedText('routeHeading')),
      buildElement('label', {}, this.fixedText('routeFile'), fileInput),
      this.routeDetails,
      buildElement('div', { className: 'egm-panel-buttons' }, clearButton));
  }

  // routeMessage: { key, values } for one of the map's texts, or { message }
  // for text a page gave.
  showRouteText(routeMessage) {
    this.routeMessage = routeMessage;
    this.routeDetails.textContent = routeMessage.key === undefined
      ? routeMessage.message
      : this.mapText.format(routeMessage.key, routeMessage.values);
  }

  // Shows a route from one of Spansh's plotters, as a parsed JSON result.
  // Pages can call this too, for example with a route fetched from a URL.
  showRoute(routeResult) {
    let systems;
    try {
      systems = routeSystemsFromSpanshResult(routeResult);
    } catch (error) {
      this.showRouteText({ key: 'routeUnreadable', values: { message: error.message } });
      return;
    }
    if (systems.length === 0) {
      this.showRouteText({ key: 'routeEmpty' });
      return;
    }
    // Trade routes go station to station, each hop perhaps several jumps,
    // and are short enough to number every stop.
    const isTradeRoute = systems.some(system => system.marketId !== undefined);
    const numberStops = isTradeRoute ? 'all' : 'shared';
    this.galaxyMap.dispatch({ type: 'highlightSystems', systems, asRoute: true, showNames: 'ifRoom', numberStops, frame: true });
    this.showRouteLegend(systems);
    const ends = { start: systems[0].name, end: systems[systems.length - 1].name };
    this.showRouteText(isTradeRoute
      ? { key: 'tradeRouteSummary', values: { ...ends, hopCount: systems.length - 1 } }
      : { key: 'routeSummary', values: { ...ends, jumpCount: systems.length - 1 } });
  }

  // The map's legend explains the stops' markers.
  showRouteLegend(systems) {
    const labels = {
      neutronBoost: this.mapText.format('neutronBoostStop'),
      refuel: this.mapText.format('refuelStop'),
      neutronBoostAndRefuel: this.mapText.format('neutronBoostAndRefuelStop'),
      other: this.mapText.format('otherStop'),
    };
    const legendEntries = routeStopLegend(systems, { labels });
    this.galaxyMap.dispatch({ type: 'setLegend', entries: legendEntries });
    this.shownRoute = { systems, legendEntries };
  }

  // Shows a message in the route section, such as why a route couldn't load.
  showRouteMessage(message) {
    this.showRouteText({ message });
  }

  createDisplaySettingsSection() {
    this.glowCheckbox = buildElement('input', { type: 'checkbox' });
    this.galaxyImageCheckbox = buildElement('input', { type: 'checkbox' });
    this.gridCheckbox = buildElement('input', { type: 'checkbox', checked: true });
    this.regionsCheckbox = buildElement('input', { type: 'checkbox' });
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
    this.regionsCheckbox.addEventListener('change', () => {
      this.galaxyMap.dispatch({ type: 'setUserInterface', regions: this.regionsCheckbox.checked });
    });
    const settings = [
      buildElement('label', {}, this.glowCheckbox, this.fixedText('galaxyGlow')),
      buildElement('label', {}, this.galaxyImageCheckbox, this.fixedText('galaxyImage')),
      buildElement('label', {}, this.gridCheckbox, this.fixedText('grid')),
    ];
    // Only offered when the map has a region map to draw.
    if (this.galaxyMap.options.regionMapUrl !== null) {
      settings.push(buildElement('label', {}, this.regionsCheckbox, this.fixedText('regions')));
    }
    return buildElement('div', { className: 'egm-panel-section' }, buildElement('h2', {}, this.fixedText('displayHeading')), ...settings);
  }

  // Keeps the boxes in step with the backdrop, however it was changed.
  showBackdrop({ style, showGalaxyImage }) {
    this.glowCheckbox.checked = style === 'volumetric';
    this.galaxyImageCheckbox.checked = showGalaxyImage;
  }

  createSelectionDetailsSection() {
    this.selectionDetails = buildElement('div', { className: 'egm-panel-note' });
    return buildElement('div', { className: 'egm-panel-section' }, buildElement('h2', {}, this.fixedText('selectedSystemHeading')), this.selectionDetails);
  }

  showSelectedSystem(system) {
    this.selectedSystem = system;
    if (system === null) {
      this.selectionDetails.textContent = this.mapText.format('selectPrompt');
      return;
    }
    const { x, y, z } = system.coordinates;
    const distanceFromSol = Math.round(Math.hypot(x, y, z));
    const regionLine = document.createTextNode('');
    this.selectionDetails.replaceChildren(
      buildElement('strong', {}, system.name ?? this.mapText.format('unnamedSystem')),
      `\n${this.mapText.format('selectedSystemCoordinates', { x, y, z })}`,
      `\n${this.mapText.format('distanceFromSol', { distance: distanceFromSol })}`,
      regionLine,
    );
    // The region needs the region map, which may still be loading. By
    // then another system may be selected, whose details have their own
    // line; this one is no longer on the page and nothing shows.
    this.galaxyMap.findRegion(system.coordinates).then(region => {
      if (region !== null) {
        regionLine.textContent = `\n${region.name}`;
      }
    });
  }

  dispose() {
    this.galaxyMap.removeEventListener('userinterfacechange', this.handleUserInterfaceChange);
    this.galaxyMap.removeEventListener('layerschange', this.handleLayersChange);
    this.galaxyMap.removeEventListener('systemselect', this.handleSelectionChange);
    this.galaxyMap.removeEventListener('backdropchange', this.handleBackdropChange);
    this.galaxyMap.removeEventListener('textchange', this.handleTextChange);
    this.element.remove();
  }
}
