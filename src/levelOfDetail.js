// Chooses how many stars to draw from each spatial cell this frame. Seen
// from far away, a cell's stars pile up many to a pixel; drawing a random
// sample of them, each brighter by the same proportion, gives the same
// picture for a fraction of the work. Close up, every star is drawn.
//
// Each cell keeps its stars in random order (StarCell.shuffleInNewSystems),
// after the few stars of its rarest layers, which are always drawn. So the
// first N of the rest are an even sample: a cell is cut down simply by
// drawing fewer of them.
//
// Stars that arrived since the cell was last shuffled wait at the end, in
// the order they came. A sample is drawn from the shuffled stars only, so
// it stands for those alone and is brightened to match them, not the whole
// cell. Dumps arrive in id64 order, a region at a time, so the shuffled
// stars of a cell still loading are the regions that came first:
// brightening them to stand for the rest would light those regions up and
// leave the later ones dark. Instead the newcomers simply wait to be
// shuffled in (see orderCellsForShuffling), and a cell with too many waiting
// is drawn in full.

// Never cut a cell below this many stars, so its shape still shows.
const MINIMUM_STARS_PER_CELL = 64;
// A cell is only sampled while at least this share of its stars has been
// shuffled. Past that, so many of its stars are waiting to be shuffled that
// leaving them out would leave holes where they are, so every star is drawn
// until the cell is shuffled again.
const MINIMUM_SHUFFLED_SHARE = 0.5;
// Never draw fewer than one in this many of a cell's stars, so no star is
// brightened by more than this: past it, single stars flash as the sample
// changes with the view. Drawing more instead of capping the brightness
// keeps the total light right.
const MAXIMUM_BRIGHTNESS_COMPENSATION = 32;

// A cell is shuffled again once its waiting stars are this share of those
// already shuffled (or once no more have arrived for a while).
export const RESHUFFLE_SHARE = 0.25;
const RESHUFFLE_MINIMUM_WAITING = 1024;

// Whether a cell has enough stars waiting to be shuffled in to be worth
// shuffling now, while data is still arriving.
export function hasGrownEnoughToShuffle(cell) {
    return cell.unshuffledCount >= Math.max(RESHUFFLE_MINIMUM_WAITING, cell.shuffledCount * RESHUFFLE_SHARE);
}

// The cells with stars waiting to be shuffled in, most in need first: those
// on screen, then those with most waiting for the stars they have. Shuffling
// a big cell can take a whole idle period, so taking cells in a fixed order
// would leave the ones at the end waiting for minutes while a large dump
// loads; this way every cell gets its turn, the ones that show first.
export function orderCellsForShuffling(cells) {
    const waitingShare = cell => cell.unshuffledCount / Math.max(cell.shuffledCount, 1);
    return cells
        .filter(cell => cell.unshuffledCount > 0)
        .sort((first, second) => Number(second.wasOnScreen) - Number(first.wasOnScreen) || waitingShare(second) - waitingShare(first));
}

// Stars at the end of a cell's sample fade out gradually rather than
// stopping at a sharp cut: from the Nth star, the next N x FADE_LENGTH
// stars fade from full to nothing. As the sample grows and shrinks with the
// view, stars fade in and out instead of popping.
export const FADE_LENGTH = 0.5;

// Where the fade begins and ends for a sample of drawCount stars, and how
// much brighter each star must be to make up for the shuffled stars not
// drawn (counting the fading stars at half). Returns { fadeStart, fadeEnd,
// brightnessCompensation }; draw stars up to fadeEnd.
export function fadeForSample(drawCount, systemCount, shuffledCount) {
    if (drawCount === 0) {
        return { fadeStart: 0, fadeEnd: 0, brightnessCompensation: 1 };
    }
    if (drawCount >= systemCount) {
        return { fadeStart: systemCount, fadeEnd: systemCount, brightnessCompensation: 1 };
    }
    const fadeStart = drawCount;
    const fadeEnd = Math.min(Math.ceil(drawCount * (1 + FADE_LENGTH)), shuffledCount, systemCount);
    const starsCounted = fadeStart + (fadeEnd - fadeStart) / 2;
    return { fadeStart, fadeEnd, brightnessCompensation: shuffledCount / starsCounted };
}

