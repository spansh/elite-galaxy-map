import { describe, expect, it } from 'vitest';
import { fractionInSpaceForFractionOnScreen, placeArrowOnLeg } from '../src/RouteArrows.js';

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

describe('placeArrowOnLeg on a leg travelled both ways', () => {
  it('keeps an ordinary leg\'s arrow half way along', () => {
    expect(placeArrowOnLeg({ x: 0, y: 0 }, { x: 200, y: 0 }).fractionAlongLeg).toBe(0.5);
  });

  it('moves each arrow one arrow length towards its own leg\'s end, so going and coming back sit apart', () => {
    const going = placeArrowOnLeg({ x: 0, y: 0 }, { x: 200, y: 0 }, { isTravelledBothWays: true });
    const comingBack = placeArrowOnLeg({ x: 200, y: 0 }, { x: 0, y: 0 }, { isTravelledBothWays: true });
    // Arrows are 16 pixels long: 116 pixels from the start going, 84 coming back.
    expect(going.fractionAlongLeg * 200).toBeCloseTo(116);
    expect(200 - comingBack.fractionAlongLeg * 200).toBeCloseTo(84);
  });

  it('leaves out the arrows on a leg too short to fit both apart', () => {
    expect(placeArrowOnLeg({ x: 0, y: 0 }, { x: 56, y: 0 }).isShown).toBe(true);
    expect(placeArrowOnLeg({ x: 0, y: 0 }, { x: 56, y: 0 }, { isTravelledBothWays: true }).isShown).toBe(false);
  });
});

describe('fractionInSpaceForFractionOnScreen', () => {
  it('is the same fraction when both ends are as far from the camera', () => {
    expect(fractionInSpaceForFractionOnScreen(0.58, 100, 100)).toBeCloseTo(0.58);
  });

  it('moves towards the near end for a leg running away from the camera', () => {
    // The far end is ten times as far away, so the far part of the leg
    // is squeezed on screen: half way on screen is 1/11 of the way in space.
    expect(fractionInSpaceForFractionOnScreen(0.5, 1, 10)).toBeCloseTo(1 / 11);
    expect(fractionInSpaceForFractionOnScreen(0.5, 10, 1)).toBeCloseTo(10 / 11);
  });
});
