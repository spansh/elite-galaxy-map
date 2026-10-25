// Turns a route from one of Spansh's plotters into systems for the map's
// highlightSystems command:
//
//     const routeResult = await (await fetch(routeUrl)).json();
//     galaxyMap.dispatch({
//         type: 'highlightSystems',
//         systems: routeSystemsFromSpanshResult(routeResult),
//         asRoute: true,
//         showNames: 'ifRoom',
//         frame: true,
//     });
//
// Tested against the exact (galaxy) plotter, whose result has
// result.jumps[] with name, x, y, z, id64, has_neutron and must_refuel.
// It also accepts the other shapes Spansh's plotters use, as far as they are
// known here: result.system_jumps[] with `system` instead of `name` (neutron
// and tourist plotters), or result itself being the list (road to riches).
// Coordinates may be x, y, z on the jump or in a `coords` object.
//
// The start and end are always named; with showNames: 'ifRoom' every other
// stop is named where its label fits, and otherwise shows its name on hover.
// Neutron boosts and refuel stops are marked out in ways that don't rely on
// colour alone (see routeStopMarker).

export const ROUTE_STOP_COLOURS = Object.freeze({
    neutronBoost: '#7cc4ff',
    refuel: '#7be08a',
    neutronBoostAndRefuel: '#d49cff',
});

// How one jump of a Spansh route is marked, as fields to add to its system:
//
//   neutron boost              a diamond                  (blue)
//   refuel stop                a circle with a centre dot (green)
//   neutron boost and refuel   a diamond with a centre dot (purple)
//   any other stop             {} (a plain circle in the highlight colour)
//
// The shape says whether it is a neutron boost and the dot whether it is a
// refuel stop, so each can be read without telling colours apart. A neutron
// boost is has_neutron in the exact plotter and neutron_star in the neutron
// plotter; a refuel stop is must_refuel. Pages building their own route
// systems can use it to mark stops the same way:
//
//     const system = { name, coordinates, ...routeStopMarker(jump) };
export function routeStopMarker(jump) {
    const isNeutronBoost = jump.has_neutron === true || jump.neutron_star === true;
    const mustRefuel = jump.must_refuel === true;
    if (isNeutronBoost && mustRefuel) {
        return { colour: ROUTE_STOP_COLOURS.neutronBoostAndRefuel, shape: 'diamond', centreDot: true };
    }
    if (isNeutronBoost) {
        return { colour: ROUTE_STOP_COLOURS.neutronBoost, shape: 'diamond' };
    }
    if (mustRefuel) {
        return { colour: ROUTE_STOP_COLOURS.refuel, centreDot: true };
    }
    return {};
}

function findListOfJumps(routeResult) {
    if (Array.isArray(routeResult)) {
        return routeResult;
    }
    const result = routeResult?.result ?? routeResult;
    if (Array.isArray(result)) {
        return result;
    }
    for (const listName of ['jumps', 'system_jumps']) {
        if (Array.isArray(result?.[listName])) {
            return result[listName];
        }
    }
    throw new Error('Could not find the list of jumps in this route (looked for result.jumps, result.system_jumps and a plain list)');
}

function coordinatesOfJump(jump) {
    const source = jump.coords ?? jump;
    const coordinates = { x: Number(source.x), y: Number(source.y), z: Number(source.z) };
    const hasCoordinates = [coordinates.x, coordinates.y, coordinates.z].every(Number.isFinite);
    return hasCoordinates ? coordinates : null;
}

// The kinds of stop routeStopMarker tells apart, in the order a legend lists
// them, each with an example jump.
const ROUTE_STOP_KINDS = Object.freeze([
    { kind: 'neutronBoost', exampleJump: { has_neutron: true } },
    { kind: 'refuel', exampleJump: { must_refuel: true } },
    { kind: 'neutronBoostAndRefuel', exampleJump: { has_neutron: true, must_refuel: true } },
    { kind: 'other', exampleJump: {} },
]);

// The legend's labels for each kind of stop, unless others are given.
export const ROUTE_STOP_LABELS = Object.freeze({
    neutronBoost: 'Neutron boost',
    refuel: 'Refuel stop',
    neutronBoostAndRefuel: 'Neutron boost and refuel',
    other: 'Other stop',
});

// Entries for the map's legend (the legend option or setLegend command)
// explaining the stops of a route made by routeSystemsFromSpanshResult or
// routeStopMarker, with how many of each it has. Only the kinds the route
// has are listed; a route with no neutron boosts or refuel stops gets an
// empty legend, as there's nothing to tell apart.
//
//     const systems = routeSystemsFromSpanshResult(routeResult);
//     galaxyMap.dispatch({ type: 'highlightSystems', systems, asRoute: true, frame: true });
//     galaxyMap.dispatch({ type: 'setLegend', entries: routeStopLegend(systems) });
//
// labels replaces any of ROUTE_STOP_LABELS, for example with translations:
//
//     routeStopLegend(systems, { labels: { neutronBoost: 'Boost de neutrons', refuel: 'Ravitaillement' } });
export function routeStopLegend(systems, { labels = {} } = {}) {
    const unknownKinds = Object.keys(labels).filter(kind => !(kind in ROUTE_STOP_LABELS));
    if (unknownKinds.length > 0) {
        throw new Error(`routeStopLegend has labels for unknown kinds of stop: ${unknownKinds.join(', ')}; known kinds are ${Object.keys(ROUTE_STOP_LABELS).join(', ')}`);
    }
    const entries = [];
    for (const { kind, exampleJump } of ROUTE_STOP_KINDS) {
        const marker = routeStopMarker(exampleJump);
        const count = systems.filter(system => system.shape === marker.shape && system.centreDot === marker.centreDot).length;
        if (count > 0) {
            entries.push({ label: labels[kind] ?? ROUTE_STOP_LABELS[kind], ...marker, count });
        }
    }
    const hasOnlyOrdinaryStops = entries.length === 1 && entries[0].shape === undefined && entries[0].centreDot === undefined;
    return hasOnlyOrdinaryStops ? [] : entries;
}

export function routeSystemsFromSpanshResult(routeResult) {
    if (routeResult?.status !== undefined && routeResult.status !== 'ok') {
        throw new Error(`The route did not finish: status "${routeResult.status}"${routeResult.error ? `, ${routeResult.error}` : ''}`);
    }
    const jumps = findListOfJumps(routeResult);
    const systems = jumps.map((jump, jumpIndex) => {
        const coordinates = coordinatesOfJump(jump);
        if (coordinates === null) {
            throw new Error(`Jump ${jumpIndex} (${jump.name ?? jump.system ?? 'unnamed'}) has no coordinates`);
        }
        const system = { name: jump.name ?? jump.system, coordinates, ...routeStopMarker(jump) };
        if (jump.id64 !== undefined) {
            system.key = jump.id64;
        }
        return system;
    });
    if (systems.length > 0) {
        systems[0].showName = true;
        systems[systems.length - 1].showName = true;
    }
    return systems;
}
