#!/usr/bin/env node
// Converts the community map of Elite Dangerous's galactic regions into the
// map's own assets/galaxy-regions.json.
//
// The source is RegionMapData.json from klightspeed's EliteDangerousRegionMap
// (https://github.com/klightspeed/EliteDangerousRegionMap, MIT licence,
// Copyright (c) 2020 Ben Peddell): the 42 codex regions on the game's
// 49.3494 ly (4096 / 83 ly) grid, 2048 cells each way, as run-length encoded
// rows from the lowest z up.
//
//     node scripts/build-region-map.mjs --input_file RegionMapData.json --output_file assets/galaxy-regions.json
//
// Besides the cells, it works out where each region's name goes: the cell
// furthest from the region's edge, so the name sits well inside it even for
// curved or ragged regions, and the region's area, so bigger regions are
// named first when names would overlap.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

// Where the grid starts and how big its cells are, as in klightspeed's code.
const ORIGIN_X = -49985;
const ORIGIN_Z = -24105;
const LIGHT_YEARS_PER_CELL = 4096 / 83;

const { values: options } = parseArgs({
    options: {
        input_file: { type: 'string' },
        output_file: { type: 'string', default: 'assets/galaxy-regions.json' },
    },
});
if (options.input_file === undefined) {
    console.error('Usage: node scripts/build-region-map.mjs --input_file RegionMapData.json [--output_file assets/galaxy-regions.json]');
    process.exit(1);
}

const source = JSON.parse(readFileSync(options.input_file, 'utf8'));
const height = source.regionmap.length;
const width = source.regionmap[0].reduce((total, [runLength]) => total + runLength, 0);
const regionCount = source.regions.length;

// Unpack the runs into one region number per cell, row 0 being the lowest z.
const regionOfCell = new Uint8Array(width * height);
source.regionmap.forEach((row, rowIndex) => {
    let column = 0;
    for (const [runLength, region] of row) {
        regionOfCell.fill(region, rowIndex * width + column, rowIndex * width + column + runLength);
        column += runLength;
    }
    if (column !== width) {
        throw new Error(`Row ${rowIndex} is ${column} cells wide, not ${width}`);
    }
});

// How far each cell is from the nearest cell of another region (or the
// edge of the map), in cells, by a two-pass chamfer distance transform.
const distanceToEdge = new Float32Array(width * height);
const STRAIGHT = 1;
const DIAGONAL = Math.SQRT2;
const sameRegion = (cellIndex, column, row) => column >= 0 && column < width && row >= 0 && row < height
    && regionOfCell[row * width + column] === regionOfCell[cellIndex];
const passes = [
    { rows: [...Array(height).keys()], columns: [...Array(width).keys()], neighbours: [[-1, 0, STRAIGHT], [0, -1, STRAIGHT], [-1, -1, DIAGONAL], [1, -1, DIAGONAL]] },
    { rows: [...Array(height).keys()].reverse(), columns: [...Array(width).keys()].reverse(), neighbours: [[1, 0, STRAIGHT], [0, 1, STRAIGHT], [1, 1, DIAGONAL], [-1, 1, DIAGONAL]] },
];
distanceToEdge.fill(Infinity);
for (const { rows, columns, neighbours } of passes) {
    for (const row of rows) {
        for (const column of columns) {
            const cellIndex = row * width + column;
            let distance = distanceToEdge[cellIndex];
            for (const [columnStep, rowStep, stepLength] of neighbours) {
                const neighbourColumn = column + columnStep;
                const neighbourRow = row + rowStep;
                if (!sameRegion(cellIndex, neighbourColumn, neighbourRow)) {
                    distance = Math.min(distance, stepLength);
                } else {
                    distance = Math.min(distance, distanceToEdge[neighbourRow * width + neighbourColumn] + stepLength);
                }
            }
            distanceToEdge[cellIndex] = distance;
        }
    }
}

const areaInCells = new Array(regionCount).fill(0);
const bestDistance = new Array(regionCount).fill(-1);
const bestCell = new Array(regionCount).fill(-1);
for (let cellIndex = 0; cellIndex < width * height; cellIndex++) {
    const region = regionOfCell[cellIndex];
    areaInCells[region]++;
    if (distanceToEdge[cellIndex] > bestDistance[region]) {
        bestDistance[region] = distanceToEdge[cellIndex];
        bestCell[region] = cellIndex;
    }
}

const round = value => Math.round(value * 10) / 10;
const regions = source.regions.map((name, region) => {
    if (region === 0) {
        // Outside the map.
        return null;
    }
    const column = bestCell[region] % width;
    const row = Math.floor(bestCell[region] / width);
    return {
        name,
        // The middle of the chosen cell, in galactic light years.
        labelX: round(ORIGIN_X + (column + 0.5) * LIGHT_YEARS_PER_CELL),
        labelZ: round(ORIGIN_Z + (row + 0.5) * LIGHT_YEARS_PER_CELL),
        areaInCells: areaInCells[region],
    };
});

// Rows stay run-length encoded, flattened to length, region, length, region...
const rows = source.regionmap.map(row => row.flat());

const output = {
    source: 'https://github.com/klightspeed/EliteDangerousRegionMap',
    licence: 'MIT, Copyright (c) 2020 Ben Peddell (see THIRD_PARTY_LICENSES.md)',
    originX: ORIGIN_X,
    originZ: ORIGIN_Z,
    cellSizeLightYears: 4096,
    cellSizeDivisor: 83,
    width,
    height,
    regions,
    rows,
};
// One row per line keeps the file readable and its diffs small.
const text = '{\n' + Object.entries(output).map(([key, value]) => {
    if (key === 'rows' || key === 'regions') {
        return `"${key}":[\n${value.map(entry => JSON.stringify(entry)).join(',\n')}\n]`;
    }
    return `"${key}":${JSON.stringify(value)}`;
}).join(',\n') + '\n}\n';
writeFileSync(options.output_file, text);
console.error(`Wrote ${options.output_file}: ${regionCount - 1} regions, ${width} x ${height} cells, ${(text.length / 1024).toFixed(0)} KB`);
