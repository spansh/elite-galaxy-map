import { describe, expect, it } from 'vitest';
import { BoxelPopulationEstimator, boxelSizeInLightYears, decodeId64, id64FromLine } from '../scripts/id64Density.mjs';

// Builds an id64 from its parts, the reverse of decodeId64.
function encodeId64({ massCode, boxel, sector, indexInBoxel, bodyId = 0 }) {
  const boxelBits = BigInt(7 - massCode);
  let id64 = BigInt(bodyId);
  const append = (value, bitCount) => {
    id64 = (id64 << BigInt(bitCount)) | BigInt(value);
  };
  append(indexInBoxel, 11 + 3 * massCode);
  append(sector.x, 7);
  append(boxel.x, boxelBits);
  append(sector.y, 6);
  append(boxel.y, boxelBits);
  append(sector.z, 7);
  append(boxel.z, boxelBits);
  append(massCode, 3);
  return id64;
}

describe('decodeId64', () => {
  it('places real systems inside the boxel their id64 names', () => {
    // From the exact plotter route: Sol, and Beagle Point.
    for (const [id64, coordinates] of [
      [10477373803n, { x: 0, y: 0, z: 0 }],
      [81973396946n, { x: -1111.5625, y: -134.21875, z: 65269.75 }],
    ]) {
      const decoded = decodeId64(id64);
      for (const axis of ['x', 'y', 'z']) {
        expect(coordinates[axis]).toBeGreaterThanOrEqual(decoded.boxelCorner[axis]);
        expect(coordinates[axis]).toBeLessThanOrEqual(decoded.boxelCorner[axis] + decoded.boxelSize);
      }
      expect(decoded.bodyId).toBe(0);
    }
  });

  it('reads back every part it was built from, beyond 2^53', () => {
    const parts = { massCode: 7, boxel: { x: 0, y: 0, z: 0 }, sector: { x: 100, y: 50, z: 120 }, indexInBoxel: 30000, bodyId: 400 };
    const id64 = encodeId64(parts);
    expect(id64 > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(decodeId64(id64)).toMatchObject(parts);
    expect(decodeId64(id64.toString())).toMatchObject(parts);
  });

  it('decodes text and BigInt the same way, for random id64s across the whole range', () => {
    let seed = 12345n;
    const nextRandom64 = () => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
      return seed;
    };
    for (let trial = 0; trial < 2000; trial++) {
      const id64 = nextRandom64();
      // Compare with a plain BigInt reading of the same fields.
      let remaining = id64;
      const takeBits = bitCount => {
        const value = Number(remaining & ((1n << BigInt(bitCount)) - 1n));
        remaining >>= BigInt(bitCount);
        return value;
      };
      const massCode = takeBits(3);
      const boxelBits = 7 - massCode;
      const expected = { massCode, boxel: {}, sector: {} };
      expected.boxel.z = takeBits(boxelBits);
      expected.sector.z = takeBits(7);
      expected.boxel.y = takeBits(boxelBits);
      expected.sector.y = takeBits(6);
      expected.boxel.x = takeBits(boxelBits);
      expected.sector.x = takeBits(7);
      expected.indexInBoxel = takeBits(11 + 3 * massCode);
      expected.bodyId = takeBits(9);
      expect(decodeId64(id64.toString())).toMatchObject(expected);
      expect(decodeId64(id64)).toMatchObject(expected);
    }
  });

  it('finds the id64 in a dump line as text, keeping every digit', () => {
    expect(id64FromLine('{"id64":18446744073709551615,"name":"X"}')).toBe('18446744073709551615');
    expect(id64FromLine('{"name":"No id"}')).toBeNull();
  });
});

describe('BoxelPopulationEstimator', () => {
  const sector = { x: 39, y: 32, z: 18 };

  it('estimates each boxel from its highest index, however often it was visited', () => {
    const estimator = new BoxelPopulationEstimator([3]);
    // Ten visits to one boxel, the highest index being 99, so at least 100 systems.
    for (let indexInBoxel = 90; indexInBoxel < 100; indexInBoxel++) {
      estimator.addSystem(decodeId64(encodeId64({ massCode: 3, boxel: { x: 0, y: 0, z: 0 }, sector, indexInBoxel })));
    }
    // One visit to another boxel, index 99 as well.
    estimator.addSystem(decodeId64(encodeId64({ massCode: 3, boxel: { x: 5, y: 0, z: 5 }, sector, indexInBoxel: 99 })));
    const boxels = [...estimator.boxelsByMassCode.get(3).values()];
    expect(boxels).toEqual([100, 100]);
  });

  it('turns boxel estimates into density per pixel, averaging rather than adding', () => {
    const estimator = new BoxelPopulationEstimator([3]);
    const boxelSize = boxelSizeInLightYears(3);
    // Two neighbouring boxels in the same column of pixels, 200 and 400 systems.
    estimator.addSystem(decodeId64(encodeId64({ massCode: 3, boxel: { x: 0, y: 0, z: 0 }, sector, indexInBoxel: 199 })));
    estimator.addSystem(decodeId64(encodeId64({ massCode: 3, boxel: { x: 0, y: 1, z: 0 }, sector, indexInBoxel: 399 })));
    const corner = decodeId64(encodeId64({ massCode: 3, boxel: { x: 0, y: 0, z: 0 }, sector, indexInBoxel: 0 })).boxelCorner;
    // One pixel per boxel width, centred so the boxels fall in one pixel.
    const imageSize = 16;
    const centredArea = { centreX: corner.x + boxelSize * imageSize / 2, centreZ: corner.z + boxelSize - boxelSize * imageSize / 2, widthInLightYears: boxelSize * imageSize };
    const density = estimator.densityPerPixel(imageSize, centredArea);
    const nonEmpty = [...density].filter(value => value > 0);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toBeCloseTo(300 / boxelSize ** 3, 12);
  });

  it('ignores mass codes it was not asked for', () => {
    const estimator = new BoxelPopulationEstimator([3, 4]);
    const added = estimator.addSystem(decodeId64(encodeId64({ massCode: 0, boxel: { x: 1, y: 1, z: 1 }, sector, indexInBoxel: 5 })));
    expect(added).toBe(false);
  });
});
