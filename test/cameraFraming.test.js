import { describe, expect, it } from 'vitest';
import { directionTowardsCamera, frameSystems } from '../src/cameraFraming.js';
import { COMMAND_TYPES, validateCommand } from '../src/commands.js';

const SOL = { x: 0, y: 0, z: 0 };
const COLONIA = { x: -9530.5, y: -910.28125, z: 19808.125 };

describe('directionTowardsCamera', () => {
  it('looks almost straight down for the top-down view, with galactic north up', () => {
    const direction = directionTowardsCamera('topDown');
    expect(direction.y).toBeGreaterThan(0.9999);
    // A small positive scene z puts the camera on the Sol side, looking
    // towards galactic +z (scene -z) at the top of the screen.
    expect(direction.z).toBeGreaterThan(0);
  });

  it('names unknown views', () => {
    expect(() => directionTowardsCamera('sideways')).toThrow(/Unknown camera view "sideways"/);
  });
});

describe('frameSystems', () => {
  const viewSettings = { fieldOfViewDegrees: 60, aspectRatio: 1.5, minimumDistance: 200, marginFactor: 1 };

  it('centres on the systems and keeps a single system at the minimum distance', () => {
    const framing = frameSystems({ coordinatesList: [COLONIA], viewName: 'topDown', ...viewSettings });
    expect(framing.target).toEqual(COLONIA);
    expect(framing.distance).toBe(200);
  });

  it('backs off far enough looking down to fit both ends on screen', () => {
    const framing = frameSystems({ coordinatesList: [SOL, COLONIA], viewName: 'topDown', ...viewSettings });
    expect(framing.target.x).toBeCloseTo((SOL.x + COLONIA.x) / 2);
    expect(framing.target.z).toBeCloseTo((SOL.z + COLONIA.z) / 2);
    // Half the z extent must fit in half the view's height.
    const halfHeightAtDistance = framing.distance * Math.tan(Math.PI / 6);
    expect(halfHeightAtDistance).toBeGreaterThanOrEqual(COLONIA.z / 2 - 0.001);
    // And it is the tighter of the two directions, so it touches exactly.
    expect(halfHeightAtDistance).toBeCloseTo(COLONIA.z / 2, 3);
  });

  it('fits a sphere around the systems from an angle', () => {
    const framing = frameSystems({ coordinatesList: [SOL, COLONIA], viewName: 'angled', ...viewSettings });
    const radius = Math.hypot(COLONIA.x, COLONIA.y, COLONIA.z) / 2;
    expect(framing.distance).toBeCloseTo(radius / Math.sin(Math.PI / 6), 3);
  });

  it('needs at least one system', () => {
    expect(() => frameSystems({ coordinatesList: [], viewName: 'angled', ...viewSettings })).toThrow(/at least one/);
  });
});

describe('highlight commands', () => {
  it('accepts a route of named systems', () => {
    expect(() => validateCommand({
      type: COMMAND_TYPES.highlightSystems,
      systems: [{ name: 'Sol', coordinates: SOL }, { name: 'Colonia', coordinates: COLONIA }],
      asRoute: true,
      frame: true,
      view: 'topDown',
    })).not.toThrow();
  });

  it('rejects systems without usable coordinates, naming the system', () => {
    expect(() => validateCommand({ type: COMMAND_TYPES.highlightSystems, systems: [{ name: 'Nowhere', coordinates: { x: 1, y: 2 } }] }))
      .toThrow(/system 0 \(Nowhere\) needs coordinates/);
    expect(() => validateCommand({ type: COMMAND_TYPES.highlightSystems, systems: 'Sol' })).toThrow(/array/);
  });

  it('rejects unknown views on camera moves', () => {
    expect(() => validateCommand({ type: COMMAND_TYPES.moveCamera, view: 'sideways' })).toThrow(/Unknown camera view/);
  });
});

describe('naming rules in highlight commands', () => {
  it('accepts true, false and ifRoom, and rejects anything else', () => {
    const systems = [{ name: 'Sol', coordinates: SOL, showName: true }, { name: 'Colonia', coordinates: COLONIA, showName: 'ifRoom' }];
    for (const showNames of [true, false, 'ifRoom']) {
      expect(() => validateCommand({ type: COMMAND_TYPES.highlightSystems, systems, showNames })).not.toThrow();
    }
    expect(() => validateCommand({ type: COMMAND_TYPES.highlightSystems, systems, showNames: 'sometimes' })).toThrow(/true, false or 'ifRoom'/);
    expect(() => validateCommand({ type: COMMAND_TYPES.highlightSystems, systems: [{ name: 'Sol', coordinates: SOL, showName: 1 }] }))
      .toThrow(/system 0 \(Sol\) showName/);
    expect(() => validateCommand({ type: COMMAND_TYPES.highlightSystems, systems, numberStops: 'all' })).not.toThrow();
    expect(() => validateCommand({ type: COMMAND_TYPES.highlightSystems, systems, numberStops: 'every' })).toThrow(/numberStops must be 'shared', 'all' or 'none', not "every"/);
  });
});

describe('user interface settings', () => {
  it('accepts known settings as true or false', () => {
    expect(() => validateCommand({ type: COMMAND_TYPES.setUserInterface, rotate: false, panel: false, dataLoading: true })).not.toThrow();
    expect(() => validateCommand({ type: COMMAND_TYPES.setUserInterface })).not.toThrow();
  });

  it('names unknown settings and the ones that are not true or false', () => {
    expect(() => validateCommand({ type: COMMAND_TYPES.setUserInterface, spin: false }))
      .toThrow(/unknown setting "spin"; known settings are rotate, pan, zoom/);
    expect(() => validateCommand({ type: COMMAND_TYPES.setUserInterface, zoom: 'no' }))
      .toThrow(/setting "zoom" must be true or false/);
  });
});
