// Estimating how densely the galaxy is populated from system id64s, rather
// than by counting the systems in a dump.
//
// A system's id64 says which boxel (a cube of space, sized by the system's
// mass code) it is in, and its index number among that boxel's systems of
// that mass code. The boxel must therefore hold at least index + 1 systems,
// whether or not anyone has visited them. So one visited system tells us
// roughly how full its whole boxel is, and visiting the same area again and
// again (a popular route) adds nothing; which is what a plain count gets
// wrong.
//
// id64 layout, from the lowest bit up (boxel bits = 7 - mass code):
//   mass code 3, boxel z, sector z 7, boxel y, sector y 6, boxel x,
//   sector x 7, index in boxel 11 + 3 x mass code, body 9.

const GALAXY_ORIGIN = Object.freeze({ x: -49985, y: -40985, z: -24105 });
const SECTOR_SIZE_LIGHT_YEARS = 1280;
export const MASS_CODE_LETTERS = 'abcdefgh';

export function boxelSizeInLightYears(massCode) {
    return 10 * 2 ** massCode;
}

// Splits an id64 into its upper and lower 32 bits as plain numbers, which
// is much quicker to pick apart than a BigInt. Accepts the id64 as decimal
// text (as read from a dump line) or as a BigInt.
function splitIntoHalves(id64) {
    if (typeof id64 === 'bigint') {
        return { upper: Number(id64 >> 32n), lower: Number(id64 & 0xffffffffn) };
    }
    const digits = String(id64);
    let upper = 0;
    let lower = 0;
    for (let digitIndex = 0; digitIndex < digits.length; digitIndex++) {
        // Multiply the 64-bit value by ten and add the digit, carrying from
        // the lower half into the upper.
        const lowerTimesTen = lower * 10 + (digits.charCodeAt(digitIndex) - 48);
        const carry = Math.floor(lowerTimesTen / 4294967296);
        lower = lowerTimesTen - carry * 4294967296;
        upper = (upper * 10 + carry) % 4294967296;
    }
    return { upper, lower };
}

// Numbers above 2^53 lose digits when JSON is parsed, so read the id64 as
// text (see id64FromLine) or a BigInt rather than a number.
export function decodeId64(id64) {
    let { upper, lower } = splitIntoHalves(id64);
    // Takes the lowest bitCount bits (32 at most) and shifts the rest down,
    // using 32-bit bit operations (>>> 0 keeps values unsigned).
    const takeBits = bitCount => {
        // Mass code h has no boxel bits at all. (A 32-bit shift would also
        // be wrong: JavaScript shifts by the count modulo 32.)
        if (bitCount === 0) {
            return 0;
        }
        if (bitCount === 32) {
            const value = lower;
            lower = upper;
            upper = 0;
            return value;
        }
        const value = (lower & (2 ** bitCount - 1)) >>> 0;
        lower = ((lower >>> bitCount) | (upper << (32 - bitCount))) >>> 0;
        upper = upper >>> bitCount;
        return value;
    };
    const massCode = takeBits(3);
    const boxelBits = 7 - massCode;
    const boxelZ = takeBits(boxelBits);
    const sectorZ = takeBits(7);
    const boxelY = takeBits(boxelBits);
    const sectorY = takeBits(6);
    const boxelX = takeBits(boxelBits);
    const sectorX = takeBits(7);
    const indexInBoxel = takeBits(11 + 3 * massCode);
    const bodyId = takeBits(9);
    const boxelSize = boxelSizeInLightYears(massCode);
    return {
        massCode,
        indexInBoxel,
        bodyId,
        boxelSize,
        sector: { x: sectorX, y: sectorY, z: sectorZ },
        boxel: { x: boxelX, y: boxelY, z: boxelZ },
        boxelCorner: {
            x: GALAXY_ORIGIN.x + sectorX * SECTOR_SIZE_LIGHT_YEARS + boxelX * boxelSize,
            y: GALAXY_ORIGIN.y + sectorY * SECTOR_SIZE_LIGHT_YEARS + boxelY * boxelSize,
            z: GALAXY_ORIGIN.z + sectorZ * SECTOR_SIZE_LIGHT_YEARS + boxelZ * boxelSize,
        },
    };
}

// Finds the id64 in one line of a dump, as its decimal text so no digits
// are lost.
const ID64_IN_LINE = /"id64"\s*:\s*(\d+)/;
export function id64FromLine(line) {
    const match = ID64_IN_LINE.exec(line);
    return match === null ? null : match[1];
}

