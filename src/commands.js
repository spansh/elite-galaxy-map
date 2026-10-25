// The messages a GalaxyMap understands. Every message is a plain object with
// a `type` saying what it is, so a loader running in a Web Worker can post
// them straight across:
//
//     worker.addEventListener('message', event => galaxyMap.dispatch(event.data));
//
// Positions are galactic coordinates (as in the journal and Spansh dumps):
// x, y, z for each system one after another in a Float32Array.

import { BACKDROP_STYLES } from './backdrop/GalaxyBackdrop.js';
import { MARKER_SHAPE_NAMES } from './markerShapes.js';
import { validateUserInterfaceSettings } from './userInterface.js';

export const COMMAND_TYPES = Object.freeze({
    // { type, layer, colour?, starSizeInLightYears?, minimumPixelSize?,
    //   maximumPixelSize?, minimumBrightness?, opacity?, visible?, label?, order? }
    // Creates a layer, or changes an existing one's appearance. Layers are
    // listed by order (lowest first), then in the order they were defined.
    // All layers share the same draw calls, so splitting stars into many
    // layers costs nothing extra; the map holds up to 64 at once.
    defineLayer: 'defineLayer',
    // { type, layer, positions: Float32Array, names?: string[] | string, keys?: any[] }
    // names can be one string with a newline between names, which is much
    // cheaper to post from a worker than an array of millions of strings.
    // Layers that were never defined are created with default appearance.
    addSystems: 'addSystems',
    // { type, layer }
    clearLayer: 'clearLayer',
    // { type, layer }
    removeLayer: 'removeLayer',
    // { type }  removes every layer of stars
    removeAllLayers: 'removeAllLayers',
    // { type, layer, visible: boolean }
    setLayerVisibility: 'setLayerVisibility',
    // { type, system: { name?, key?, layer?, coordinates: {x, y, z} }, flyTo?: boolean }
    // { type, system: null } clears the selection.
    selectSystem: 'selectSystem',
    // { type, target?: {x, y, z}, distance?: number, view?: 'angled' | 'topDown' }
    // Anything left out stays as it is, so { type, view: 'topDown' } just
    // turns the camera to look straight down at the same point.
    moveCamera: 'moveCamera',
    // { type, systems: [{ name, coordinates: {x, y, z}, key?, colour?, shape?, centreDot?, showName? }],
    //   asRoute?: boolean, showNames?: boolean | 'ifRoom', frame?: boolean, view?: 'angled' | 'topDown' }
    // Shows each system with a ring and its name, replacing earlier
    // highlights. With asRoute, a line joins them in the order given.
    // A system's shape ('circle', 'diamond', 'square' or 'triangle') and
    // centreDot (a dot in the ring) mark kinds of system out without relying
    // on colour.
    // showNames: true names every system, moving labels to make room;
    // 'ifRoom' names those whose label fits beside them; false names none.
    // A system's own showName overrides it. With frame, the camera moves to
    // fit them all on screen.
    highlightSystems: 'highlightSystems',
    // { type }
    clearHighlights: 'clearHighlights',
    // { type, y }
    setGridHeight: 'setGridHeight',
    // { type, visible }  the same as setUserInterface with grid
    setGridVisibility: 'setGridVisibility',
    // { type, rotate?, pan?, zoom?, keyboardMovement?, hover?, selectByClick?,
    //   flyToSelection?, grid?, gridLabel?, loadingOverlay?, panel?,
    //   dataLoading?, layerList?, routePicker?, displaySettings?,
    //   selectionDetails? }
    // Switches parts of the map's own interface on (true) or off (false);
    // anything left out keeps its setting. See userInterface.js.
    setUserInterface: 'setUserInterface',
    // { type, style?: 'volumetric' | 'none', showGalaxyImage?: boolean }
    // style shows ('volumetric') or hides ('none') the glow; showGalaxyImage
    // shows or hides the flat picture of the galaxy seen when zoomed out.
    setBackdrop: 'setBackdrop',
    // { type, exposure }  how hard bright areas are compressed; default 1.2
    setExposure: 'setExposure',
    // { type, loadedBytes, totalBytes?, systemCount? }
    loadingProgress: 'loadingProgress',
    // { type, systemCount? }
    loadingFinished: 'loadingFinished',
    // { type, message }
    loadingFailed: 'loadingFailed',
});

const KNOWN_COMMAND_TYPES = new Set(Object.values(COMMAND_TYPES));

function hasCoordinates(place) {
    return place !== null && typeof place === 'object' && ['x', 'y', 'z'].every(axis => Number.isFinite(place[axis]));
}

// Throws unless the command's field is one of the types allowed. Optional
// fields may also be left out.
function checkField(command, fieldName, isValid, description, { optional = false } = {}) {
    const value = command[fieldName];
    if (optional && value === undefined) {
        return;
    }
    if (!isValid(value)) {
        throw new Error(`${command.type} needs ${fieldName} as ${description}, not ${JSON.stringify(value)}`);
    }
}

const isBoolean = value => typeof value === 'boolean';

// Number of names in a newline-separated string (no trailing newline), the
// same as text.split('\n').length without building the array.
function countLines(text) {
    let lineCount = 1;
    let searchFrom = 0;
    for (;;) {
        const newlinePosition = text.indexOf('\n', searchFrom);
        if (newlinePosition < 0) {
            return lineCount;
        }
        lineCount++;
        searchFrom = newlinePosition + 1;
    }
}

