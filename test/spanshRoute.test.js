import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROUTE_STOP_COLOURS, routeStopLegend, routeStopMarker, routeSystemsFromSpanshResult } from '../src/spanshRoute.js';
import { COMMAND_TYPES, validateCommand } from '../src/commands.js';
import { groupHighlightsByPlace } from '../src/highlightPlaces.js';

// A shortened exact plotter result: Sol to Beagle Point, keeping the first
// two jumps, a neutron boost, a refuel stop and the last jump.
const exactPlotterRoute = JSON.parse(readFileSync(new URL('./fixtures/exact-plotter-route.json', import.meta.url), 'utf8'));
// A trade plotter result: five hops from Fuelum, stopping twice in Cemiess.
const tradeRoute = JSON.parse(readFileSync(new URL('./fixtures/trade-route.json', import.meta.url), 'utf8'));

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

  it('marks neutron boosts and refuel stops', () => {
    const systems = routeSystemsFromSpanshResult(exactPlotterRoute);
    expect(systems[2]).toMatchObject({ colour: ROUTE_STOP_COLOURS.neutronBoost, shape: 'diamond' });
    expect(systems[2].centreDot).toBeUndefined();
    expect(systems[3]).toMatchObject({ colour: ROUTE_STOP_COLOURS.refuel, centreDot: true });
    expect(systems[3].shape).toBeUndefined();
    expect(systems[1].colour).toBeUndefined();
    expect(systems[1].shape).toBeUndefined();
    expect(systems[1].centreDot).toBeUndefined();
  });

  it('marks stops by shape for neutron boosts and a centre dot for refuelling, so both can be read at once', () => {
    expect(routeStopMarker({ has_neutron: true, must_refuel: true }))
      .toEqual({ colour: ROUTE_STOP_COLOURS.neutronBoostAndRefuel, shape: 'diamond', centreDot: true });
    expect(routeStopMarker({ neutron_star: true, must_refuel: true }))
      .toEqual({ colour: ROUTE_STOP_COLOURS.neutronBoostAndRefuel, shape: 'diamond', centreDot: true });
    expect(routeStopMarker({ has_neutron: true, must_refuel: false })).toEqual({ colour: ROUTE_STOP_COLOURS.neutronBoost, shape: 'diamond' });
    expect(routeStopMarker({ has_neutron: false, must_refuel: true })).toEqual({ colour: ROUTE_STOP_COLOURS.refuel, centreDot: true });
    expect(routeStopMarker({ has_neutron: false, must_refuel: false })).toEqual({});
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

  it('makes a legend of the kinds of stop a route has, with counts', () => {
    const systems = [
      { has_neutron: true }, { has_neutron: true }, { must_refuel: true }, {}, {},
    ].map((jump, index) => ({ name: `Stop ${index}`, coordinates: { x: index, y: 0, z: 0 }, ...routeStopMarker(jump) }));
    expect(routeStopLegend(systems)).toEqual([
      { label: 'Neutron boost', colour: ROUTE_STOP_COLOURS.neutronBoost, shape: 'diamond', count: 2 },
      { label: 'Refuel stop', colour: ROUTE_STOP_COLOURS.refuel, centreDot: true, count: 1 },
      { label: 'Other stop', count: 2 },
    ]);
    expect(() => validateCommand({ type: COMMAND_TYPES.setLegend, entries: routeStopLegend(systems) })).not.toThrow();
  });

  it('labels the legend with the labels given, keeping the rest', () => {
    const systems = [{ has_neutron: true }, { must_refuel: true }, {}]
      .map((jump, index) => ({ name: `Stop ${index}`, coordinates: { x: index, y: 0, z: 0 }, ...routeStopMarker(jump) }));
    const labels = routeStopLegend(systems, { labels: { neutronBoost: 'Boost de neutrons', other: 'Autre arrêt' } }).map(entry => entry.label);
    expect(labels).toEqual(['Boost de neutrons', 'Refuel stop', 'Autre arrêt']);
    expect(() => routeStopLegend(systems, { labels: { neutron: 'Boost' } })).toThrow(/unknown kinds of stop: neutron/);
  });

  it('leaves the legend empty for a route with only ordinary stops', () => {
    const systems = [{}, {}].map((jump, index) => ({ name: `Stop ${index}`, coordinates: { x: index, y: 0, z: 0 }, ...routeStopMarker(jump) }));
    expect(routeStopLegend(systems)).toEqual([]);
  });

  it('checks legend entries', () => {
    const legend = entries => ({ type: COMMAND_TYPES.setLegend, entries });
    expect(() => validateCommand(legend([]))).not.toThrow();
    expect(() => validateCommand(legend([{ label: 'Reference system', colour: '#6ea8fe', shape: 'square' }]))).not.toThrow();
    expect(() => validateCommand({ type: COMMAND_TYPES.setLegend })).toThrow(/needs entries as an array/);
    expect(() => validateCommand(legend([{ colour: '#fff' }]))).toThrow(/entry 0 needs a label/);
    expect(() => validateCommand(legend([{ label: 'Odd', shape: 'star' }]))).toThrow(/shape must be/);
    expect(() => validateCommand(legend([{ label: 'Odd', count: 'many' }]))).toThrow(/count must be a number/);
  });

  it('rejects unknown marker shapes and centre dots that are not true or false', () => {
    const system = { name: 'Sol', coordinates: { x: 0, y: 0, z: 0 } };
    const highlight = extraFields => ({ type: COMMAND_TYPES.highlightSystems, systems: [{ ...system, ...extraFields }] });
    expect(() => validateCommand(highlight({ shape: 'triangle', centreDot: true }))).not.toThrow();
    expect(() => validateCommand(highlight({ shape: 'hexagon' }))).toThrow(/shape must be circle, diamond, square, triangle/);
    expect(() => validateCommand(highlight({ centreDot: 'yes' }))).toThrow(/centreDot must be true or false/);
  });

  it('reads a trade route as its first source and then every destination', () => {
    const systems = routeSystemsFromSpanshResult(tradeRoute);
    expect(systems.map(system => system.name)).toEqual([
      'Fuelum - Wollheim Vision',
      'Gongalungul - Andoyer Station',
      'Cemiess - Meech Dock',
      'ICZ IW-W c1-17 - Hynek Enterprise',
      'Cemiess - Titius Station',
      'Shui Wei Sector KN-S b4-5 - Guabanseh',
    ]);
    expect(systems[0]).toEqual({
      name: 'Fuelum - Wollheim Vision',
      system: 'Fuelum',
      station: 'Wollheim Vision',
      coordinates: { x: 52, y: -52.65625, z: 49.8125 },
      key: 3223901184,
      systemId64: 5031721931482,
      marketId: 3223901184,
      showName: true,
    });
    expect(systems[5].showName).toBe(true);
    expect(routeStopLegend(systems)).toEqual([]);
    expect(() => validateCommand({ type: COMMAND_TYPES.highlightSystems, systems, asRoute: true })).not.toThrow();
  });

  it('names a trade stop with no station after its system alone', () => {
    const hop = tradeRoute.result[0];
    const systems = routeSystemsFromSpanshResult([{ ...hop, destination: { ...hop.destination, station: undefined } }]);
    expect(systems[1].name).toBe('Gongalungul');
  });

  it('lists the two Cemiess stations of the trade route under the system', () => {
    const places = groupHighlightsByPlace(routeSystemsFromSpanshResult(tradeRoute), { asRoute: true });
    expect(places).toHaveLength(5);
    expect(places[2].labelText).toBe('Cemiess\n  3. Meech Dock\n  5. Titius Station');
    expect(places[1].labelText).toBe('Gongalungul - Andoyer Station');
    const numberedPlaces = groupHighlightsByPlace(routeSystemsFromSpanshResult(tradeRoute), { asRoute: true, numberStops: 'all' });
    expect(numberedPlaces.map(place => place.labelText)).toEqual([
      '1. Fuelum - Wollheim Vision',
      '2. Gongalungul - Andoyer Station',
      'Cemiess\n  3. Meech Dock\n  5. Titius Station',
      '4. ICZ IW-W c1-17 - Hynek Enterprise',
      '6. Shui Wei Sector KN-S b4-5 - Guabanseh',
    ]);
  });

  it('explains routes it cannot use', () => {
    expect(() => routeSystemsFromSpanshResult({ status: 'error', error: 'Could not find a route' })).toThrow(/did not finish.*Could not find a route/);
    expect(() => routeSystemsFromSpanshResult({ status: 'ok', result: {} })).toThrow(/Could not find the list of jumps/);
    expect(() => routeSystemsFromSpanshResult([{ name: 'Nowhere', x: 1 }])).toThrow(/Jump 0 \(Nowhere\) has no coordinates/);
    expect(() => routeSystemsFromSpanshResult([{ source: { system: 'Fuelum', station: 'Wollheim Vision' }, destination: {} }]))
      .toThrow(/Stop 0 \(Fuelum - Wollheim Vision\) has no coordinates/);
    expect(() => routeSystemsFromSpanshResult({ status: 'ok', result: [tradeRoute.result[0], { source: null, destination: tradeRoute.result[1].destination }] }))
      .toThrow(/Trade hop 1 has no source station/);
    expect(() => routeSystemsFromSpanshResult({ status: 'ok', result: [tradeRoute.result[0], { source: tradeRoute.result[1].source }] }))
      .toThrow(/Trade hop 1 has no destination station/);
  });
});
