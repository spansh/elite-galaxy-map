import { describe, expect, it } from 'vitest';
import { gaussianBlur, medianFilter } from '../scripts/densityMapFilters.mjs';

function imageWith(imageSize, valueAt) {
  const values = new Float32Array(imageSize * imageSize);
  for (let row = 0; row < imageSize; row++) {
    for (let column = 0; column < imageSize; column++) {
      values[row * imageSize + column] = valueAt(row, column);
    }
  }
  return values;
}

describe('medianFilter', () => {
  it('removes a one pixel wide bright line but keeps a wide bright area', () => {
    const imageSize = 20;
    // A line down column 3, and a solid block in the bottom right corner.
    const values = imageWith(imageSize, (row, column) => (column === 3 || (row >= 10 && column >= 10) ? 5 : 1));
    const filtered = medianFilter(values, imageSize, 2);
    expect(filtered[5 * imageSize + 3]).toBe(1);
    expect(filtered[15 * imageSize + 15]).toBe(5);
  });

  it('leaves the image alone with radius 0', () => {
    const values = Float32Array.from([1, 2, 3, 4]);
    expect([...medianFilter(values, 2, 0)]).toEqual([1, 2, 3, 4]);
  });
});

describe('gaussianBlur', () => {
  it('spreads a single bright pixel out while keeping its total brightness', () => {
    const imageSize = 21;
    const values = imageWith(imageSize, (row, column) => (row === 10 && column === 10 ? 100 : 0));
    const blurred = gaussianBlur(values, imageSize, 1.5);
    const total = blurred.reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(100, 3);
    expect(blurred[10 * imageSize + 10]).toBeLessThan(100);
    expect(blurred[10 * imageSize + 11]).toBeGreaterThan(0);
  });
});
