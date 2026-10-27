// Image filters used by build-density-map.mjs. Each takes a square grid of
// values (one per pixel, row by row) and returns a new one the same size.

// Replaces every pixel with the middle value of the square of pixels around
// it (radius 2 means a 5 x 5 square). A thin line, such as a heavily
// travelled route, is a minority in every square it passes through, so it
// vanishes; an area wider than the square, such as a spiral arm or the core,
// is the majority, so it keeps its brightness and its edges.
export function medianFilter(values, imageSize, radius) {
  if (radius <= 0) {
    return Float32Array.from(values);
  }
  const filtered = new Float32Array(values.length);
  const neighbourhood = new Float32Array((radius * 2 + 1) ** 2);
  for (let row = 0; row < imageSize; row++) {
    for (let column = 0; column < imageSize; column++) {
      let neighbourCount = 0;
      for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
        const neighbourRow = row + rowOffset;
        if (neighbourRow < 0 || neighbourRow >= imageSize) {
          continue;
        }
        for (let columnOffset = -radius; columnOffset <= radius; columnOffset++) {
          const neighbourColumn = column + columnOffset;
          if (neighbourColumn < 0 || neighbourColumn >= imageSize) {
            continue;
          }
          neighbourhood[neighbourCount++] = values[neighbourRow * imageSize + neighbourColumn];
        }
      }
      const neighbours = neighbourhood.subarray(0, neighbourCount).sort();
      filtered[row * imageSize + column] = neighbours[Math.floor(neighbourCount / 2)];
    }
  }
  return filtered;
}

// Gaussian blur, done as one pass across and one pass down. radius is the
// standard deviation in pixels. Pixels past the edge count as empty.
export function gaussianBlur(values, imageSize, radius) {
  if (radius <= 0) {
    return Float32Array.from(values);
  }
  const kernelHalfWidth = Math.ceil(radius * 3);
  const weights = [];
  let weightTotal = 0;
  for (let offset = -kernelHalfWidth; offset <= kernelHalfWidth; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * radius * radius));
    weights.push(weight);
    weightTotal += weight;
  }
  const normalisedWeights = weights.map(weight => weight / weightTotal);

  const blurAlongOneAxis = (sourceValues, isAcross) => {
    const blurred = new Float32Array(sourceValues.length);
    for (let row = 0; row < imageSize; row++) {
      for (let column = 0; column < imageSize; column++) {
        let sum = 0;
        for (let offset = -kernelHalfWidth; offset <= kernelHalfWidth; offset++) {
          const sampleRow = isAcross ? row : row + offset;
          const sampleColumn = isAcross ? column + offset : column;
          if (sampleRow < 0 || sampleRow >= imageSize || sampleColumn < 0 || sampleColumn >= imageSize) {
            continue;
          }
          sum += sourceValues[sampleRow * imageSize + sampleColumn] * normalisedWeights[offset + kernelHalfWidth];
        }
        blurred[row * imageSize + column] = sum;
      }
    }
    return blurred;
  };
  return blurAlongOneAxis(blurAlongOneAxis(values, true), false);
}
