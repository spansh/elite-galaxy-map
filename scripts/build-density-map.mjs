#!/usr/bin/env node
// Builds a galaxy density map (a top-down PNG) from a Spansh systems dump,
// for use as the map's backdrop:
//
//     node scripts/build-density-map.mjs --input_file systems_neutron.json.gz --output_file neutron-density.png
//
//     new GalaxyMap(element, { densityMapUrl: '/neutron-density.png' });
//
// The image covers GALAXY_DENSITY_MAP_AREA, as the bundled map does, so any
// map built this way can be used without other changes. Brightness is logarithmic,
// scaled so the --bright_percentile busiest pixel is full white.
//
// How busy a pixel is can be measured two ways (--method):
//   id64   (the default) an estimate of how many systems are really there,
//          from the id64s (see id64Density.mjs): each visited system shows
//          roughly how many its whole boxel holds, so one visit to an area
//          counts as much as a thousand. Only systems of the mass codes
//          given by --mass_code are used; the small boxels of codes a to c
//          are too rarely visited to cover the galaxy.
//   count  the number of systems in the dump above that pixel. Simple, but
//          it shows where people have been: popular routes come out as
//          bright lines, and unexplored areas as dark.
//
// Progress is written to standard error as the dump is read: how much of
// the file is done, how many systems so far, and an estimate of the time
// left. On a terminal it updates one line in place; otherwise (a log file, a
// container's output) it writes a new line every 10 seconds.
//
// Options:
//   --input_file         dump to read; .gz files are unpacked as they are read
//   --output_file        PNG to write
//   --image_size         width and height in pixels (default 512)
//   --bright_percentile  percentile of occupied pixels that maps to full brightness (default 99.5)
//   --median_radius      removes thin bright lines, such as heavily travelled
//                        routes, narrower than about this many pixels; 2 is a
//                        good start at 512 pixels (default 0, off)
//   --blur_radius        softens the result with a blur this many pixels wide
//                        (default 0, off)
//   --method             id64 or count (default id64)
//   --mass_code          with --method id64, a mass code letter to use; give
//                        it once per code (default d, e, f, g and h)

import { createReadStream, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import { createGunzip, crc32, deflateSync } from 'node:zlib';
import { readLines, parseDumpLine } from '../examples/spansh-loader/readLines.js';
import { gaussianBlur, medianFilter } from './densityMapFilters.mjs';
import { BoxelPopulationEstimator, MASS_CODE_LETTERS, decodeId64, id64FromLine } from './id64Density.mjs';
import { GALAXY_DENSITY_MAP_AREA } from '../src/backdrop/densityMap.js';

const { values: options } = parseArgs({
  options: {
    input_file: { type: 'string' },
    output_file: { type: 'string' },
    image_size: { type: 'string', default: '512' },
    bright_percentile: { type: 'string', default: '99.5' },
    median_radius: { type: 'string', default: '0' },
    blur_radius: { type: 'string', default: '0' },
    method: { type: 'string', default: 'id64' },
    mass_code: { type: 'string', multiple: true, default: ['d', 'e', 'f', 'g', 'h'] },
  },
});
if (!options.input_file || !options.output_file) {
  console.error('Usage: build-density-map.mjs --input_file <dump.json[.gz]> --output_file <map.png> [--image_size 512] [--bright_percentile 99.5] [--median_radius 2] [--blur_radius 1] [--method id64|count] [--mass_code d ...]');
  process.exit(1);
}
const imageSize = Number(options.image_size);
const brightPercentile = Number(options.bright_percentile);
const medianRadius = Number(options.median_radius);
const blurRadius = Number(options.blur_radius);
const method = options.method;
if (method !== 'count' && method !== 'id64') {
  console.error(`--method must be count or id64, not ${method}`);
  process.exit(1);
}
const massCodesToUse = options.mass_code.map(letter => {
  const massCode = MASS_CODE_LETTERS.indexOf(letter.toLowerCase());
  if (massCode < 0 || letter.length !== 1) {
    console.error(`--mass_code must be a letter from a to h, not ${letter}`);
    process.exit(1);
  }
  return massCode;
});
const boxelEstimator = method === 'id64' ? new BoxelPopulationEstimator(massCodesToUse) : null;
let systemsWithoutId64 = 0;
let systemsOfOtherMassCodes = 0;

// Count systems per pixel. Row 0 is the far side of the galaxy (highest z).
const area = GALAXY_DENSITY_MAP_AREA;
const lightYearsPerPixel = area.widthInLightYears / imageSize;
const leftEdgeX = area.centreX - area.widthInLightYears / 2;
const topEdgeZ = area.centreZ + area.widthInLightYears / 2;
const systemsPerPixel = new Uint32Array(imageSize * imageSize);

function formatBytes(byteCount) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let amount = byteCount;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex++;
  }
  return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

