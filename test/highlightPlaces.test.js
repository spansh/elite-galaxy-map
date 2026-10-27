import { describe, expect, it } from 'vitest';
import { findLegsTravelledBothWays, findPlaceOfEachSystem, groupHighlightsByPlace } from '../src/highlightPlaces.js';

const FUELUM = { x: 52, y: -52.65625, z: 49.8125 };
const GONGALUNGUL = { x: 30, y: -60, z: 20 };
const CEMIESS = { x: 10.5, y: -70.25, z: 5.75 };
const HYNEK = { x: 40, y: -75, z: -10 };

const stop = (name, coordinates, extraFields = {}) => ({ name, coordinates, ...extraFields });

describe('groupHighlightsByPlace', () => {
  it('names places as before when nothing shares a place', () => {
    const places = groupHighlightsByPlace([stop('Fuelum', FUELUM), stop('Cemiess', CEMIESS)], { asRoute: true });
    expect(places.map(place => place.labelText)).toEqual(['Fuelum', 'Cemiess']);
  });

  it('lists two stations in one system on one marker, numbered in route order', () => {
    const places = groupHighlightsByPlace([
      stop('Fuelum - Wollheim Vision', FUELUM),
      stop('Gongalungul - Andoyer Station', GONGALUNGUL),
      stop('Cemiess - Meech Dock', CEMIESS),
      stop('ICZ IW-W c1-17 - Hynek Enterprise', HYNEK),
      stop('Cemiess - Titius Station', { ...CEMIESS }),
    ], { asRoute: true });
    expect(places).toHaveLength(4);
    expect(places[2].labelText).toBe('3. Cemiess - Meech Dock\n5. Cemiess - Titius Station');
    expect(places[2].system.name).toBe('Cemiess - Meech Dock');
    expect(places[3].labelText).toBe('ICZ IW-W c1-17 - Hynek Enterprise');
  });

  it('lists every visit to a place the route comes back to on one line', () => {
    const places = groupHighlightsByPlace([
      stop('Fuelum - Wollheim Vision', FUELUM),
      stop('Cemiess - Meech Dock', CEMIESS),
      stop('Fuelum - Wollheim Vision', FUELUM),
    ], { asRoute: true });
    expect(places.map(place => place.labelText)).toEqual(['1, 3. Fuelum - Wollheim Vision', 'Cemiess - Meech Dock']);
  });

  it('lists names at one place without numbers when the highlights are not a route', () => {
    const places = groupHighlightsByPlace([stop('Cemiess - Meech Dock', CEMIESS), stop('Cemiess - Titius Station', CEMIESS)]);
    expect(places[0].labelText).toBe('Cemiess - Meech Dock\nCemiess - Titius Station');
  });

  it('lists stations under their system, and keeps a revisited station on one line', () => {
    const station = (system, stationName, coordinates) => stop(`${system} - ${stationName}`, coordinates, { system, station: stationName });
    const places = groupHighlightsByPlace([
      station('Fuelum', 'Wollheim Vision', FUELUM),
      station('Cemiess', 'Meech Dock', CEMIESS),
      station('Cemiess', 'Titius Station', CEMIESS),
      station('Fuelum', 'Wollheim Vision', FUELUM),
    ], { asRoute: true });
    expect(places.map(place => place.labelText)).toEqual(['Fuelum\n  1, 4. Wollheim Vision', 'Cemiess\n  2. Meech Dock\n  3. Titius Station']);
    expect(groupHighlightsByPlace([station('Cemiess', 'Meech Dock', CEMIESS)])[0].labelText).toBe('Cemiess - Meech Dock');
    expect(groupHighlightsByPlace([station('Cemiess', 'Meech Dock', CEMIESS), station('Cemiess', 'Titius Station', CEMIESS)])[0].labelText)
      .toBe('Cemiess\n  Meech Dock\n  Titius Station');
  });

  it('names one station highlighted twice, outside a route, as it names it once', () => {
    const wollheimVision = stop('Fuelum - Wollheim Vision', FUELUM, { system: 'Fuelum', station: 'Wollheim Vision' });
    expect(groupHighlightsByPlace([wollheimVision, { ...wollheimVision }])[0].labelText).toBe('Fuelum - Wollheim Vision');
  });

  it('only lays out stations under their system when both names are text', () => {
    const places = groupHighlightsByPlace([
      stop('Cemiess A', CEMIESS, { system: { id64: 1 }, station: { id: 2 } }),
      stop('Cemiess B', CEMIESS, { system: { id64: 1 }, station: { id: 3 } }),
    ]);
    expect(places[0].labelText).toBe('Cemiess A\nCemiess B');
  });

  it('keeps the number of a return visit not named by default on a route', () => {
    const places = groupHighlightsByPlace([
      stop('Fuelum', FUELUM, { showName: true }),
      stop('Cemiess', CEMIESS),
      stop('Fuelum', FUELUM),
      stop('Gongalungul', GONGALUNGUL, { showName: true }),
    ], { asRoute: true, showNames: false });
    expect(places[0].labelText).toBe('1, 3. Fuelum');
  });

  it('numbers every stop with numberStops all, and none with numberStops none', () => {
    const station = (system, stationName, coordinates) => stop(`${system} - ${stationName}`, coordinates, { system, station: stationName });
    const route = [
      station('Fuelum', 'Wollheim Vision', FUELUM),
      station('Gongalungul', 'Andoyer Station', GONGALUNGUL),
      station('Cemiess', 'Meech Dock', CEMIESS),
      station('Cemiess', 'Titius Station', CEMIESS),
    ];
    expect(groupHighlightsByPlace(route, { asRoute: true, numberStops: 'all' }).map(place => place.labelText)).toEqual([
      '1. Fuelum - Wollheim Vision',
      '2. Gongalungul - Andoyer Station',
      'Cemiess\n  3. Meech Dock\n  4. Titius Station',
    ]);
    expect(groupHighlightsByPlace(route, { asRoute: true, numberStops: 'none' }).map(place => place.labelText)).toEqual([
      'Fuelum - Wollheim Vision',
      'Gongalungul - Andoyer Station',
      'Cemiess\n  Meech Dock\n  Titius Station',
    ]);
    // A hidden return visit doesn't count towards a shared place.
    const hiddenReturn = [...route, { ...route[0], showName: false }];
    expect(groupHighlightsByPlace(hiddenReturn, { asRoute: true })[0].labelText).toBe('Fuelum - Wollheim Vision');
    // Numbers are for routes only.
    expect(groupHighlightsByPlace(route, { numberStops: 'all' })[0].labelText).toBe('Fuelum - Wollheim Vision');
  });

  it('lists stops by name when they are not all stations of one system', () => {
    const places = groupHighlightsByPlace([
      stop('Cemiess - Meech Dock', CEMIESS, { system: 'Cemiess', station: 'Meech Dock' }),
      stop('Cemiess', CEMIESS),
    ], { asRoute: true });
    expect(places[0].labelText).toBe('1. Cemiess - Meech Dock\n2. Cemiess');
  });

  it('names a place as eagerly as the most eager of its entries', () => {
    const places = groupHighlightsByPlace([
      stop('Start', FUELUM, { showName: true }),
      stop('Middle', CEMIESS),
      stop('End', FUELUM),
    ], { asRoute: true, showNames: 'ifRoom' });
    expect(places.map(place => place.namingRule)).toEqual([true, 'ifRoom']);
  });

  it('leaves names that are not to be shown out of a named place\'s label', () => {
    const places = groupHighlightsByPlace([
      stop('Fuelum - Wollheim Vision', FUELUM, { showName: true }),
      stop('Fuelum - Secret Base', FUELUM, { showName: false }),
    ]);
    expect(places[0].labelText).toBe('Fuelum - Wollheim Vision');
  });

  it('keeps every name for hovering when no entry at a place is named', () => {
    const places = groupHighlightsByPlace([stop('A', FUELUM), stop('B', FUELUM)], { showNames: false });
    expect(places[0]).toMatchObject({ namingRule: false, labelText: 'A\nB' });
  });

  it('keeps a later entry\'s shape when an earlier one there is marked out by colour alone', () => {
    const places = groupHighlightsByPlace([
      stop('Cemiess', CEMIESS, { colour: '#7be08a', centreDot: true }),
      stop('Cemiess', CEMIESS, { colour: '#7cc4ff', shape: 'diamond' }),
    ], { asRoute: true });
    expect(places[0]).toMatchObject({ colour: '#7cc4ff', shape: 'diamond', centreDot: true });
  });

  it('is picked as the first entry named in its label', () => {
    const places = groupHighlightsByPlace([
      stop('Fuelum - Secret Base', FUELUM, { showName: false }),
      stop('Fuelum - Wollheim Vision', FUELUM, { showName: 'ifRoom' }),
    ]);
    expect(places[0].system.name).toBe('Fuelum - Wollheim Vision');
  });

  it('lets a known naming rule win over one the map does not know', () => {
    const places = groupHighlightsByPlace([stop('A', FUELUM, { showName: 'always' }), stop('B', FUELUM, { showName: true })]);
    expect(places[0].namingRule).toBe(true);
  });

  it('still marks out a neutron boost or refuel stop that is not the first visit to its place', () => {
    const places = groupHighlightsByPlace([
      stop('Fuelum', FUELUM),
      stop('Cemiess', CEMIESS),
      stop('Fuelum', FUELUM, { colour: '#7cc4ff', shape: 'diamond' }),
      stop('Cemiess', CEMIESS, { colour: '#7be08a', centreDot: true }),
    ], { asRoute: true });
    expect(places[0]).toMatchObject({ colour: '#7cc4ff', shape: 'diamond', centreDot: false });
    expect(places[1]).toMatchObject({ colour: '#7be08a', shape: undefined, centreDot: true });
  });
});

