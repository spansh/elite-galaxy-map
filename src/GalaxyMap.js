import { Color, Frustum, MathUtils, Matrix4, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { StarField } from './StarField.js';
import { STILL_DELAY_MILLISECONDS, cameraMovedVisibly, chooseRenderQuality } from './renderQuality.js';
import { GalacticGrid } from './GalacticGrid.js';
import { SystemMarkers, isSameSystem } from './SystemMarkers.js';
import { GalaxyBackdrop } from './backdrop/GalaxyBackdrop.js';
import { GALAXY_DENSITY_MAP_AREA } from './backdrop/densityMap.js';
import { COMMAND_TYPES, validateCommand } from './commands.js';
import { galacticToScene } from './coordinates.js';
import { LoadingOverlay } from './LoadingOverlay.js';
import { LEGEND_CORNERS, Legend } from './Legend.js';
import { ToneMappingPass } from './ToneMappingPass.js';
import { MOVEMENT_KEYS, calculateKeyboardMovement, movementKeyName } from './keyboardMovement.js';
import { directionTowardsCamera, frameSystems } from './cameraFraming.js';
import { DEFAULT_USER_INTERFACE, validateUserInterfaceSettings } from './userInterface.js';
import { ControlPanel } from './ControlPanel.js';
import { chooseStarsToDraw, fadeForSample } from './levelOfDetail.js';

const DEFAULT_FONT_URL = new URL('../assets/rajdhani-latin-600-normal.woff', import.meta.url).href;
const DEFAULT_DENSITY_MAP_URL = new URL('../assets/galaxy-density.png', import.meta.url).href;

export const DEFAULT_OPTIONS = Object.freeze({
    cellSizeInLightYears: 4000,
    backdropStyle: 'volumetric',
    showGalaxyImage: true,
    densityMapUrl: DEFAULT_DENSITY_MAP_URL,
    densityMapArea: GALAXY_DENSITY_MAP_AREA,
    backdropSettings: {},
    fontUrl: DEFAULT_FONT_URL,
    gridAppearance: {},
    // Parts of the map's own interface to switch off (or on), such as
    // { rotate: false, panel: false }; see userInterface.js for the list.
    userInterface: {},
    // Address shown in the control panel's data loading section.
    panelDataUrl: '',
    // Start with the panel's layer list folded away to its heading.
    panelLayerListFolded: false,
    initialTarget: { x: 0, y: 0, z: 25000 },
    initialDistance: 95000,
    // 'angled' (above and south of the target, looking down at an angle) or
    // 'topDown' (straight down, with the core direction at the top).
    initialView: 'angled',
    // Systems to show with a ring and their name from the start, as
    // [{ name, coordinates: { x, y, z }, key?, colour? }].
    highlightedSystems: [],
    // Start with the camera framing the highlighted systems, if there are any,
    // instead of at initialTarget and initialDistance.
    frameHighlightedSystems: true,
    // Closest the camera comes when framing, in light years: framing a
    // single system (or a tight group) stops here, far enough back to show
    // its surroundings.
    framingMinimumDistance: 1000,
    // Join the highlighted systems in order with a line, as a route.
    highlightsAreRoute: false,
    // Naming of highlighted systems: true names every one (moving labels to
    // make room), 'ifRoom' names those whose label fits beside them, false
    // names none. A system's own showName overrides this, for example to
    // always name the start and end of a long route.
    showHighlightNames: true,
    highlightColour: '#ffd27a',
    // A key to the highlight markers, as [{ label, colour?, shape?,
    // centreDot?, count? }] (see the setLegend command), and which corner
    // of the map it sits in: 'topRight', 'topLeft', 'bottomRight' or
    // 'bottomLeft'.
    legend: [],
    legendCorner: 'topRight',
    backgroundColour: '#03060a',
    // How hard bright areas are compressed. Higher is brighter overall.
    exposure: 1.2,
    maximumPixelRatio: 2,
    pickTolerancePixels: 8,
    // Highlighted systems, such as route stops, are picked from further away
    // than other stars, and ahead of them, so the pointer snaps to them.
    highlightPickTolerancePixels: 14,
    selectionFlightMilliseconds: 900,
    selectionViewDistance: { minimum: 40, maximum: 2000 },
    // Fraction of the camera's distance from its target moved per second by
    // the arrow keys.
    keyboardMovementSpeed: 0.8,

    // Level of detail: from far away, many stars share each pixel, so each
    // cell draws a random sample of its stars (made brighter to match) of
    // about this many stars per CSS pixel it covers on screen...
    maximumStarsPerPixel: 1,
    // ...and never more than this many stars in all, while still and while
    // the view is moving.
    starBudget: 2000000,
    starBudgetWhileMoving: 1000000,
    // While the view moves, stars and backdrop are drawn with this many
    // pixels per CSS pixel (1 halves each way on a Retina screen), then at
    // full quality once it stops. Set it to maximumPixelRatio to never drop.
    pixelRatioWhileMoving: 1,
    // While systems are highlighted (such as a route), stars and backdrop are
    // drawn at this much of their usual brightness, so the highlights stand
    // out against a crowded star field. 1 leaves them as they are.
    starDimmingWithHighlights: 0.5,
});

// Distance the pointer can move between press and release and still count
// as a click rather than a drag.
const CLICK_MOVEMENT_TOLERANCE_PIXELS = 4;

// Runs work when the browser is idle. Where requestIdleCallback is missing
// (Safari), it runs soon after instead, with about 8 ms to use: the time
// left is counted down from when it starts, so long work still yields.
function whenIdle(work) {
    if (globalThis.requestIdleCallback !== undefined) {
        globalThis.requestIdleCallback(work);
        return;
    }
    setTimeout(() => {
        const startTime = performance.now();
        work({ timeRemaining: () => Math.max(8 - (performance.now() - startTime), 0) });
    }, 50);
}

function easeInOutCubic(progress) {
    return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

// Draws the galaxy into a page element. Data is fed in with dispatch(),
// using the typed messages in commands.js. The map emits these events:
//
//   systemhover   detail: { system }   system is null when nothing is hovered
//   systemselect  detail: { system }   system is null when the selection is cleared
//   layerschange  detail: { layers }   layers as returned by getLayers()
//   userinterfacechange  detail: { userInterface }   as getUserInterface()
//   backdropchange  detail: { style, showGalaxyImage }   as getBackdrop()
//   framerender   detail: as getFrameStatistics(), after each frame drawn
//   loadrequest   detail: { url }      Load pressed in the control panel
//   stoprequest                        Stop or Clear stars pressed in the panel
//
// where a system is { layer, name, key, coordinates: { x, y, z } }.
export class GalaxyMap extends EventTarget {
    constructor(containerElement, options = {}) {
        super();
        if (!(containerElement instanceof HTMLElement)) {
            throw new TypeError('GalaxyMap needs the HTML element to draw into');
        }
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.containerElement = containerElement;
        this.starField = new StarField({ cellSize: this.options.cellSizeInLightYears });
        this.hoveredSystem = null;
        this.selectedSystem = null;
        this.renderIsScheduled = false;
        this.hoverCheckIsNeeded = false;
        this.cameraFlight = null;
        this.pointerPosition = null;
        this.pointerPressPosition = null;
        this.heldMovementKeys = new Set();
        this.previousFrameTime = null;
        // When the camera last moved visibly, and the camera as of the last
        // frame, for choosing the drawing quality (see renderQuality.js).
        this.timeOfLastMovement = undefined;
        this.previousCameraState = undefined;
        this.fullQualityRenderTimer = undefined;
        // The pointer may be over something else once the view has moved.
        this.hoverIsStaleFromMovement = false;
        // Work done in idle time (see prepareCellsWhenIdle).
        this.idleWorkIsScheduled = false;
        this.idleWorkRecheckTimer = undefined;
        this.layerChangeIsPending = false;
        this.frameStatistics = { starsLoaded: 0, starsDrawn: 0, cellsOnScreen: 0, crossFadesInProgress: 0 };
        this.isDisposed = false;
        validateUserInterfaceSettings(this.options.userInterface, 'The userInterface option');
        this.userInterface = { ...DEFAULT_USER_INTERFACE, ...this.options.userInterface };

        this.createRenderer();
        this.createCameraAndControls();
        this.createSceneContents();
        this.attachPointerHandlers();
        this.attachKeyboardHandlers();
        this.controlPanel = new ControlPanel(this, containerElement, {
            dataUrl: this.options.panelDataUrl,
            layerListFolded: this.options.panelLayerListFolded,
        });
        if (!LEGEND_CORNERS.includes(this.options.legendCorner)) {
            throw new Error(`The legendCorner option must be ${LEGEND_CORNERS.join(', ')}, not ${JSON.stringify(this.options.legendCorner)}`);
        }
        validateCommand({ type: COMMAND_TYPES.setLegend, entries: this.options.legend });
        this.legend = new Legend(containerElement, { corner: this.options.legendCorner, defaultColour: this.options.highlightColour });
        this.legend.setEntries(this.options.legend);
        this.setUserInterface({});

        this.resizeObserver = new ResizeObserver(() => this.resizeToContainer());
        this.resizeObserver.observe(containerElement);
        this.watchPixelDensity();
        this.resizeToContainer();

        // Framing needs the map's final shape, so it comes after sizing.
        if (this.options.highlightedSystems.length > 0) {
            this.highlightSystems(this.options.highlightedSystems, {
                frame: this.options.frameHighlightedSystems,
                view: this.options.initialView,
                asRoute: this.options.highlightsAreRoute,
                showNames: this.options.showHighlightNames,
                animate: false,
            });
        }
    }

    createRenderer() {
        const containerStyle = getComputedStyle(this.containerElement);
        if (containerStyle.position === 'static') {
            this.containerElement.style.position = 'relative';
        }
        this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        this.renderer.setClearColor(new Color(this.options.backgroundColour));
        this.toneMappingPass = new ToneMappingPass({ backgroundColour: this.options.backgroundColour, exposure: this.options.exposure });
        const canvas = this.renderer.domElement;
        // Laid over the container rather than inside its flow, so the
        // canvas's own size never props the container up: one without a
        // height of its own then really has none, and gets the 16:10 shape.
        canvas.style.display = 'block';
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.touchAction = 'none';
        this.containerElement.appendChild(canvas);
        this.loadingOverlay = new LoadingOverlay(this.containerElement);
    }

    createCameraAndControls() {
        this.camera = new PerspectiveCamera(60, 1, 0.5, 2000000);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.12;
        this.controls.zoomToCursor = true;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 250000;
        this.controls.zoomSpeed = 1.4;
        this.controls.screenSpacePanning = false;
        this.controls.addEventListener('change', () => this.requestRender());

        const initialTarget = galacticToScene(this.options.initialTarget);
        this.controls.target.copy(initialTarget);
        const directionToCamera = directionTowardsCamera(this.options.initialView);
        this.camera.position.copy(initialTarget).addScaledVector(directionToCamera, this.options.initialDistance);
        this.controls.update();
    }

    createSceneContents() {
        // Stars and backdrop add up light and go through the tone mapping,
        // at reduced resolution while moving. The grid, text and markers are
        // drawn on top afterwards, always at full resolution.
        this.lightScene = new Scene();
        this.overlayScene = new Scene();
        const requestRenderWhenReady = () => this.requestRender();

        this.backdrop = new GalaxyBackdrop({
            densityMapUrl: this.options.densityMapUrl,
            densityMapArea: this.options.densityMapArea,
            style: this.options.backdropStyle,
            showGalaxyImage: this.options.showGalaxyImage,
            volumetricSettings: this.options.backdropSettings.volumetric,
            onReady: requestRenderWhenReady,
        });
        this.backdrop.loadingPromise.catch(error => console.error('Galaxy backdrop failed to load:', error));
        this.lightScene.add(this.backdrop.sceneObject);

        this.grid = new GalacticGrid({ fontUrl: this.options.fontUrl, appearance: this.options.gridAppearance, exposure: this.options.exposure });
        this.overlayScene.add(this.grid.planeSceneObject);
        this.lightScene.add(this.starField.sceneObject);
        this.overlayScene.add(this.grid.labelSceneObject);

        this.markers = new SystemMarkers({ fontUrl: this.options.fontUrl, highlightColour: this.options.highlightColour });
        this.overlayScene.add(this.markers.sceneObject);

        this.raycaster = new Raycaster();
    }

    attachPointerHandlers() {
        const canvas = this.renderer.domElement;
        this.handlePointerDown = event => {
            // Clicking the map gives it keyboard focus for the arrow keys.
            // preventScroll stops the page jumping to bring it into view.
            canvas.focus({ preventScroll: true });
            // Only the first finger of a touch counts towards a click, so
            // lifting one finger of a pinch doesn't select a star.
            if (event.button === 0 && event.isPrimary) {
                this.pointerPressPosition = { x: event.clientX, y: event.clientY };
            }
        };
        this.handlePointerMove = event => {
            this.pointerPosition = { x: event.clientX, y: event.clientY };
            // Skip hover checks while dragging the view around.
            if (event.buttons === 0 && this.userInterface.hover) {
                this.hoverCheckIsNeeded = true;
                this.requestRender();
            }
        };
        this.handlePointerUp = event => {
            if (!event.isPrimary) {
                return;
            }
            const pressPosition = this.pointerPressPosition;
            this.pointerPressPosition = null;
            if (event.button !== 0 || pressPosition === null || !this.userInterface.selectByClick) {
                return;
            }
            const movement = Math.hypot(event.clientX - pressPosition.x, event.clientY - pressPosition.y);
            if (movement > CLICK_MOVEMENT_TOLERANCE_PIXELS) {
                return;
            }
            const clickedSystem = this.findSystemAtClientPosition(event.clientX, event.clientY);
            if (clickedSystem !== null) {
                this.selectSystem(clickedSystem, { flyTo: this.userInterface.flyToSelection });
            }
        };
        this.handlePointerLeave = () => {
            this.pointerPosition = null;
            this.setHoveredSystem(null);
        };
        canvas.addEventListener('pointerdown', this.handlePointerDown);
        canvas.addEventListener('pointermove', this.handlePointerMove);
        canvas.addEventListener('pointerup', this.handlePointerUp);
        canvas.addEventListener('pointerleave', this.handlePointerLeave);
    }

    attachKeyboardHandlers() {
        const canvas = this.renderer.domElement;
        // Keys are only taken while the map has focus, so arrow keys still
        // scroll the page and work in form fields everywhere else.
        canvas.tabIndex = 0;
        canvas.style.outline = 'none';
        this.handleKeyDown = event => {
            const keyName = movementKeyName(event.key, event.shiftKey);
            if (!this.userInterface.keyboardMovement || MOVEMENT_KEYS[keyName] === undefined || event.altKey || event.ctrlKey || event.metaKey) {
                return;
            }
            event.preventDefault();
            // Taking control stops any flight to a selected system.
            this.cameraFlight = null;
            // A key is held under one name at a time: pressing Shift while
            // an arrow is held (its key repeat then comes with Shift) turns
            // forward into vertical movement rather than adding to it.
            this.heldMovementKeys.delete(movementKeyName(event.key, !event.shiftKey));
            this.heldMovementKeys.add(keyName);
            this.requestRender();
        };
        this.handleKeyUp = event => {
            if (event.key === 'Shift') {
                // Releasing Shift while an arrow is still held turns vertical
                // movement back into forward movement at once.
                for (const keyName of [...this.heldMovementKeys]) {
                    if (keyName.startsWith('Shift+')) {
                        this.heldMovementKeys.delete(keyName);
                        this.heldMovementKeys.add(keyName.slice('Shift+'.length));
                    }
                }
                return;
            }
            // Shift may have been pressed or released while the arrow was
            // held, so let go of the key under both of its names.
            this.heldMovementKeys.delete(movementKeyName(event.key, false));
            this.heldMovementKeys.delete(movementKeyName(event.key, true));
        };
        // A key released while focus is elsewhere never sends keyup here, so
        // forget all held keys when focus leaves rather than drift forever.
        this.handleFocusLost = () => {
            this.heldMovementKeys.clear();
        };
        canvas.addEventListener('keydown', this.handleKeyDown);
        canvas.addEventListener('keyup', this.handleKeyUp);
        canvas.addEventListener('blur', this.handleFocusLost);
    }

    // Moves the camera and its orbit target together. Returns true while
    // movement keys are held, so the next frame is drawn too.
    advanceKeyboardMovement(elapsedSeconds) {
        if (this.heldMovementKeys.size === 0) {
            return false;
        }
        const movement = calculateKeyboardMovement({
            heldKeys: this.heldMovementKeys,
            cameraQuaternion: this.camera.quaternion,
            cameraDistance: this.camera.position.distanceTo(this.controls.target),
            speedPerSecond: this.options.keyboardMovementSpeed,
            elapsedSeconds,
        });
        this.camera.position.add(movement);
        this.controls.target.add(movement);
        // Moving up or down takes the grid along, as in the game's galaxy
        // map, so the grid label shows the height you are at.
        if (movement.y !== 0) {
            this.grid.setGalacticHeight(Math.round(this.controls.target.y));
        }
        return true;
    }

    // Moving the window to a screen with a different pixel density (a laptop
    // screen to an external one, say) changes devicePixelRatio without
    // resizing the container, so it is watched separately. A media query
    // matches only the current density, so it is set up again each time.
    watchPixelDensity() {
        if (typeof window.matchMedia !== 'function') {
            return;
        }
        this.pixelDensityQuery?.removeEventListener('change', this.handlePixelDensityChange);
        this.pixelDensityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        this.handlePixelDensityChange = () => {
            this.watchPixelDensity();
            this.resizeToContainer();
        };
        this.pixelDensityQuery.addEventListener('change', this.handlePixelDensityChange);
    }

    resizeToContainer() {
        // A hidden container (display: none, an inactive tab) has no size at
        // all. Wait until it is shown, when the resize observer calls again,
        // rather than size the map, or the container, to nothing.
        if (this.containerElement.clientWidth === 0) {
            return;
        }
        const width = this.containerElement.clientWidth;
        // A container with no height of its own would collapse to nothing;
        // fall back to a 16:10 shape instead.
        const height = this.containerElement.clientHeight > 0 ? this.containerElement.clientHeight : Math.round(width * 0.625);
        if (this.containerElement.clientHeight === 0) {
            this.containerElement.style.height = `${height}px`;
        }
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.options.maximumPixelRatio));
        this.renderer.setSize(width, height, false);
        const drawingBufferSize = this.renderer.getDrawingBufferSize(new Vector2());
        this.toneMappingPass.setSize(drawingBufferSize.x, drawingBufferSize.y);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.cssWidth = width;
        this.cssHeight = height;
        const tangentOfHalfFieldOfView = Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
        this.cssPixelsPerLightYearAtUnitDistance = height / (2 * tangentOfHalfFieldOfView);
        this.devicePixelsPerLightYearAtUnitDistance = this.cssPixelsPerLightYearAtUnitDistance * this.renderer.getPixelRatio();
        this.starField.setPixelsPerLightYearAtUnitDistance(this.devicePixelsPerLightYearAtUnitDistance);
        this.requestRender();
    }

    // ---- Commands ---------------------------------------------------------

    dispatch(command) {
        validateCommand(command);
        switch (command.type) {
            case COMMAND_TYPES.defineLayer:
                this.defineLayer(command);
                break;
            case COMMAND_TYPES.addSystems:
                this.addSystems(command);
                break;
            case COMMAND_TYPES.clearLayer:
                this.clearLayer(command.layer);
                break;
            case COMMAND_TYPES.removeLayer:
                this.removeLayer(command.layer);
                break;
            case COMMAND_TYPES.removeAllLayers:
                this.removeAllLayers();
                break;
            case COMMAND_TYPES.setLayerVisibility:
                this.setLayerVisibility(command.layer, command.visible);
                break;
            case COMMAND_TYPES.selectSystem:
                this.selectSystem(command.system, { flyTo: command.flyTo ?? true });
                break;
            case COMMAND_TYPES.moveCamera: {
                const sceneTarget = command.target === undefined ? this.controls.target.clone() : galacticToScene(command.target);
                const directionToCamera = command.view === undefined ? undefined : directionTowardsCamera(command.view);
                this.flyCameraTo(sceneTarget, command.distance, { directionToCamera });
                break;
            }
            case COMMAND_TYPES.highlightSystems:
                this.highlightSystems(command.systems, {
                    frame: command.frame ?? false,
                    view: command.view,
                    asRoute: command.asRoute ?? false,
                    showNames: command.showNames ?? true,
                });
                break;
            case COMMAND_TYPES.clearHighlights:
                this.highlightSystems([], { frame: false });
                break;
            case COMMAND_TYPES.setLegend:
                this.legend.setEntries(command.entries);
                break;
            case COMMAND_TYPES.setGridHeight:
                this.grid.setGalacticHeight(command.y);
                this.requestRender();
                break;
            case COMMAND_TYPES.setGridVisibility:
                this.setUserInterface({ grid: command.visible });
                break;
            case COMMAND_TYPES.setUserInterface: {
                const { type, ...settings } = command;
                this.setUserInterface(settings);
                break;
            }
            case COMMAND_TYPES.setExposure:
                this.toneMappingPass.setExposure(command.exposure);
                this.grid.setExposure(command.exposure);
                this.requestRender();
                break;
            case COMMAND_TYPES.setBackdrop:
                if (command.style !== undefined) {
                    this.backdrop.setStyle(command.style);
                }
                if (command.showGalaxyImage !== undefined) {
                    this.backdrop.setGalaxyImageVisible(command.showGalaxyImage);
                }
                this.dispatchEvent(new CustomEvent('backdropchange', { detail: this.getBackdrop() }));
                this.requestRender();
                break;
            case COMMAND_TYPES.loadingProgress:
                this.loadingOverlay.showProgress(command);
                break;
            case COMMAND_TYPES.loadingFinished:
                this.loadingOverlay.hide();
                break;
            case COMMAND_TYPES.loadingFailed:
                this.loadingOverlay.showFailure(command.message);
                break;
        }
    }

    defineLayer({ type, layer: layerName, ...settings }) {
        const layer = this.starField.defineLayer(layerName, settings);
        if (layer.visible === false && this.hoveredSystem?.layer === layerName) {
            this.setHoveredSystem(null);
        }
        this.announceLayerChange();
        this.requestRender();
        return layer;
    }

    addSystems({ layer: layerName, positions, names, keys }) {
        this.starField.addSystems(layerName, { galacticPositions: positions, names, keys });
        this.announceLayerChange();
        this.prepareCellsWhenIdle();
        this.requestRender();
    }

    // Picking sorts each cell's stars into small boxes the first time it
    // looks at that cell. Doing that while the page is idle, after data
    // arrives, means the first hover over a dense region doesn't stall.
    //
    // The same idle time shuffles each cell's newly arrived stars into random
    // order, which the level of detail needs (see StarCell.shuffleInNewSystems).
    // Shuffling means uploading the whole cell again, so while data is still
    // arriving a cell is only shuffled once its new stars are a good share
    // of it; once arrivals stop, everything left is shuffled in.
    prepareCellsWhenIdle() {
        if (this.idleWorkIsScheduled || this.isDisposed) {
            return;
        }
        this.idleWorkIsScheduled = true;
        whenIdle(deadline => {
            this.idleWorkIsScheduled = false;
            if (this.isDisposed) {
                return;
            }
            const now = performance.now();
            const quietMilliseconds = 1500;
            let cellsLeftUntilQuiet = false;
            let anyCellShuffled = false;
            for (const cell of this.starField.cells) {
                if (deadline.timeRemaining() < 2) {
                    // Out of time: carry on next time, but draw what has
                    // been shuffled so far now.
                    if (anyCellShuffled) {
                        this.requestRender();
                    }
                    this.prepareCellsWhenIdle();
                    return;
                }
                if (cell.unshuffledCount > 0) {
                    const hasGrownALot = cell.unshuffledCount >= Math.max(1024, cell.shuffledCount * 0.25);
                    const hasGoneQuiet = now - cell.timeOfLastAddition > quietMilliseconds;
                    if (hasGrownALot || hasGoneQuiet) {
                        cell.shuffleInNewSystems(Math.random);
                        anyCellShuffled = true;
                    } else {
                        cellsLeftUntilQuiet = true;
                    }
                }
                cell.getPickingIndex();
            }
            if (anyCellShuffled) {
                this.requestRender();
            }
            if (cellsLeftUntilQuiet && this.idleWorkRecheckTimer === undefined) {
                this.idleWorkRecheckTimer = setTimeout(() => {
                    this.idleWorkRecheckTimer = undefined;
                    this.prepareCellsWhenIdle();
                }, quietMilliseconds);
            }
        });
    }

    clearLayer(layerName) {
        if (!this.starField.clearLayer(layerName)) {
            return;
        }
        this.forgetSystemsFromLayer(layerName);
        this.announceLayerChange();
        this.requestRender();
    }

    removeLayer(layerName) {
        if (!this.starField.removeLayer(layerName)) {
            return;
        }
        this.forgetSystemsFromLayer(layerName);
        this.announceLayerChange();
        this.requestRender();
    }

    removeAllLayers() {
        this.starField.removeAllLayers();
        if (this.hoveredSystem !== null && this.hoveredSystem.layer !== undefined) {
            this.setHoveredSystem(null);
        }
        if (this.selectedSystem !== null && this.selectedSystem.layer !== undefined) {
            this.selectSystem(null);
        }
        this.announceLayerChange();
        this.requestRender();
    }

    setLayerVisibility(layerName, isVisible) {
        if (!this.starField.setLayerVisibility(layerName, isVisible)) {
            return;
        }
        if (!isVisible && this.hoveredSystem?.layer === layerName) {
            this.setHoveredSystem(null);
        }
        this.announceLayerChange();
        this.requestRender();
    }

    forgetSystemsFromLayer(layerName) {
        if (this.hoveredSystem?.layer === layerName) {
            this.setHoveredSystem(null);
        }
        if (this.selectedSystem?.layer === layerName) {
            this.selectSystem(null);
        }
    }

    getLayers() {
        return this.starField.getLayersInOrder().map(layer => ({
            layer: layer.layerName,
            label: layer.label,
            order: layer.order,
            systemCount: layer.systemCount,
            visible: layer.visible,
            colour: layer.appearance.colour,
        }));
    }

    // { style, showGalaxyImage }: what the backdrop is showing.
    getBackdrop() {
        return { style: this.backdrop.style, showGalaxyImage: this.backdrop.showGalaxyImage };
    }

    announceLayerChange() {
        // Several commands can arrive back to back; tell listeners once for all of them.
        if (this.layerChangeIsPending) {
            return;
        }
        this.layerChangeIsPending = true;
        queueMicrotask(() => {
            this.layerChangeIsPending = false;
            this.dispatchEvent(new CustomEvent('layerschange', { detail: { layers: this.getLayers() } }));
        });
    }

    // ---- Selection and hover ----------------------------------------------

    selectSystem(system, { flyTo = true } = {}) {
        if (isSameSystem(system, this.selectedSystem) && !flyTo) {
            return;
        }
        this.selectedSystem = system ?? null;
        this.markers.showSelectedSystem(this.selectedSystem).then(() => this.requestRender());
        if (this.selectedSystem !== null) {
            // The grid moves to the selected system's height.
            this.grid.setGalacticHeight(Math.round(this.selectedSystem.coordinates.y));
            if (flyTo) {
                const currentDistance = this.camera.position.distanceTo(this.controls.target);
                const { minimum, maximum } = this.options.selectionViewDistance;
                this.flyCameraTo(galacticToScene(this.selectedSystem.coordinates), MathUtils.clamp(currentDistance, minimum, maximum));
            }
        }
        this.dispatchEvent(new CustomEvent('systemselect', { detail: { system: this.selectedSystem } }));
        this.requestRender();
    }

    setHoveredSystem(system) {
        if (isSameSystem(system, this.hoveredSystem) || (system === null && this.hoveredSystem === null)) {
            return;
        }
        this.hoveredSystem = system;
        this.markers.showHoveredSystem(system).then(() => this.requestRender());
        this.renderer.domElement.style.cursor = system === null ? '' : 'pointer';
        this.dispatchEvent(new CustomEvent('systemhover', { detail: { system } }));
        this.requestRender();
    }

    // Shows these systems with a ring and their name, replacing any earlier
    // highlights; with asRoute, a line joins them in order. With frame, the
    // camera moves to fit them all on screen, looking from `view` ('angled'
    // or 'topDown'; the current direction if not given).
    highlightSystems(systems, { frame = false, view, asRoute = false, showNames = true, animate = true } = {}) {
        this.markers.setHighlightedSystems(systems, { asRoute, showNames }).then(() => this.requestRender());
        // What is under the pointer may have changed (a hovered route stop
        // gone, say), so look again.
        this.hoverCheckIsNeeded = true;
        if (frame && systems.length > 0) {
            this.frameSystemsInView(systems.map(system => system.coordinates), { view, animate });
        }
        this.requestRender();
    }

    getHighlightedSystems() {
        return this.markers.highlightedSystems;
    }

    frameSystemsInView(coordinatesList, { view, animate = true } = {}) {
        // Without a named view, frame from the current direction, judged as
        // top-down when the camera is looking nearly straight down.
        const currentDirection = new Vector3().subVectors(this.camera.position, this.controls.target).normalize();
        const viewName = view ?? (currentDirection.y > 0.95 ? 'topDown' : 'angled');
        const framing = frameSystems({
            coordinatesList,
            viewName,
            fieldOfViewDegrees: this.camera.fov,
            aspectRatio: this.camera.aspect,
            minimumDistance: this.options.framingMinimumDistance,
        });
        // The grid sits at the height of the framed systems, as it does for a
        // selected one.
        this.grid.setGalacticHeight(Math.round(framing.target.y));
        const directionToCamera = view === undefined ? currentDirection : directionTowardsCamera(view);
        this.flyCameraTo(galacticToScene(framing.target), framing.distance, { directionToCamera, animate });
    }

    // Switches parts of the map's own interface on or off; see
    // userInterface.js. Settings not given keep their current value.
    setUserInterface(settingChanges) {
        validateUserInterfaceSettings(settingChanges, 'setUserInterface');
        Object.assign(this.userInterface, settingChanges);
        const settings = this.userInterface;
        this.controls.enableRotate = settings.rotate;
        this.controls.enablePan = settings.pan;
        this.controls.enableZoom = settings.zoom;
        if (!settings.keyboardMovement) {
            this.heldMovementKeys.clear();
        }
        if (!settings.hover) {
            this.setHoveredSystem(null);
        }
        this.grid.visible = settings.grid;
        this.grid.setLabelEnabled(settings.gridLabel);
        this.loadingOverlay.setEnabled(settings.loadingOverlay);
        this.legend.setEnabled(settings.legend);
        this.dispatchEvent(new CustomEvent('userinterfacechange', { detail: { userInterface: this.getUserInterface() } }));
        this.requestRender();
    }

    getUserInterface() {
        return { ...this.userInterface };
    }

    // True if the camera has moved, turned or changed lens visibly since
    // the last frame (see renderQuality.js).
    cameraHasMovedVisiblySinceLastFrame() {
        const current = {
            position: this.camera.position.clone(),
            quaternion: this.camera.quaternion.clone(),
            aspect: this.camera.aspect,
            fov: this.camera.fov,
        };
        const previous = this.previousCameraState;
        this.previousCameraState = current;
        return cameraMovedVisibly(previous, current, this.controls.target);
    }

    // Sets how many of each cell's stars are drawn this frame, and returns
    // { starsLoaded, starsDrawn, cellsOnScreen, crossFadesInProgress }.
    chooseLevelOfDetail({ starBudget, resolutionScale }) {
        this.camera.updateMatrixWorld();
        const frustum = new Frustum().setFromProjectionMatrix(
            new Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
        );
        // Counted in CSS pixels, so a high density screen doesn't draw more.
        const pixelsPerLightYear = this.cssPixelsPerLightYearAtUnitDistance;
        const cellsOnScreen = [];
        const cellDescriptions = [];
        const starField = this.starField;
        const starsLoaded = starField.systemCount;
        const uniforms = starField.material.uniforms;
        uniforms.resolutionScale.value = resolutionScale;
        uniforms.starDimming.value = this.markers.highlightMarkers.length > 0 ? this.options.starDimmingWithHighlights : 1;
        const centre = new Vector3();
        let alwaysDrawnOnScreen = 0;
        const halfCell = starField.cellSize / 2;
        const cellRadius = halfCell * Math.sqrt(3);
        const now = performance.now();
        let crossFadesInProgress = 0;
        for (const cell of starField.cells) {
            cell.wasOnScreen = false;
            const visibleCounts = cell.countVisibleSystems(starField.isVisibleLayer);
            if (visibleCounts.alwaysDrawn + visibleCounts.sampled === 0) {
                // Nothing to show: skip the cell's draw altogether.
                cell.points.visible = false;
                cell.finishCrossFade();
                continue;
            }
            centre.copy(cell.cellOriginInScene).addScalar(halfCell);
            const boundingSphere = { center: centre, radius: cellRadius };
            if (!frustum.intersectsSphere(boundingSphere)) {
                cell.finishCrossFade();
                continue;
            }
            cell.points.visible = true;
            cell.wasOnScreen = true;
            if (cell.advanceCrossFade(now)) {
                crossFadesInProgress++;
            }
            const distance = this.camera.position.distanceTo(centre);
            cellsOnScreen.push(cell);
            alwaysDrawnOnScreen += visibleCounts.alwaysDrawn;
            // The stars of the cell's rarest layers come first and are
            // always drawn; the level of detail samples the rest.
            cellDescriptions.push({
                systemCount: cell.systemCount - cell.alwaysDrawnCount,
                shuffledCount: cell.shuffledCount - cell.alwaysDrawnCount,
                visibleCount: visibleCounts.sampled,
                widthOnScreen: starField.cellSize * pixelsPerLightYear / Math.max(distance, 1),
                cameraIsInside: distance < cellRadius,
            });
        }
        const choices = chooseStarsToDraw(cellDescriptions, {
            maximumStarsPerPixel: this.options.maximumStarsPerPixel,
            // The rare stars drawn in full come out of the budget first.
            starBudget: Math.max(starBudget - alwaysDrawnOnScreen, 0),
        });
        let starsDrawn = 0;
        choices.forEach((choice, index) => {
            const cell = cellsOnScreen[index];
            const description = cellDescriptions[index];
            const sampleStart = cell.alwaysDrawnCount;
            const fade = fadeForSample(choice.drawCount, description.systemCount, description.shuffledCount);
            const drawEnd = sampleStart + fade.fadeEnd;
            cell.points.geometry.setDrawRange(0, drawEnd);
            cell.fadeStart = sampleStart + fade.fadeStart;
            cell.fadeEnd = sampleStart + fade.fadeEnd;
            cell.brightnessCompensation = fade.brightnessCompensation;
            starsDrawn += drawEnd;
        });
        return { starsLoaded, starsDrawn, cellsOnScreen: cellsOnScreen.length, crossFadesInProgress };
    }

    // How the last frame was drawn: { starsLoaded, starsDrawn, cellsOnScreen,
    // crossFadesInProgress, drawCalls, resolutionScale, isMoving,
    // cpuMilliseconds }.
    getFrameStatistics() {
        return { ...this.frameStatistics };
    }

    findSystemAtClientPosition(clientX, clientY) {
        const canvasBounds = this.renderer.domElement.getBoundingClientRect();
        const normalisedPosition = new Vector2(
            ((clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1,
            -((clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(normalisedPosition, this.camera);
        const angularTolerance = this.options.pickTolerancePixels / this.cssPixelsPerLightYearAtUnitDistance;
        let bestMatch = null;
        // Highlighted systems (such as route stops) come first: anything
        // within their more generous distance wins over other stars, even
        // ones nearer the pointer. They can be picked even if no loaded layer
        // contains them.
        const ray = this.raycaster.ray;
        const highlightTolerance = this.options.highlightPickTolerancePixels / this.cssPixelsPerLightYearAtUnitDistance;
        for (const highlightedSystem of this.markers.highlightedSystems) {
            const towardsSystem = galacticToScene(highlightedSystem.coordinates).sub(ray.origin);
            const distanceAlongRay = towardsSystem.dot(ray.direction);
            if (distanceAlongRay <= this.camera.near) {
                continue;
            }
            const distanceFromRay = Math.sqrt(Math.max(towardsSystem.lengthSq() - distanceAlongRay * distanceAlongRay, 0));
            const angularDistance = Math.atan2(distanceFromRay, distanceAlongRay);
            if (angularDistance <= highlightTolerance && (bestMatch === null || angularDistance < bestMatch.angularDistance)) {
                bestMatch = { angularDistance, system: highlightedSystem };
            }
        }
        if (bestMatch !== null) {
            return bestMatch.system;
        }
        const match = this.starField.findSystemNearestRay(this.raycaster.ray, angularTolerance, this.camera.near);
        return match === null ? null : match.system;
    }

    // ---- Camera -----------------------------------------------------------

    // Moves the camera to look at sceneTarget from `distance` away (the
    // current distance if not given), from directionToCamera (the current
    // direction if not given). Without animate it jumps straight there.
    flyCameraTo(sceneTarget, distance, { directionToCamera, animate = true } = {}) {
        const startTarget = this.controls.target.clone();
        const startPosition = this.camera.position.clone();
        const currentOffset = new Vector3().subVectors(startPosition, startTarget);
        const finalDistance = distance ?? currentOffset.length();
        const finalDirection = (directionToCamera ?? currentOffset).clone().normalize();
        const finalPosition = sceneTarget.clone().addScaledVector(finalDirection, finalDistance);
        if (!animate) {
            this.cameraFlight = null;
            this.controls.target.copy(sceneTarget);
            this.camera.position.copy(finalPosition);
            this.controls.update();
            this.requestRender();
            return;
        }
        this.cameraFlight = {
            startTime: performance.now(),
            durationMilliseconds: this.options.selectionFlightMilliseconds,
            startTarget, startPosition,
            finalTarget: sceneTarget.clone(), finalPosition,
        };
        this.requestRender();
    }

    // Returns true while the flight is still under way.
    advanceCameraFlight(now) {
        const flight = this.cameraFlight;
        if (flight === null) {
            return false;
        }
        const progress = Math.min((now - flight.startTime) / flight.durationMilliseconds, 1);
        const easedProgress = easeInOutCubic(progress);
        this.controls.target.lerpVectors(flight.startTarget, flight.finalTarget, easedProgress);
        this.camera.position.lerpVectors(flight.startPosition, flight.finalPosition, easedProgress);
        if (progress >= 1) {
            this.cameraFlight = null;
            return false;
        }
        return true;
    }

    // ---- Rendering ----------------------------------------------------------

    // Nothing is drawn unless something changed: the camera moved, data
    // arrived, or text finished loading. An idle map costs nothing.
    requestRender() {
        if (this.renderIsScheduled || this.isDisposed) {
            return;
        }
        this.renderIsScheduled = true;
        requestAnimationFrame(() => this.renderFrame());
    }

    renderFrame() {
        this.renderIsScheduled = false;
        // Nothing to draw into until the container is shown and sized.
        if (this.isDisposed || this.cssWidth === undefined) {
            return;
        }
        const now = performance.now();
        // Time since the last frame, capped so a pause (a background tab, a
        // slow frame) doesn't turn into one big jump.
        const elapsedSeconds = this.previousFrameTime === null ? 0 : Math.min((now - this.previousFrameTime) / 1000, 0.1);
        this.previousFrameTime = now;
        const cameraIsFlying = this.advanceCameraFlight(now);
        const keysAreMovingCamera = this.advanceKeyboardMovement(elapsedSeconds);
        const controlsAreSettling = this.controls.update();

        if (this.hoverCheckIsNeeded && this.pointerPosition !== null && this.cameraFlight === null) {
            this.hoverCheckIsNeeded = false;
            this.setHoveredSystem(this.findSystemAtClientPosition(this.pointerPosition.x, this.pointerPosition.y));
        }

        const cameraDistanceFromTarget = this.camera.position.distanceTo(this.controls.target);
        const cameraState = {
            camera: this.camera,
            orbitTarget: this.controls.target,
            cameraDistanceFromTarget,
            pixelsPerLightYearAtUnitDistance: this.devicePixelsPerLightYearAtUnitDistance,
        };
        this.backdrop.setDimming(this.markers.highlightMarkers.length > 0 ? this.options.starDimmingWithHighlights : 1);
        this.backdrop.updateForCamera(cameraState);
        if (this.grid.visible) {
            this.grid.updateForCamera({
                ...cameraState,
                pixelsPerLightYearAtUnitDistance: this.cssPixelsPerLightYearAtUnitDistance,
                onTextReady: () => this.requestRender(),
            });
        }
        // System names keep clear of the grid's coordinate label.
        const gridLabelArea = this.grid.visible ? this.grid.labelScreenRectangle(this.camera, this.cssWidth, this.cssHeight) : null;
        this.markers.updateForCamera({
            viewportWidth: this.cssWidth,
            viewportHeight: this.cssHeight,
            camera: this.camera,
            pixelsPerLightYearAtUnitDistance: this.cssPixelsPerLightYearAtUnitDistance,
            gridHeight: this.grid.galacticHeight,
            otherObstacles: gridLabelArea === null ? [] : [gridLabelArea],
        });

        // While the view moves, draw at lower resolution and with fewer stars
        // (see renderQuality.js).
        if (this.cameraHasMovedVisiblySinceLastFrame()) {
            this.timeOfLastMovement = now;
            this.hoverIsStaleFromMovement = true;
        }
        const { isMoving, resolutionScale, starBudget, isEasingIn: detailIsEasingIn } = chooseRenderQuality(now, this.timeOfLastMovement, {
            starBudget: this.options.starBudget,
            starBudgetWhileMoving: this.options.starBudgetWhileMoving,
            reducedResolutionScale: Math.min(1, this.options.pixelRatioWhileMoving / this.renderer.getPixelRatio()),
        });
        this.toneMappingPass.setResolutionScale(resolutionScale);
        // Once the view has stopped (zooming, a flight, the keys), what is
        // under a still pointer may have changed: check on the next frame.
        // Not while moving, when picking every frame would cost too much.
        if (!isMoving && this.hoverIsStaleFromMovement) {
            this.hoverIsStaleFromMovement = false;
            this.hoverCheckIsNeeded = true;
            this.requestRender();
        }
        this.frameStatistics = this.chooseLevelOfDetail({ starBudget, resolutionScale });

        // A frame is several render passes; count them all together.
        this.renderer.info.autoReset = false;
        this.renderer.info.reset();
        this.toneMappingPass.render(this.renderer, this.lightScene, this.overlayScene, this.camera);
        this.frameStatistics.drawCalls = this.renderer.info.render.calls;
        this.frameStatistics.resolutionScale = resolutionScale;
        this.frameStatistics.isMoving = isMoving;
        this.frameStatistics.cpuMilliseconds = performance.now() - now;
        this.dispatchEvent(new CustomEvent('framerender', { detail: this.getFrameStatistics() }));
        if (isMoving && this.fullQualityRenderTimer === undefined) {
            this.fullQualityRenderTimer = setTimeout(() => {
                this.fullQualityRenderTimer = undefined;
                this.requestRender();
            }, STILL_DELAY_MILLISECONDS + 10);
        }

        // Cells dissolving between samples of their stars need frames too.
        if (cameraIsFlying || controlsAreSettling || keysAreMovingCamera || detailIsEasingIn
            || this.frameStatistics.crossFadesInProgress > 0) {
            this.requestRender();
        } else {
            // Frames stop when nothing moves; the next one starts afresh
            // rather than counting the idle time as movement time.
            this.previousFrameTime = null;
        }
    }

    dispose() {
        this.isDisposed = true;
        this.resizeObserver.disconnect();
        this.pixelDensityQuery?.removeEventListener('change', this.handlePixelDensityChange);
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('pointerdown', this.handlePointerDown);
        canvas.removeEventListener('pointermove', this.handlePointerMove);
        canvas.removeEventListener('pointerup', this.handlePointerUp);
        canvas.removeEventListener('pointerleave', this.handlePointerLeave);
        canvas.removeEventListener('keydown', this.handleKeyDown);
        canvas.removeEventListener('keyup', this.handleKeyUp);
        canvas.removeEventListener('blur', this.handleFocusLost);
        clearTimeout(this.fullQualityRenderTimer);
        clearTimeout(this.idleWorkRecheckTimer);
        this.controls.dispose();
        this.starField.dispose();
        this.backdrop.dispose();
        this.grid.dispose();
        this.markers.dispose();
        this.loadingOverlay.dispose();
        this.legend.dispose();
        this.controlPanel.dispose();
        this.toneMappingPass.dispose();
        this.renderer.dispose();
        canvas.remove();
    }
}
