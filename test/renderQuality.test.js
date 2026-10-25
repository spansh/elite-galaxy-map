import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
    DETAIL_EASE_IN_MILLISECONDS, STILL_DELAY_MILLISECONDS, cameraMovedVisibly, chooseRenderQuality,
} from '../src/renderQuality.js';

const settings = { starBudget: 2000000, starBudgetWhileMoving: 1000000, reducedResolutionScale: 0.5 };

function cameraAt(distance, turnRadians = 0) {
    return {
        position: new Vector3(0, 0, distance),
        quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turnRadians),
        aspect: 1.5,
        fov: 60,
    };
}

describe('cameraMovedVisibly', () => {
    const target = new Vector3(0, 0, 0);

    it('ignores the tiny steps at the end of a zoom or turn', () => {
        // 0.05% closer, as the last of a trackpad's momentum.
        expect(cameraMovedVisibly(cameraAt(10000), cameraAt(9995), target)).toBe(false);
        expect(cameraMovedVisibly(cameraAt(10000), cameraAt(10000, 0.0001), target)).toBe(false);
    });

    it('counts a zoom, a turn or a change of lens that can be seen', () => {
        expect(cameraMovedVisibly(cameraAt(10000), cameraAt(9900), target)).toBe(true);
        expect(cameraMovedVisibly(cameraAt(10000), cameraAt(10000, 0.01), target)).toBe(true);
        expect(cameraMovedVisibly(cameraAt(10000), { ...cameraAt(10000), aspect: 2 }, target)).toBe(true);
    });

    it('does not count the first frame as movement', () => {
        expect(cameraMovedVisibly(undefined, cameraAt(10000), target)).toBe(false);
    });
});

describe('chooseRenderQuality', () => {
    it('draws at full quality if the view has never moved', () => {
        expect(chooseRenderQuality(5000, undefined, settings)).toEqual({
            isMoving: false, resolutionScale: 1, starBudget: 2000000, isEasingIn: false,
        });
    });

    it('draws the moving quality until the view has been still for a moment', () => {
        const quality = chooseRenderQuality(1000 + STILL_DELAY_MILLISECONDS - 1, 1000, settings);
        expect(quality.isMoving).toBe(true);
        expect(quality.resolutionScale).toBe(0.5);
        expect(quality.starBudget).toBe(1000000);
    });

    it('then goes to full resolution at once and brings the extra stars in gradually', () => {
        const stoppedAt = 1000 + STILL_DELAY_MILLISECONDS;
        const atStart = chooseRenderQuality(stoppedAt, 1000, settings);
        expect(atStart).toEqual({ isMoving: false, resolutionScale: 1, starBudget: 1000000, isEasingIn: true });
        const halfway = chooseRenderQuality(stoppedAt + DETAIL_EASE_IN_MILLISECONDS / 2, 1000, settings);
        expect(halfway.starBudget).toBeCloseTo(1500000);
        expect(halfway.isEasingIn).toBe(true);
        const done = chooseRenderQuality(stoppedAt + DETAIL_EASE_IN_MILLISECONDS, 1000, settings);
        expect(done.starBudget).toBe(2000000);
        expect(done.isEasingIn).toBe(false);
    });
});
