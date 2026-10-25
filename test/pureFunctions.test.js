import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { galacticToScene, sceneToGalactic } from '../src/coordinates.js';
import { chooseLabelledGridSpacing, formatGridCoordinates, nearestGridCorner } from '../src/gridMaths.js';
import { COMMAND_TYPES, validateCommand } from '../src/commands.js';

describe('coordinates', () => {
    it('negates z between galactic and scene coordinates, and back', () => {
        const scenePosition = galacticToScene({ x: 25.2, y: -20.9, z: 25900 });
        expect(scenePosition.toArray()).toEqual([25.2, -20.9, -25900]);
        expect(sceneToGalactic(new Vector3(1, 2, -3))).toEqual({ x: 1, y: 2, z: 3 });
    });
});

describe('grid label maths', () => {
    it('labels the finest grid whose squares are wide enough for text', () => {
        // 2 pixels per light year: 100 ly squares are 200 px wide.
        expect(chooseLabelledGridSpacing(2)).toBe(100);
        expect(chooseLabelledGridSpacing(0.5)).toBe(1000);
        // Too far out for any grid to fit; the coarsest is used.
        expect(chooseLabelledGridSpacing(0.000001)).toBe(10000);
    });

    it('finds the nearest grid corner and never says -0', () => {
        expect(nearestGridCorner(140, -160, 100)).toEqual({ x: 100, z: -200 });
        expect(Object.is(nearestGridCorner(-20, -20, 100).x, 0)).toBe(true);
        expect(formatGridCoordinates(-0.2, 0, 25000.4)).toBe('0 : 0 : 25000');
    });
});

describe('commands', () => {
    it('accepts a well formed addSystems command', () => {
        expect(() => validateCommand({
            type: COMMAND_TYPES.addSystems, layer: 'neutron', positions: new Float32Array(6), names: 'Sol\nAchenar',
        })).not.toThrow();
    });

    it('names unknown command types', () => {
        expect(() => validateCommand({ type: 'addStars' })).toThrow(/Unknown galaxy map command type "addStars"/);
        expect(() => validateCommand(null)).toThrow(TypeError);
    });

    it('rejects layer commands without a layer name', () => {
        expect(() => validateCommand({ type: COMMAND_TYPES.clearLayer })).toThrow(/needs a layer name/);
    });

    it('rejects names that do not match the positions', () => {
        const positions = new Float32Array(9);
        expect(() => validateCommand({ type: COMMAND_TYPES.addSystems, layer: 'a', positions, names: ['one', 'two'] }))
            .toThrow(/3 positions but 2 names/);
        expect(() => validateCommand({ type: COMMAND_TYPES.addSystems, layer: 'a', positions, names: 'one\ntwo' }))
            .toThrow(/3 positions but 2 newline-separated names/);
        expect(() => validateCommand({ type: COMMAND_TYPES.addSystems, layer: 'a', positions: new Float32Array(4) }))
            .toThrow(/multiple of 3/);
    });

    it('rejects values the camera, tone mapping or grid would turn into NaN', () => {
        const rejected = [
            { type: COMMAND_TYPES.moveCamera, target: { x: 1, y: 2 } },
            { type: COMMAND_TYPES.moveCamera, distance: 0 },
            { type: COMMAND_TYPES.selectSystem, system: { name: 'Sol' } },
            { type: COMMAND_TYPES.setLayerVisibility, layer: 'a' },
            { type: COMMAND_TYPES.setExposure },
            { type: COMMAND_TYPES.setGridHeight, y: '10' },
            { type: COMMAND_TYPES.setBackdrop, style: 'particles' },
            { type: COMMAND_TYPES.setBackdrop, showGalaxyImage: 'yes' },
        ];
        for (const command of rejected) {
            expect(() => validateCommand(command), JSON.stringify(command)).toThrow(new RegExp(`^${command.type} needs`));
        }
    });

    it('accepts the same commands with good values, or with optional fields left out', () => {
        const accepted = [
            { type: COMMAND_TYPES.moveCamera, view: 'topDown' },
            { type: COMMAND_TYPES.moveCamera, target: { x: 0, y: 0, z: 0 }, distance: 500 },
            { type: COMMAND_TYPES.selectSystem, system: null },
            { type: COMMAND_TYPES.selectSystem, system: { name: 'Sol', coordinates: { x: 0, y: 0, z: 0 } }, flyTo: false },
            { type: COMMAND_TYPES.setLayerVisibility, layer: 'a', visible: false },
            { type: COMMAND_TYPES.setExposure, exposure: 1.5 },
            { type: COMMAND_TYPES.setGridHeight, y: -20 },
            { type: COMMAND_TYPES.setBackdrop, showGalaxyImage: false },
        ];
        for (const command of accepted) {
            expect(() => validateCommand(command), JSON.stringify(command)).not.toThrow();
        }
    });
});