describe('findPlaceOfEachSystem', () => {
  it('takes coordinates within a tenth of a light year to be the same place, even across a cell boundary', () => {
    const places = findPlaceOfEachSystem([
      stop('A', { x: 25.2, y: 0, z: 0 }),
      stop('B', { x: 25.21875, y: 0, z: 0 }),
      stop('C', { x: 1.004, y: 0, z: 0 }),
      stop('D', { x: 1.006, y: 0, z: 0 }),
      stop('E', { x: 0.99, y: 0, z: 0 }),
      stop('F', { x: 1.5, y: 0, z: 0 }),
    ]);
    expect(places).toEqual([0, 0, 1, 1, 1, 2]);
  });
});

describe('findLegsTravelledBothWays', () => {
  it('finds the legs a route travels there and back', () => {
    // Gongalungul, Cemiess, Hynek, back to Cemiess, then Fuelum.
    expect(findLegsTravelledBothWays([0, 1, 2, 1, 3])).toEqual([false, true, true, false]);
  });

  it('does not count a leg within one place, but sees the route back past it', () => {
    // Fuelum, Cemiess, another station in Cemiess, back to Fuelum.
    expect(findLegsTravelledBothWays([0, 1, 1, 0])).toEqual([true, false, true]);
  });

  it('finds nothing on a route with one system or none', () => {
    expect(findLegsTravelledBothWays([0])).toEqual([]);
    expect(findLegsTravelledBothWays([])).toEqual([]);
  });
});
