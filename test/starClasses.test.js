import { describe, expect, it } from 'vitest';
import { STAR_CLASS_LAYERS, layerForMainStar } from '../examples/spansh-loader/starClasses.js';

describe('layerForMainStar', () => {
    it('sorts ordinary stars by spectral letter, giants included', () => {
        expect(layerForMainStar('K (Yellow-Orange) Star').layer).toBe('class-k');
        expect(layerForMainStar('K (Yellow-Orange giant) Star').layer).toBe('class-k');
        expect(layerForMainStar('M (Red super giant) Star').layer).toBe('class-m');
        expect(layerForMainStar('O (Blue-White) Star').layer).toBe('class-o');
        expect(layerForMainStar('G (White-Yellow super giant) Star').layer).toBe('class-g');
        expect(layerForMainStar('Y (Brown dwarf) Star').layer).toBe('class-y');
    });

    it('keeps T Tauri stars out of the T brown dwarfs', () => {
        expect(layerForMainStar('T (Brown dwarf) Star').layer).toBe('class-t');
        expect(layerForMainStar('T Tauri Star').layer).toBe('young');
        expect(layerForMainStar('Herbig Ae/Be Star').layer).toBe('young');
    });

    it('groups the special classes', () => {
        expect(layerForMainStar('White Dwarf (DAV) Star').layer).toBe('white-dwarf');
        expect(layerForMainStar('Wolf-Rayet NC Star').layer).toBe('wolf-rayet');
        expect(layerForMainStar('CN Star').layer).toBe('carbon');
        expect(layerForMainStar('C Star').layer).toBe('carbon');
        expect(layerForMainStar('MS-type Star').layer).toBe('s-type');
        expect(layerForMainStar('S-type Star').layer).toBe('s-type');
        expect(layerForMainStar('Neutron Star').layer).toBe('neutron');
        expect(layerForMainStar('Supermassive Black Hole').layer).toBe('black-hole');
        expect(layerForMainStar('Black Hole').layer).toBe('black-hole');
    });

    it('puts anything unknown or missing in other', () => {
        expect(layerForMainStar(undefined).layer).toBe('other');
        expect(layerForMainStar('').layer).toBe('other');
        expect(layerForMainStar('Rogue Planet').layer).toBe('other');
    });

    it('gives every layer a different name and order', () => {
        const layers = Object.values(STAR_CLASS_LAYERS);
        expect(new Set(layers.map(layer => layer.layer)).size).toBe(layers.length);
        expect(new Set(layers.map(layer => layer.order)).size).toBe(layers.length);
    });
});
