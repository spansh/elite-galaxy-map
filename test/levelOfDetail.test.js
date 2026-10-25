import { describe, expect, it } from 'vitest';
import { chooseStarsToDraw, fadeForSample, hasGrownEnoughToShuffle, orderCellsForShuffling } from '../src/levelOfDetail.js';

const settings = { maximumStarsPerPixel: 1, starBudget: 1000000 };

function cell(systemCount, widthOnScreen, { shuffledCount = systemCount, cameraIsInside = false } = {}) {
    return { systemCount, shuffledCount, widthOnScreen, cameraIsInside };
}

describe('chooseStarsToDraw', () => {
    it('draws every star of a cell that has room on screen for them', () => {
        expect(chooseStarsToDraw([cell(5000, 100)], settings)).toEqual([{ drawCount: 5000, brightnessCompensation: 1 }]);
    });

    it('samples a crowded far cell down to about one star per pixel, brighter to match', () => {
        const [choice] = chooseStarsToDraw([cell(20000, 50)], settings);
        expect(choice.drawCount).toBe(2500);
        expect(choice.brightnessCompensation).toBeCloseTo(8);
    });

    it('changes the sample smoothly as a cell gets smaller on screen', () => {
        const counts = [50, 49, 48, 47].map(width => chooseStarsToDraw([cell(20000, width)], settings)[0].drawCount);
        expect(counts).toEqual([2500, 2401, 2304, 2209]);
    });

    it('draws at least one in 32 stars, so none is brightened more than 32 times', () => {
        const [choice] = chooseStarsToDraw([cell(200000, 50)], settings);
        expect(choice.drawCount).toBe(6250);
        expect(choice.brightnessCompensation).toBeCloseTo(32);
    });

    it('draws everything when the camera is inside the cell, or the cell is not shuffled yet', () => {
        expect(chooseStarsToDraw([cell(200000, 50, { cameraIsInside: true })], settings)[0].drawCount).toBe(200000);
        expect(chooseStarsToDraw([cell(200000, 50, { shuffledCount: 0 })], settings)[0].drawCount).toBe(200000);
    });

    it('only samples from the shuffled stars, brightening the sample to stand for those alone', () => {
        // 2,500 wanted from the whole cell; half of it shuffled, so 1,250
        // from that half, each standing for 8 shuffled stars. The other
        // half waits to be shuffled in rather than brightening this one.
        const [choice] = chooseStarsToDraw([cell(20000, 50, { shuffledCount: 10000 })], settings);
        expect(choice.drawCount).toBe(1250);
        expect(choice.brightnessCompensation).toBeCloseTo(8);
        expect(fadeForSample(1250, 20000, 10000).brightnessCompensation).toBeCloseTo(10000 / 1562.5);
    });

    it('draws every star of a cell with too many still waiting to be shuffled in', () => {
        // Under half shuffled: a sample of them would leave holes where the rest are.
        expect(chooseStarsToDraw([cell(20000, 50, { shuffledCount: 9000 })], settings)[0])
            .toEqual({ drawCount: 20000, brightnessCompensation: 1 });
        expect(chooseStarsToDraw([cell(20000, 50, { shuffledCount: 1000 })], settings)[0].drawCount).toBe(20000);
    });

    it('cuts sampled cells by the same proportion to keep within the budget', () => {
        const cells = [cell(4000000, 2000), cell(4000000, 2000), cell(300000, 10, { cameraIsInside: true })];
        const choices = chooseStarsToDraw(cells, { maximumStarsPerPixel: 1, starBudget: 2300000 });
        // The cell the camera is in can't be cut; the other two share what's left.
        expect(choices[2].drawCount).toBe(300000);
        expect(choices[0].drawCount).toBe(1000000);
        expect(choices[1].drawCount).toBe(1000000);
    });

    it('never cuts a cell below a few dozen stars, so its shape still shows', () => {
        const [choice] = chooseStarsToDraw([cell(1000, 0.5)], settings);
        expect(choice.drawCount).toBe(64);
    });
});

describe('fadeForSample', () => {
    it('fades the last stars of a sample out over half as many again', () => {
        const fade = fadeForSample(1000, 20000, 20000);
        expect(fade).toEqual({ fadeStart: 1000, fadeEnd: 1500, brightnessCompensation: 16 });
    });

    it('stops the fade at the end of the shuffled stars', () => {
        expect(fadeForSample(1000, 20000, 1200).fadeEnd).toBe(1200);
    });

    it('needs no fade or brightening when every star is drawn', () => {
        expect(fadeForSample(20000, 20000, 0)).toEqual({ fadeStart: 20000, fadeEnd: 20000, brightnessCompensation: 1 });
    });
});

describe('chooseStarsToDraw with hidden layers', () => {
    const settings = { maximumStarsPerPixel: 1, starBudget: 1e9 };

    it('draws more of a cell whose visible stars are a small share, to show as many of them', () => {
        const allVisible = { systemCount: 100000, shuffledCount: 100000, widthOnScreen: 100, cameraIsInside: false };
        const quarterVisible = { ...allVisible, visibleCount: 25000 };
        const [whole, quarter] = chooseStarsToDraw([allVisible, quarterVisible], settings);
        expect(whole.drawCount).toBe(10000);
        expect(quarter.drawCount).toBe(40000);
        expect(quarter.brightnessCompensation).toBe(2.5);
    });

    it('draws nothing from a cell with no visible stars', () => {
        const [choice] = chooseStarsToDraw([{ systemCount: 5000, shuffledCount: 5000, visibleCount: 0, widthOnScreen: 10, cameraIsInside: false }], settings);
        expect(choice).toEqual({ drawCount: 0, brightnessCompensation: 1 });
        expect(fadeForSample(0, 5000, 5000)).toEqual({ fadeStart: 0, fadeEnd: 0, brightnessCompensation: 1 });
    });
});

describe('shuffling cells in while data loads', () => {
    const waitingCell = (name, shuffledCount, unshuffledCount, wasOnScreen) => ({ name, shuffledCount, unshuffledCount, wasOnScreen });

    it('takes cells on screen first, then those with most waiting for their size, and skips settled ones', () => {
        const cells = [
            waitingCell('off screen, half waiting', 1000, 500, false),
            waitingCell('settled', 1000, 0, true),
            waitingCell('on screen, a tenth waiting', 100000, 10000, true),
            waitingCell('on screen, all waiting', 0, 2000, true),
            waitingCell('off screen, a fifth waiting', 1000, 200, false),
        ];
        expect(orderCellsForShuffling(cells).map(cell => cell.name)).toEqual([
            'on screen, all waiting',
            'on screen, a tenth waiting',
            'off screen, half waiting',
            'off screen, a fifth waiting',
        ]);
    });

    it('shuffles a cell again once a quarter as many again are waiting, and at least a thousand or so', () => {
        expect(hasGrownEnoughToShuffle({ shuffledCount: 100000, unshuffledCount: 24999 })).toBe(false);
        expect(hasGrownEnoughToShuffle({ shuffledCount: 100000, unshuffledCount: 25000 })).toBe(true);
        expect(hasGrownEnoughToShuffle({ shuffledCount: 100, unshuffledCount: 500 })).toBe(false);
        expect(hasGrownEnoughToShuffle({ shuffledCount: 100, unshuffledCount: 1024 })).toBe(true);
    });
});
