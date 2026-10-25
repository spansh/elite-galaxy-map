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
// Neutron boosts, refuel stops and stops that are both get their own ring
// colours (see routeStopColour).

export const ROUTE_STOP_COLOURS = Object.freeze({
    neutronBoost: '#7cc4ff',
    refuel: '#7be08a',
    neutronBoostAndRefuel: '#d49cff',
});

// The ring colour for one jump of a Spansh route: a neutron boost (has_neutron
// in the exact plotter, neutron_star in the neutron plotter), a refuel stop
// (must_refuel), both, or undefined for an ordinary stop, which then gets the
// map's highlight colour. Pages building their own route systems can use it
// to colour stops the same way.
export function routeStopColour(jump) {
    const isNeutronBoost = jump.has_neutron === true || jump.neutron_star === true;
    const mustRefuel = jump.must_refuel === true;
    if (isNeutronBoost && mustRefuel) {
        return ROUTE_STOP_COLOURS.neutronBoostAndRefuel;
    }
    if (isNeutronBoost) {
        return ROUTE_STOP_COLOURS.neutronBoost;
    }
    if (mustRefuel) {
        return ROUTE_STOP_COLOURS.refuel;
    }
    return undefined;
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
        const system = { name: jump.name ?? jump.system, coordinates };
        if (jump.id64 !== undefined) {
            system.key = jump.id64;
        }
        const colour = routeStopColour(jump);
        if (colour !== undefined) {
            system.colour = colour;
        }
        return system;
    });
    if (systems.length > 0) {
        systems[0].showName = true;
        systems[systems.length - 1].showName = true;
    }
    return systems;
}
