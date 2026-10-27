import { describe, expect, it } from 'vitest';
import { chooseRingsToDraw, placeLabels } from '../src/labelPlacement.js';

function labelAt(anchorX, anchorY, isFixed = false) {
  return { anchorX, anchorY, gapFromAnchor: 10, width: 100, height: 16, isFixed };
}

describe('placeLabels', () => {
  it('leaves labels that do not touch where they are', () => {
    const placements = placeLabels([labelAt(0, 0), labelAt(0, 200)]);
    expect(placements).toEqual([{ isShown: true, verticalOffset: 0 }, { isShown: true, verticalOffset: 0 }]);
  });

  it('moves a later label off an earlier one at the same spot', () => {
    const [first, second] = placeLabels([labelAt(0, 0), labelAt(5, 3)]);
    expect(first.verticalOffset).toBe(0);
    expect(second.isShown).toBe(true);
    expect(Math.abs(3 + second.verticalOffset)).toBeGreaterThanOrEqual(16);
  });

  it('never moves a fixed label, and moves the next one around it', () => {
    const [fixed, other] = placeLabels([labelAt(0, 0, true), labelAt(0, 0)]);
    expect(fixed).toEqual({ isShown: true, verticalOffset: 0 });
    expect(other.isShown).toBe(true);
    expect(other.verticalOffset).not.toBe(0);
  });

  it('avoids obstacles such as other systems\' rings', () => {
    const ring = { left: 20, right: 40, bottom: -10, top: 10 };
    const [placement] = placeLabels([labelAt(0, 0)], [ring]);
    expect(placement.isShown).toBe(true);
    expect(placement.verticalOffset).not.toBe(0);
  });

  it('hides a label that finds no free spot nearby', () => {
    const crowd = Array.from({ length: 9 }, () => labelAt(0, 0));
    const placements = placeLabels(crowd);
    expect(placements.filter(placement => placement.isShown)).toHaveLength(7);
    expect(placements.at(-1).isShown).toBe(false);
  });
});

describe('chooseRingsToDraw', () => {
  it('draws rings that are apart and skips later ones that overlap', () => {
    const drawn = chooseRingsToDraw([
      { x: 0, y: 0, radius: 5 },
      { x: 6, y: 0, radius: 5 },
      { x: 30, y: 0, radius: 5 },
    ]);
    expect(drawn).toEqual([true, false, true]);
  });

  it('keeps the earlier ring when two overlap, whatever their sizes', () => {
    const drawn = chooseRingsToDraw([{ x: 100, y: 100, radius: 8 }, { x: 110, y: 100, radius: 5 }]);
    expect(drawn).toEqual([true, false]);
  });

  it('thins a long line of crowded rings to evenly spaced ones', () => {
    const rings = Array.from({ length: 400 }, (unused, index) => ({ x: index, y: 50, radius: 5 }));
    const drawn = chooseRingsToDraw(rings);
    const drawnPositions = rings.filter((ring, index) => drawn[index]).map(ring => ring.x);
    expect(drawnPositions.length).toBe(40);
    expect(drawnPositions.slice(0, 3)).toEqual([0, 10, 20]);
  });
});

describe('placeLabels with optional names', () => {
  it('shows an optional label only in its usual spot', () => {
    const optionalLabel = { ...labelAt(0, 0), canMove: false };
    const [first, second] = placeLabels([labelAt(0, 0), optionalLabel]);
    expect(first.isShown).toBe(true);
    expect(second).toEqual({ isShown: false, verticalOffset: 0 });
    const [alone] = placeLabels([optionalLabel]);
    expect(alone).toEqual({ isShown: true, verticalOffset: 0 });
  });

  it('fits in as many optional labels along a line as have room', () => {
    // Stops 5 pixels apart up the screen; labels are 16 pixels tall.
    const stops = Array.from({ length: 40 }, (unused, index) => ({ ...labelAt(0, index * 5), canMove: false }));
    const shown = placeLabels(stops).filter(placement => placement.isShown).length;
    expect(shown).toBe(10);
  });
});