export function validateCommand(command) {
    if (command === null || typeof command !== 'object') {
        throw new TypeError('A galaxy map command must be an object with a type');
    }
    if (!KNOWN_COMMAND_TYPES.has(command.type)) {
        throw new Error(`Unknown galaxy map command type "${command.type}". Known types: ${[...KNOWN_COMMAND_TYPES].join(', ')}`);
    }
    const needsLayer = [
        COMMAND_TYPES.defineLayer, COMMAND_TYPES.addSystems, COMMAND_TYPES.clearLayer,
        COMMAND_TYPES.removeLayer, COMMAND_TYPES.setLayerVisibility,
    ];
    if (needsLayer.includes(command.type) && (typeof command.layer !== 'string' || command.layer === '')) {
        throw new Error(`Galaxy map command "${command.type}" needs a layer name`);
    }
    if (command.type === COMMAND_TYPES.defineLayer && command.order !== undefined && !Number.isFinite(command.order)) {
        throw new Error(`defineLayer "${command.layer}" order must be a number, not ${JSON.stringify(command.order)}`);
    }
    if (command.type === COMMAND_TYPES.setUserInterface) {
        const { type, ...settings } = command;
        validateUserInterfaceSettings(settings, 'setUserInterface');
    }
    // Values the camera, tone mapping or grid would turn into NaN, leaving
    // the map broken until every one of them was set again.
    switch (command.type) {
        case COMMAND_TYPES.setLayerVisibility:
        case COMMAND_TYPES.setGridVisibility:
            checkField(command, 'visible', isBoolean, 'true or false');
            break;
        case COMMAND_TYPES.selectSystem:
            checkField(command, 'system', system => system === null || hasCoordinates(system?.coordinates),
                'a system with coordinates (numbers for x, y and z), or null to clear the selection');
            checkField(command, 'flyTo', isBoolean, 'true or false', { optional: true });
            break;
        case COMMAND_TYPES.moveCamera:
            checkField(command, 'target', hasCoordinates, 'coordinates with numbers for x, y and z', { optional: true });
            checkField(command, 'distance', distance => Number.isFinite(distance) && distance > 0, 'a number above 0', { optional: true });
            break;
        case COMMAND_TYPES.setGridHeight:
            checkField(command, 'y', Number.isFinite, 'a number');
            break;
        case COMMAND_TYPES.setExposure:
            checkField(command, 'exposure', exposure => Number.isFinite(exposure) && exposure > 0, 'a number above 0');
            break;
        case COMMAND_TYPES.setBackdrop:
            checkField(command, 'style', style => BACKDROP_STYLES.includes(style), BACKDROP_STYLES.join(' or '), { optional: true });
            checkField(command, 'showGalaxyImage', isBoolean, 'true or false', { optional: true });
            break;
    }
    if (command.type === COMMAND_TYPES.highlightSystems) {
        if (!Array.isArray(command.systems)) {
            throw new Error('highlightSystems needs systems as an array');
        }
        const namingRules = [true, false, 'ifRoom'];
        if (command.showNames !== undefined && !namingRules.includes(command.showNames)) {
            throw new Error(`highlightSystems showNames must be true, false or 'ifRoom', not ${JSON.stringify(command.showNames)}`);
        }
        command.systems.forEach((system, index) => {
            if (system?.showName !== undefined && !namingRules.includes(system.showName)) {
                throw new Error(`highlightSystems system ${index} (${system.name ?? 'unnamed'}) showName must be true, false or 'ifRoom'`);
            }
            if (!hasCoordinates(system?.coordinates)) {
                throw new Error(`highlightSystems system ${index} (${system?.name ?? 'unnamed'}) needs coordinates with numbers for x, y and z`);
            }
            if (system.shape !== undefined && !MARKER_SHAPE_NAMES.includes(system.shape)) {
                throw new Error(`highlightSystems system ${index} (${system.name ?? 'unnamed'}) shape must be ${MARKER_SHAPE_NAMES.join(', ')}, not ${JSON.stringify(system.shape)}`);
            }
            if (system.centreDot !== undefined && typeof system.centreDot !== 'boolean') {
                throw new Error(`highlightSystems system ${index} (${system.name ?? 'unnamed'}) centreDot must be true or false`);
            }
        });
    }
    if (command.view !== undefined && !['angled', 'topDown'].includes(command.view)) {
        throw new Error(`Unknown camera view "${command.view}"; expected angled or topDown`);
    }
    if (command.type === COMMAND_TYPES.addSystems) {
        const positions = command.positions;
        if (!(positions instanceof Float32Array || positions instanceof Float64Array || Array.isArray(positions))) {
            throw new Error('addSystems needs positions as a Float32Array of x, y, z values');
        }
        if (positions.length % 3 !== 0) {
            throw new Error(`addSystems positions length ${positions.length} is not a multiple of 3`);
        }
        const systemCount = positions.length / 3;
        if (typeof command.names === 'string') {
            const nameCount = countLines(command.names);
            if (nameCount !== systemCount) {
                throw new Error(`addSystems has ${systemCount} positions but ${nameCount} newline-separated names`);
            }
        } else if (command.names !== undefined && command.names !== null && command.names.length !== systemCount) {
            throw new Error(`addSystems has ${systemCount} positions but ${command.names.length} names`);
        }
        if (command.keys !== undefined && command.keys !== null && command.keys.length !== systemCount) {
            throw new Error(`addSystems has ${systemCount} positions but ${command.keys.length} keys`);
        }
    }
    return command;
}
