import { Vector3 } from 'three';

// The camera views the map can be opened in, as the direction from the point
// being looked at towards the camera, in scene coordinates.
//
//   angled   above the galactic plane and south of the target (towards Sol
//            from the core), looking down at about 50 degrees
//   topDown  straight down, with the galactic core direction (galactic +z)
//            at the top of the screen
//
// Top-down is very slightly off vertical: looking exactly straight down
// leaves the camera without a sensible "up", and the controls misbehave.
export const CAMERA_VIEWS = Object.freeze({
    angled: Object.freeze(new Vector3(0, 0.75, 0.66).normalize()),
    topDown: Object.freeze(new Vector3(0, 1, 0.0001).normalize()),
});

export function directionTowardsCamera(viewName) {
    const direction = CAMERA_VIEWS[viewName];
    if (direction === undefined) {
        throw new Error(`Unknown camera view "${viewName}"; expected one of ${Object.keys(CAMERA_VIEWS).join(', ')}`);
    }
    return direction.clone();
}

// Where to point the camera, and how far back to put it, so every one of the
// given systems is on screen. Coordinates in and out are galactic.
//
// marginFactor leaves room around the outermost systems for their names.
export function frameSystems({ coordinatesList, viewName, fieldOfViewDegrees, aspectRatio, minimumDistance, marginFactor = 1.4 }) {
    if (coordinatesList.length === 0) {
        throw new Error('frameSystems needs at least one system');
    }
    const centre = { x: 0, y: 0, z: 0 };
    for (const coordinates of coordinatesList) {
        centre.x += coordinates.x / coordinatesList.length;
        centre.y += coordinates.y / coordinatesList.length;
        centre.z += coordinates.z / coordinatesList.length;
    }

    const tangentOfHalfHeight = Math.tan((fieldOfViewDegrees * Math.PI / 180) / 2);
    const tangentOfHalfWidth = tangentOfHalfHeight * aspectRatio;
    let distanceNeeded = 0;
    if (viewName === 'topDown') {
        // Looking straight down, galactic x runs across the screen and
        // galactic z up it, so each needs to fit its own half of the view.
        for (const coordinates of coordinatesList) {
            distanceNeeded = Math.max(
                distanceNeeded,
                Math.abs(coordinates.x - centre.x) / tangentOfHalfWidth,
                Math.abs(coordinates.z - centre.z) / tangentOfHalfHeight,
            );
        }
    } else {
        // From an angle, fit a sphere around all the systems into the
        // narrower direction of the view.
        let radius = 0;
        for (const coordinates of coordinatesList) {
            radius = Math.max(radius, Math.hypot(coordinates.x - centre.x, coordinates.y - centre.y, coordinates.z - centre.z));
        }
        const narrowerHalfAngle = Math.atan(Math.min(tangentOfHalfHeight, tangentOfHalfWidth));
        distanceNeeded = radius / Math.sin(narrowerHalfAngle);
    }
    return { target: centre, distance: Math.max(distanceNeeded * marginFactor, minimumDistance) };
}
