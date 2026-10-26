// Elite Dangerous's 42 galactic regions (the codex regions, such as "Inner
// Orion Spur"), from the community map in assets/galaxy-regions.json (see
// scripts/build-region-map.mjs for where it comes from).
//
// Regions are areas on the galactic plane: every height above or below a
// point is in the same region. The game divides the plane into cells of
// 4096 / 83 ly (about 49.35 ly), each in one region.
//
// A system's region as shown when jumping to it is the region at its
// coordinates, which regionAt gives. The journal and the codex use the
// region at the corner of the system's boxel instead, which differs for a
// few systems near a border.

export const GALAXY_REGIONS_URL = new URL('../assets/galaxy-regions.json', import.meta.url).href;

export class GalaxyRegions {
    // data: the parsed contents of a galaxy-regions.json file.
    constructor(data) {
        this.originX = data.originX;
        this.originZ = data.originZ;
        this.cellSizeLightYears = data.cellSizeLightYears;
        this.cellSizeDivisor = data.cellSizeDivisor;
        this.width = data.width;
        this.height = data.height;
        // Region number 0 is outside the map; the rest are numbered from 1.
        this.regions = data.regions.map((region, regionNumber) => region === null ? null : { number: regionNumber, ...region });
        // One region number per cell, row by row from the lowest z.
        this.regionOfCell = new Uint8Array(this.width * this.height);
        data.rows.forEach((row, rowIndex) => {
            let column = 0;
            for (let runIndex = 0; runIndex < row.length; runIndex += 2) {
                const runLength = row[runIndex];
                this.regionOfCell.fill(row[runIndex + 1], rowIndex * this.width + column, rowIndex * this.width + column + runLength);
                column += runLength;
            }
        });
    }

    // The region at galactic coordinates, as { number, name, labelX,
    // labelZ, areaInCells }, or null outside the map. Only x and z matter.
    regionAt(coordinates) {
        // The same sums as the game's (and klightspeed's): multiplying by 83
        // and dividing by 4096 keeps exact cell edges exact.
        const column = Math.floor((coordinates.x - this.originX) * this.cellSizeDivisor / this.cellSizeLightYears);
        const row = Math.floor((coordinates.z - this.originZ) * this.cellSizeDivisor / this.cellSizeLightYears);
        if (column < 0 || column >= this.width || row < 0 || row >= this.height) {
            return null;
        }
        return this.regions[this.regionOfCell[row * this.width + column]];
    }

    // Every region, by number (without the "outside" entry).
    get allRegions() {
        return this.regions.filter(region => region !== null);
    }

    get cellSizeInLightYears() {
        return this.cellSizeLightYears / this.cellSizeDivisor;
    }
}

// Loads the region map: the one that comes with the package, unless another
// address is given.
//
//     const regions = await loadGalaxyRegions();
//     regions.regionAt({ x: 0, y: 0, z: 0 }).name   // 'Inner Orion Spur'
export async function loadGalaxyRegions(url = GALAXY_REGIONS_URL) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load the galaxy regions from ${url}: ${response.status} ${response.statusText}`);
    }
    return new GalaxyRegions(await response.json());
}