// Reports how far through the input file reading has got. Progress is
// measured in bytes of the file on disk (packed bytes for a .gz), which is
// what the total is known for.
class ReadingProgress {
  constructor(totalBytes) {
    this.totalBytes = totalBytes;
    this.bytesRead = 0;
    this.startTime = performance.now();
    // Report straight away the first time, then at the interval.
    this.lastReportTime = -Infinity;
    this.writesInPlace = process.stderr.isTTY === true;
    this.reportIntervalMilliseconds = this.writesInPlace ? 500 : 10000;
  }

  describe(systemCount) {
    const fraction = this.totalBytes > 0 ? this.bytesRead / this.totalBytes : 0;
    const elapsedSeconds = (performance.now() - this.startTime) / 1000;
    const secondsLeft = fraction > 0 ? elapsedSeconds / fraction - elapsedSeconds : 0;
    const timeLeftText = fraction > 0.001 && fraction < 1 ? `, about ${formatDuration(secondsLeft)} left` : '';
    return `Reading ${(fraction * 100).toFixed(1)}% (${formatBytes(this.bytesRead)} of ${formatBytes(this.totalBytes)}), `
      + `${systemCount.toLocaleString('en-GB')} systems, ${formatDuration(elapsedSeconds)} so far${timeLeftText}`;
  }

  reportIfDue(systemCount) {
    const now = performance.now();
    if (now - this.lastReportTime < this.reportIntervalMilliseconds) {
      return;
    }
    this.lastReportTime = now;
    this.write(this.describe(systemCount));
  }

  write(text) {
    if (this.writesInPlace) {
      // Return to the start of the line and clear it before writing.
      process.stderr.write(`\r\x1b[2K${text}`);
    } else {
      process.stderr.write(`${text}\n`);
    }
  }

  finish(systemCount) {
    this.bytesRead = this.totalBytes;
    this.write(this.describe(systemCount));
    if (this.writesInPlace) {
      process.stderr.write('\n');
    }
  }
}

// Writes a step's name to standard error, runs it, and says how long it took.
function runStep(description, step) {
  const startTime = performance.now();
  process.stderr.write(`${description}... `);
  const result = step();
  const elapsedSeconds = (performance.now() - startTime) / 1000;
  const elapsedText = elapsedSeconds < 10 ? `${elapsedSeconds.toFixed(1)}s` : formatDuration(elapsedSeconds);
  process.stderr.write(`done in ${elapsedText}\n`);
  return result;
}

const readingProgress = new ReadingProgress(statSync(options.input_file).size);
let fileStream = createReadStream(options.input_file);
let systemCount = 0;
// Progress is reported as file data arrives (every 64 KB or so), not per
// system, so it keeps updating however large each system's line is; a dump
// with bodies can have very long lines.
fileStream.on('data', chunk => {
  readingProgress.bytesRead += chunk.length;
  readingProgress.reportIfDue(systemCount);
});
if (options.input_file.endsWith('.gz')) {
  fileStream = fileStream.pipe(createGunzip());
}
let systemsOutsideImage = 0;
for await (const line of readLines(Readable.toWeb(fileStream))) {
  // Estimating from id64s needs nothing else from the line, so it skips
  // parsing the JSON, which is most of the work. The system's own id64 is
  // the first in its line, ahead of any bodies'.
  if (boxelEstimator !== null) {
    const id64 = id64FromLine(line);
    if (id64 === null) {
      const isSystemLine = line.includes('{');
      if (isSystemLine) {
        systemCount++;
        systemsWithoutId64++;
      }
      continue;
    }
    systemCount++;
    if (!boxelEstimator.addSystem(decodeId64(id64))) {
      systemsOfOtherMassCodes++;
    }
    continue;
  }
  const system = parseDumpLine(line);
  if (system === null) {
    continue;
  }
  systemCount++;
  const column = Math.floor((system.coords.x - leftEdgeX) / lightYearsPerPixel);
  const row = Math.floor((topEdgeZ - system.coords.z) / lightYearsPerPixel);
  if (column < 0 || column >= imageSize || row < 0 || row >= imageSize) {
    systemsOutsideImage++;
    continue;
  }
  systemsPerPixel[row * imageSize + column]++;
}
readingProgress.finish(systemCount);

