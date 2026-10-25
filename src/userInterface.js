// The parts of the map's own user interface that a page can switch off, for
// example to embed a fixed, non-interactive view. Set them with the
// userInterface option when creating the map, or change them later with
//
//     galaxyMap.dispatch({ type: 'setUserInterface', rotate: false, zoom: false });
//
// Anything not mentioned keeps its current setting. Switching off a way of
// interacting only affects the person using the map; the page can still do
// the same through commands (moveCamera, selectSystem and so on).

export const DEFAULT_USER_INTERFACE = Object.freeze({
    // Dragging to turn the view around the point it looks at.
    rotate: true,
    // Right-dragging (or two-finger dragging) to move across the galaxy.
    pan: true,
    // The mouse wheel or pinching to zoom.
    zoom: true,
    // Arrow keys, Page Up and Page Down to glide the view.
    keyboardMovement: true,
    // A ring and name on the star under the pointer.
    hover: true,
    // Clicking a star to select it.
    selectByClick: true,
    // Flying to a star when it is clicked; off, it is selected where it is.
    flyToSelection: true,
    // The grid on the galactic plane.
    grid: true,
    // The coordinates label at the grid corner nearest the view's centre.
    gridLabel: true,
    // The progress bar along the bottom while data loads.
    loadingOverlay: true,
    // The key to the highlight markers, when the page has given one (the
    // legend option or setLegend command).
    legend: true,

    // The control panel in the top left corner, and its sections:
    panel: true,
    // The layers, with their colours, sizes and a box to show or hide each.
    layerList: true,
    // The Galaxy glow, Galaxy image and Grid checkboxes.
    displaySettings: true,
    // Choosing a Spansh route file to show, and clearing it.
    routePicker: true,
    // Name, coordinates and distance from Sol of the selected system.
    selectionDetails: true,
    // A box for a dump's address with Load, Stop and Clear stars. Off unless
    // asked for: the map doesn't load data itself, so Load and Stop only
    // raise loadrequest and stoprequest events for the page's own loader.
    dataLoading: false,
});

const SETTING_NAMES = Object.keys(DEFAULT_USER_INTERFACE);

// Throws an error naming the problem if any setting is unknown or not true or
// false. `where` says where the settings came from, for the message.
export function validateUserInterfaceSettings(settings, where) {
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new TypeError(`${where} must be an object of settings, such as { rotate: false }`);
    }
    for (const [settingName, value] of Object.entries(settings)) {
        if (!SETTING_NAMES.includes(settingName)) {
            throw new Error(`${where} has an unknown setting "${settingName}"; known settings are ${SETTING_NAMES.join(', ')}`);
        }
        if (typeof value !== 'boolean') {
            throw new Error(`${where} setting "${settingName}" must be true or false, not ${JSON.stringify(value)}`);
        }
    }
    return settings;
}
