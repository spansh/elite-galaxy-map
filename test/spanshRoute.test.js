import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROUTE_STOP_COLOURS, routeSystemsFromSpanshResult } from '../src/spanshRoute.js';
import { COMMAND_TYPES, validateCommand } from '../src/commands.js';

// A shortened exact plotter result: Sol to Beagle Point, keeping the first
// two jumps, a neutron boost, a refuel stop and the last jump.
const exactPlotterRoute = JSON.parse(readFileSync(new URL('./fixtures/exact-plotter-route.json', import.meta.url), 'utf8'));

describe('routeSystemsFromSpanshResult', () => {
    it('reads the exact plotter format, naming only the start and end', () => {
        const systems = routeSystemsFromSpanshResult(exactPlotterRoute);
        expect(systems).toHaveLength(5);
        expect(systems[0]).toEqual({ name: 'Sol', coordinates: { x: 0, y: 0, z: 0 }, key: 10477373803, showName: true });
        expect(systems[4].name).toBe('Beagle Point');
        expect(systems[4].coordinates).toEqual({ x: -1111.5625, y: -134.21875, z: 65269.75 });
        expect(systems[4].showName).toBe(true);
        expect(systems[1].showName).toBeUndefined();
    });

    it('colours neutron boosts and refuel stops', () => {
        const systems = routeSystemsFromSpanshResult(exactPlotterRoute);
        expect(systems[2].colour).toBe(ROUTE_STOP_COLOURS.neutronBoost);
        expect(systems[3].colour).toBe(ROUTE_STOP_COLOURS.refuel);
        expect(systems[1].colour).toBeUndefined();
    });

    it('makes a command the map accepts', () => {
        const command = { type: COMMAND_TYPES.highlightSystems, systems: routeSystemsFromSpanshResult(exactPlotterRoute), asRoute: true };
        expect(() => validateCommand(command)).not.toThrow();
    });

    it('accepts the neutron plotter shape, with system names and coords objects', () => {
        const systems = routeSystemsFromSpanshResult({
            status: 'ok',
            result: { system_jumps: [
                { system: 'Sol', x: 0, y: 0, z: 0, neutron_star: false },
                { system: 'Middle', coords: { x: 1, y: 2, z: 3 }, neutron_star: true },
                { system: 'End', x: 4, y: 5, z: 6, neutron_star: false },
            ] },
        });
        expect(systems.map(system => system.name)).toEqual(['Sol', 'Middle', 'End']);
        expect(systems[1].coordinates).toEqual({ x: 1, y: 2, z: 3 });
        expect(systems[1].colour).toBe(ROUTE_STOP_COLOURS.neutronBoost);
    });

    it('explains routes it cannot use', () => {
        expect(() => routeSystemsFromSpanshResult({ status: 'error', error: 'Could not find a route' })).toThrow(/did not finish.*Could not find a route/);
        expect(() => routeSystemsFromSpanshResult({ status: 'ok', result: {} })).toThrow(/Could not find the list of jumps/);
        expect(() => routeSystemsFromSpanshResult([{ name: 'Nowhere', x: 1 }])).toThrow(/Jump 0 \(Nowhere\) has no coordinates/);
    });
});