// cells: one entry per cell on screen, describing the part of it that can
// be sampled (the stars after any that are always drawn):
//   systemCount        stars in that part
//   shuffledCount      how many of them, from the first, are in random order
//                      (any after them arrived since and are left out of
//                      a sample)
//   visibleCount       how many belong to visible layers (systemCount if
//                      left out); hidden stars are drawn as nothing, so a
//                      cell whose visible stars are few must draw more of
//                      its stars to show enough of them
//   widthOnScreen      the cell's width on screen in pixels
//   cameraIsInside     the camera is in or very near the cell
// settings:
//   maximumStarsPerPixel  sample a cell down to about this many visible
//                         stars for each pixel it covers on screen
//   starBudget            draw at most about this many visible stars in all
//
// Returns, for each cell in the same order, { drawCount, brightnessCompensation },
// before any fade (see fadeForSample).
export function chooseStarsToDraw(cells, { maximumStarsPerPixel, starBudget }) {
    const visibleCountOf = cell => cell.visibleCount ?? cell.systemCount;
    // A cell can only be cut down if it has been shuffled: an unshuffled
    // cell's first stars would all come from one part of it.
    const canBeSampled = cell => !cell.cameraIsInside
        && cell.shuffledCount >= MINIMUM_STARS_PER_CELL
        && cell.shuffledCount >= cell.systemCount * MINIMUM_SHUFFLED_SHARE
        && visibleCountOf(cell) > 0;

    // First, how many visible stars the density on screen calls for.
    const wantedVisibleCounts = cells.map(cell => {
        const visibleCount = visibleCountOf(cell);
        if (!canBeSampled(cell)) {
            return visibleCount;
        }
        const starsTheScreenCanShow = cell.widthOnScreen * cell.widthOnScreen * maximumStarsPerPixel;
        return Math.min(visibleCount, Math.max(MINIMUM_STARS_PER_CELL, Math.ceil(starsTheScreenCanShow)));
    });

    // Then, if that is still over budget, cut every cell that can be cut by
    // the same proportion.
    let countThatCannotBeCut = 0;
    let countThatCanBeCut = 0;
    cells.forEach((cell, index) => {
        if (canBeSampled(cell)) {
            countThatCanBeCut += wantedVisibleCounts[index];
        } else {
            countThatCannotBeCut += wantedVisibleCounts[index];
        }
    });
    const budgetForCuttableCells = Math.max(starBudget - countThatCannotBeCut, 0);
    const budgetProportion = countThatCanBeCut > budgetForCuttableCells ? budgetForCuttableCells / countThatCanBeCut : 1;

    return cells.map((cell, index) => {
        const visibleCount = visibleCountOf(cell);
        if (visibleCount === 0) {
            return { drawCount: 0, brightnessCompensation: 1 };
        }
        if (!canBeSampled(cell)) {
            return { drawCount: cell.systemCount, brightnessCompensation: 1 };
        }
        // Visible stars are spread evenly through the random order, so to
        // draw N of them, draw N / (visible share) stars. The sample stands
        // for the shuffled stars, so it is a share of those that's wanted.
        const visibleShare = visibleCount / cell.systemCount;
        const shuffledShare = cell.shuffledCount / cell.systemCount;
        const drawCount = Math.max(
            MINIMUM_STARS_PER_CELL,
            Math.ceil(Math.floor(wantedVisibleCounts[index] * budgetProportion * shuffledShare) / visibleShare),
            Math.ceil(cell.shuffledCount / MAXIMUM_BRIGHTNESS_COMPENSATION),
        );
        // Only the shuffled stars make an even sample; if more are wanted
        // than that, draw them all.
        if (drawCount >= cell.shuffledCount) {
            return { drawCount: cell.systemCount, brightnessCompensation: 1 };
        }
        return { drawCount, brightnessCompensation: cell.shuffledCount / drawCount };
    });
}
