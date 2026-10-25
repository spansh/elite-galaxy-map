import { describe, expect, it } from 'vitest';
import { placeArrowOnLeg } from '../src/RouteArrows.js';

describe('placeArrowOnLeg', () => {
    it('points an arrow up the screen for a leg going up', () => {
        const placement = placeArrowOnLeg({ x: 100, y: 100 }, { x: 100, y: 300 });
        expect(placement.isShown).toBe(true);
        expect(placement.angle).toBeCloseTo(0);
    });

    it('turns the arrow to follow legs going right, left and down', () => {
        // Angles are anticlockwise from up, so right is a quarter turn clockwise.
        expect(placeArrowOnLeg({ x: 0, y: 0 }, { x: 200, y: 0 }).angle).toBeCloseTo(-Math.PI / 2);
        expect(placeArrowOnLeg({ x: 0, y: 0 }, { x: -200, y: 0 }).angle).toBeCloseTo(Math.PI / 2);
        expect(Math.abs(placeArrowOnLeg({ x: 0, y: 0 }, { x: 0, y: -200 }).angle)).toBeCloseTo(Math.PI);
    });

    it('leaves out the arrow on a leg too short on screen', () => {
        expect(placeArrowOnLeg({ x: 0, y: 0 }, { x: 20, y: 10 }).isShown).toBe(false);
    });
});