// Logarithmic brightness, so sparse outer regions still show next to the
// crowded core. Filtering works on these levels rather than raw counts, so a
// route a hundred times busier than its surroundings is just another outlier.
let unfilteredLevels;
if (boxelEstimator === null) {
  unfilteredLevels = Float32Array.from(systemsPerPixel, count => Math.log1p(count));
} else {
  const densityPerPixel = runStep('Estimating density from boxels', () => boxelEstimator.densityPerPixel(imageSize, area));
  // As systems in a column 1,000 ly deep above each pixel, which puts the
  // numbers on the same footing as counting.
  const lightYearsDeep = 1000;
  unfilteredLevels = Float32Array.from(densityPerPixel, density => Math.log1p(density * lightYearsPerPixel * lightYearsPerPixel * lightYearsDeep));
  const boxelSummary = boxelEstimator.boxelCounts()
    .map(({ massCode, boxelCount }) => `${MASS_CODE_LETTERS[massCode]} ${boxelCount.toLocaleString('en-GB')}`)
    .join(', ');
  process.stderr.write(`Boxels visited by mass code: ${boxelSummary}\n`);
  if (systemsWithoutId64 > 0) {
    process.stderr.write(`${systemsWithoutId64.toLocaleString('en-GB')} systems had no id64 and were left out\n`);
  }
  process.stderr.write(`${systemsOfOtherMassCodes.toLocaleString('en-GB')} systems of other mass codes were left out\n`);
}
let logarithmicCounts = unfilteredLevels;
if (medianRadius > 0) {
  logarithmicCounts = runStep(`Removing thin lines (median radius ${medianRadius})`, () => medianFilter(logarithmicCounts, imageSize, medianRadius));
}
if (blurRadius > 0) {
  logarithmicCounts = runStep(`Blurring (radius ${blurRadius})`, () => gaussianBlur(logarithmicCounts, imageSize, blurRadius));
}
const occupiedLevels = Array.from(logarithmicCounts).filter(level => level > 0).sort((first, second) => first - second);
const fullBrightnessLevel = occupiedLevels[Math.min(Math.floor(occupiedLevels.length * brightPercentile / 100), occupiedLevels.length - 1)] ?? 1;

// Colour runs from deep blue at low density, through pale blue, to warm
// white at the densest.
const colourStops = [
  { at: 0, colour: [0, 0, 0] },
  { at: 0.25, colour: [28, 40, 78] },
  { at: 0.55, colour: [96, 124, 170] },
  { at: 0.8, colour: [196, 184, 170] },
  { at: 1, colour: [255, 236, 210] },
];
function colourForBrightness(brightness) {
  for (let stopIndex = 1; stopIndex < colourStops.length; stopIndex++) {
    const upperStop = colourStops[stopIndex];
    if (brightness <= upperStop.at) {
      const lowerStop = colourStops[stopIndex - 1];
      const blend = (brightness - lowerStop.at) / (upperStop.at - lowerStop.at);
      return lowerStop.colour.map((channel, channelIndex) => Math.round(channel + (upperStop.colour[channelIndex] - channel) * blend));
    }
  }
  return colourStops[colourStops.length - 1].colour;
}

// PNG rows each start with a filter type byte (0 = none), then RGB bytes.
const bytesPerRow = 1 + imageSize * 3;
const imageBytes = Buffer.alloc(bytesPerRow * imageSize);
for (let row = 0; row < imageSize; row++) {
  for (let column = 0; column < imageSize; column++) {
    const brightness = Math.min(logarithmicCounts[row * imageSize + column] / fullBrightnessLevel, 1);
    const [red, green, blue] = colourForBrightness(brightness);
    const offset = row * bytesPerRow + 1 + column * 3;
    imageBytes[offset] = red;
    imageBytes[offset + 1] = green;
    imageBytes[offset + 2] = blue;
  }
}

function pngChunk(chunkType, chunkData) {
  const typeAndData = Buffer.concat([Buffer.from(chunkType, 'ascii'), chunkData]);
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeUInt32BE(chunkData.length);
  const checksumBytes = Buffer.alloc(4);
  checksumBytes.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([lengthBytes, typeAndData, checksumBytes]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(imageSize, 0);
header.writeUInt32BE(imageSize, 4);
header[8] = 8; // bits per channel
header[9] = 2; // colour type: RGB
const pngBytes = runStep('Compressing the image', () => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', header),
  pngChunk('IDAT', deflateSync(imageBytes, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]));
await writeFile(options.output_file, pngBytes);
console.log(`${systemCount.toLocaleString('en-GB')} systems read, ${boxelEstimator === null ? `${systemsOutsideImage.toLocaleString('en-GB')} outside the image` : 'density estimated from id64s'}; wrote ${options.output_file} (${imageSize}x${imageSize})`);
