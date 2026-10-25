// Measures how long the map's own work takes on a real dump, outside the
// browser: adding batches of systems to the star field, and picking.
//
//     node bench/layer-bench.mjs systems_neutron.json.gz

import { Ray, Vector3 } from 'three';
import { openAsBlob } from 'node:fs';
import { StarField } from '../src/StarField.js';
import { parseDumpLine, readLines } from '../examples/spansh-loader/readLines.js';

const BATCH_SIZE = 100000;
const dumpPath = process.argv[2];
if (dumpPath === undefined) {
    console.error('Usage: node bench/layer-bench.mjs <dump.json.gz>');
    process.exit(1);
}

function describeTimings(timings) {
    const sortedTimings = [...timings].sort((first, second) => first - second);
    const total = sortedTimings.reduce((sum, timing) => sum + timing, 0);
    const median = sortedTimings[Math.floor(sortedTimings.length / 2)];
    const ninetiethPercentile = sortedTimings[Math.floor(sortedTimings.length * 0.9)];
    const worst = sortedTimings[sortedTimings.length - 1];
    return `total ${total.toFixed(0)} ms, median ${median.toFixed(2)} ms, 90th percentile ${ninetiethPercentile.toFixed(2)} ms, worst ${worst.toFixed(2)} ms`;
}

// Read the dump into batches first, in file order, the way the loader sends
// them (names joined with newlines), so only the star field's work is timed.
const dumpFile = await openAsBlob(dumpPath);
let byteStream = dumpFile.stream();
if (dumpPath.endsWith('.gz')) {
    byteStream = byteStream.pipeThrough(new DecompressionStream('gzip'));
}
const batches = [];
let batchPositions = new Float32Array(BATCH_SIZE * 3);
let batchNames = [];
for await (const line of readLines(byteStream)) {
    const system = parseDumpLine(line);
    if (system === null) {
        continue;
    }
    const systemIndex = batchNames.length;
    batchPositions[systemIndex * 3] = system.coords.x;
    batchPositions[systemIndex * 3 + 1] = system.coords.y;
    batchPositions[systemIndex * 3 + 2] = system.coords.z;
    batchNames.push(system.name);
    if (batchNames.length === BATCH_SIZE) {
        batches.push({ positions: batchPositions, names: batchNames.join('\n') });
        batchPositions = new Float32Array(BATCH_SIZE * 3);
        batchNames = [];
    }
}
if (batchNames.length > 0) {
    batches.push({ positions: batchPositions.slice(0, batchNames.length * 3), names: batchNames.join('\n') });
}

const starField = new StarField({ cellSize: 4000 });
const batchTimings = batches.map(batch => {
    const startTime = performance.now();
    starField.addSystems('benchmark', { galacticPositions: batch.positions, names: batch.names });
    return performance.now() - startTime;
});
console.log(`addSystems, ${batches.length} batches of up to ${BATCH_SIZE}: ${describeTimings(batchTimings)}`);

// Rays from a camera above the galaxy aimed across a grid of points, plus
// rays from the side straight through the crowded core.
const rays = [];
const cameraAboveGalaxy = new Vector3(0, 72000, 36000);
for (let stepsAcross = -5; stepsAcross <= 5; stepsAcross++) {
    for (let stepsDown = -5; stepsDown <= 5; stepsDown++) {
        const aimPoint = new Vector3(stepsAcross * 6000, 0, -25000 + stepsDown * 6000);
        rays.push(new Ray(cameraAboveGalaxy.clone(), aimPoint.sub(cameraAboveGalaxy).normalize()));
    }
}
const cameraBesideCore = new Vector3(-60000, 2000, -25900);
for (let stepIndex = 0; stepIndex < 20; stepIndex++) {
    const aimPoint = new Vector3(25, 0, -25900 + (stepIndex - 10) * 300);
    rays.push(new Ray(cameraBesideCore.clone(), aimPoint.sub(cameraBesideCore).normalize()));
}
// About 8 pixels on a 900 pixel high view with a 60 degree field of view.
const angularTolerance = 8 / 780;
for (const passName of ['first pass (builds picking boxes)', 'later passes']) {
    const pickTimings = rays.map(ray => {
        const startTime = performance.now();
        starField.findSystemNearestRay(ray, angularTolerance, 0.5);
        return performance.now() - startTime;
    });
    console.log(`picking, ${passName}, ${rays.length} rays: ${describeTimings(pickTimings)}`);
}