// One number per boxel, unique within a mass code: sector x 7 bits, y 6, z 7
// and boxel x, y, z up to 7 bits each is 41 bits, well within what a
// JavaScript number holds exactly. The boxel's position is worked back out
// from the key afterwards, so nothing else needs storing per boxel.
function boxelKey(decoded) {
    const { sector, boxel } = decoded;
    return ((((sector.x * 64 + sector.y) * 128 + sector.z) * 128 + boxel.x) * 128 + boxel.y) * 128 + boxel.z;
}

function boxelCornerFromKey(key, massCode) {
    let remaining = key;
    const takeDigit = base => {
        const digit = remaining % base;
        remaining = Math.floor(remaining / base);
        return digit;
    };
    takeDigit(128); // boxel z; only x and z matter for a top-down map
    takeDigit(128); // boxel y
    const boxelX = takeDigit(128);
    const sectorZ = takeDigit(128);
    takeDigit(64); // sector y
    const sectorX = takeDigit(128);
    const boxelSize = boxelSizeInLightYears(massCode);
    const boxelZ = key % 128;
    return {
        x: GALAXY_ORIGIN.x + sectorX * SECTOR_SIZE_LIGHT_YEARS + boxelX * boxelSize,
        z: GALAXY_ORIGIN.z + sectorZ * SECTOR_SIZE_LIGHT_YEARS + boxelZ * boxelSize,
    };
}

export class BoxelPopulationEstimator {
    constructor(massCodesToUse) {
        this.massCodesToUse = new Set(massCodesToUse);
        // For each mass code: boxel key -> estimated systems in the boxel.
        this.boxelsByMassCode = new Map([...this.massCodesToUse].map(massCode => [massCode, new Map()]));
    }

    // Returns false if the system's mass code is not being used.
    addSystem(decoded) {
        const boxels = this.boxelsByMassCode.get(decoded.massCode);
        if (boxels === undefined) {
            return false;
        }
        const key = boxelKey(decoded);
        const estimatedSystems = decoded.indexInBoxel + 1;
        if (!(boxels.get(key) >= estimatedSystems)) {
            boxels.set(key, estimatedSystems);
        }
        return true;
    }

    boxelCounts() {
        return [...this.boxelsByMassCode].map(([massCode, boxels]) => ({ massCode, boxelCount: boxels.size }));
    }

    // Systems per cubic light year in each pixel of a top-down image covering
    // `area` (as for density maps: row 0 is the highest z). For each mass
    // code, the boxels anyone has visited above a pixel are averaged, so how
    // many were visited doesn't matter, only that some were; then the mass
    // codes are added together. Boxels wider than a pixel are shared out
    // over the pixels they cover.
    densityPerPixel(imageSize, area) {
        const lightYearsPerPixel = area.widthInLightYears / imageSize;
        const leftEdgeX = area.centreX - area.widthInLightYears / 2;
        const topEdgeZ = area.centreZ + area.widthInLightYears / 2;
        const totalDensity = new Float64Array(imageSize * imageSize);

        for (const [massCode, boxels] of this.boxelsByMassCode) {
            const boxelSize = boxelSizeInLightYears(massCode);
            const boxelVolume = boxelSize ** 3;
            const estimateSum = new Float64Array(imageSize * imageSize);
            const boxelWeight = new Float64Array(imageSize * imageSize);
            // Sample each boxel's footprint finely enough to share it out
            // over every pixel it touches.
            const samplesAcross = Math.max(1, Math.ceil(boxelSize / lightYearsPerPixel) * 2);
            const sampleWeight = 1 / (samplesAcross * samplesAcross);
            for (const [key, estimatedSystems] of boxels) {
                const corner = boxelCornerFromKey(key, massCode);
                for (let sampleAcross = 0; sampleAcross < samplesAcross; sampleAcross++) {
                    const sampleX = corner.x + (sampleAcross + 0.5) * boxelSize / samplesAcross;
                    const column = Math.floor((sampleX - leftEdgeX) / lightYearsPerPixel);
                    if (column < 0 || column >= imageSize) {
                        continue;
                    }
                    for (let sampleDown = 0; sampleDown < samplesAcross; sampleDown++) {
                        const sampleZ = corner.z + (sampleDown + 0.5) * boxelSize / samplesAcross;
                        const row = Math.floor((topEdgeZ - sampleZ) / lightYearsPerPixel);
                        if (row < 0 || row >= imageSize) {
                            continue;
                        }
                        const pixel = row * imageSize + column;
                        estimateSum[pixel] += estimatedSystems * sampleWeight;
                        boxelWeight[pixel] += sampleWeight;
                    }
                }
            }
            for (let pixel = 0; pixel < totalDensity.length; pixel++) {
                if (boxelWeight[pixel] > 0) {
                    totalDensity[pixel] += estimateSum[pixel] / boxelWeight[pixel] / boxelVolume;
                }
            }
        }
        return totalDensity;
    }
}
