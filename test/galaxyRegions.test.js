import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GalaxyRegions } from '../src/galaxyRegions.js';

const regions = new GalaxyRegions(JSON.parse(readFileSync(new URL('../assets/galaxy-regions.json', import.meta.url), 'utf8')));
const regionNameAt = coordinates => regions.regionAt(coordinates)?.name ?? null;

describe('GalaxyRegions', () => {
    it('has the 42 regions, numbered as in the codex', () => {
        expect(regions.allRegions).toHaveLength(42);
        expect(regions.allRegions[0]).toMatchObject({ number: 1, name: 'Galactic Centre' });
        expect(regions.allRegions[41]).toMatchObject({ number: 42, name: 'The Void' });
    });

    it('finds the regions of well known places', () => {
        expect(regionNameAt({ x: 0, y: 0, z: 0 })).toBe('Inner Orion Spur');
        expect(regionNameAt({ x: 25.21875, y: -20.90625, z: 25899.96875 })).toBe('Galactic Centre');
        expect(regionNameAt({ x: -9530.5, y: -910.28125, z: 19808.125 })).toBe('Inner Scutum-Centaurus Arm');
        expect(regionNameAt({ x: -1111.5625, y: -134.21875, z: 65269.75 })).toBe('The Abyss');
    });

    it('ignores height: a region covers everything above and below it', () => {
        expect(regionNameAt({ x: 0, y: 5000, z: 0 })).toBe('Inner Orion Spur');
        expect(regionNameAt({ x: 0, y: -5000, z: 0 })).toBe('Inner Orion Spur');
    });

    it('gives null outside the map', () => {
        expect(regionNameAt({ x: -60000, y: 0, z: 0 })).toBeNull();
        expect(regionNameAt({ x: 0, y: 0, z: 90000 })).toBeNull();
    });

    it('works in the game\'s cells of 4096 / 83 ly, from its corner at -49985, -24105', () => {
        expect(regions.cellSizeInLightYears).toBeCloseTo(49.3494, 4);
        // The map's corner cell is outside every region; the cell edge falls
        // exactly on the corner, as in the game.
        expect(regions.regionAt({ x: -49985, y: 0, z: -24105 })).toBeNull();
        expect(regions.regionAt({ x: -49985.01, y: 0, z: -24105 })).toBeNull();
    });

    it('puts each name inside its own region', () => {
        for (const region of regions.allRegions) {
            expect(regions.regionAt({ x: region.labelX, y: 0, z: region.labelZ })?.number).toBe(region.number);
        }
    });
});
