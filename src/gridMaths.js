// Pure calculations behind the grid's coordinate label, kept free of three.js
// so they can be unit tested on their own.

export const GRID_SPACINGS_IN_LIGHT_YEARS = Object.freeze([10, 100, 1000, 10000]);

// The label sits in a grid square, so it uses the finest grid whose squares
// are at least minimumSquarePixels wide on screen. Finer grids would leave no
// room for the text; when even the coarsest grid is too small the coarsest
// is used anyway.
export function chooseLabelledGridSpacing(pixelsPerLightYear, minimumSquarePixels = 160) {
    for (const spacing of GRID_SPACINGS_IN_LIGHT_YEARS) {
        if (spacing * pixelsPerLightYear >= minimumSquarePixels) {
            return spacing;
        }
    }
    return GRID_SPACINGS_IN_LIGHT_YEARS[GRID_SPACINGS_IN_LIGHT_YEARS.length - 1];
}

// The grid line crossing nearest to a point on the grid plane, in galactic
// coordinates. Adding zero turns -0 into 0 so the label never reads "-0".
export function nearestGridCorner(galacticX, galacticZ, spacing) {
    return {
        x: Math.round(galacticX / spacing) * spacing + 0,
        z: Math.round(galacticZ / spacing) * spacing + 0,
    };
}

export function formatGridCoordinates(galacticX, galacticY, galacticZ) {
    const formatNumber = value => String(Math.round(value) + 0);
    return `${formatNumber(galacticX)} : ${formatNumber(galacticY)} : ${formatNumber(galacticZ)}`;
}
