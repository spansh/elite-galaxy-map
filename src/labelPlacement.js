// Keeps system names from sitting on top of each other. Each label wants to
// sit just to the right of its system. Labels are placed one at a time, in
// priority order; a label whose usual spot is taken tries stepping up and
// down, a label's height at a time, and is hidden if it finds no free spot
// nearby. Rings (and anything else in `obstacles`) are avoided too, so a name
// never covers another system.
//
// All positions are screen pixels with y pointing up.

const STEPS_TO_TRY = [0, 1, -1, 2, -2, 3, -3];
const PADDING = 2;

function rectanglesOverlap(first, second) {
    return first.left < second.right + PADDING
        && second.left < first.right + PADDING
        && first.bottom < second.top + PADDING
        && second.bottom < first.top + PADDING;
}

// labels: [{ anchorX, anchorY, gapFromAnchor, width, height, isFixed, canMove }]
//   anchorX, anchorY  the system's position on screen
//   isFixed           placed where it is and never moved (the selection)
//   canMove           false to only try the usual spot, so a label is shown
//                     beside its own system or not at all (optional names,
//                     such as stops along a route, where a moved label could
//                     be mistaken for a neighbour's)
// obstacles: [{ left, right, bottom, top }]
// Returns, for each label in the same order, { isShown, verticalOffset }.
export function placeLabels(labels, obstacles = []) {
    const occupied = [...obstacles];
    return labels.map(label => {
        const rectangleAt = verticalOffset => ({
            left: label.anchorX + label.gapFromAnchor,
            right: label.anchorX + label.gapFromAnchor + label.width,
            bottom: label.anchorY + verticalOffset - label.height / 2,
            top: label.anchorY + verticalOffset + label.height / 2,
        });
        if (label.isFixed) {
            occupied.push(rectangleAt(0));
            return { isShown: true, verticalOffset: 0 };
        }
        const stepsToTry = label.canMove === false ? [0] : STEPS_TO_TRY;
        for (const step of stepsToTry) {
            const verticalOffset = step * (label.height + PADDING);
            const candidate = rectangleAt(verticalOffset);
            if (!occupied.some(taken => rectanglesOverlap(candidate, taken))) {
                occupied.push(candidate);
                return { isShown: true, verticalOffset };
            }
        }
        return { isShown: false, verticalOffset: 0 };
    });
}

// Decides which rings to draw when many crowd together, for example the
// hundreds of stops on a long route seen from far away. Rings are considered
// in the order given (most important first); a ring is drawn only if it does
// not overlap a ring already drawn. Zooming in spreads the rings out, so
// more of them appear.
//
// rings: [{ x, y, radius }] in screen pixels. Returns one true/false per ring.
// Nearby rings are found through a grid of screen squares, so this stays
// quick for thousands of rings.
export function chooseRingsToDraw(rings) {
    const largestRadius = rings.reduce((largest, ring) => Math.max(largest, ring.radius), 1);
    const squareSize = largestRadius * 2;
    const drawnRingsBySquare = new Map();
    const squareKey = (column, row) => `${column},${row}`;
    return rings.map(ring => {
        const column = Math.floor(ring.x / squareSize);
        const row = Math.floor(ring.y / squareSize);
        // Any ring close enough to overlap is in this square or a neighbour.
        for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
            for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
                const nearbyRings = drawnRingsBySquare.get(squareKey(column + columnOffset, row + rowOffset)) ?? [];
                const overlapsOne = nearbyRings.some(drawnRing => Math.hypot(drawnRing.x - ring.x, drawnRing.y - ring.y) < drawnRing.radius + ring.radius);
                if (overlapsOne) {
                    return false;
                }
            }
        }
        const key = squareKey(column, row);
        if (!drawnRingsBySquare.has(key)) {
            drawnRingsBySquare.set(key, []);
        }
        drawnRingsBySquare.get(key).push(ring);
        return true;
    });
}
