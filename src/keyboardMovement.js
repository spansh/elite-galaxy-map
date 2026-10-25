import { Vector3 } from 'three';

// Keys glide the view through the galaxy for as long as they are held.
//
// The arrow keys move level with the galactic plane, whatever angle the
// camera is at: up and down move away from and towards the viewer, left and
// right slide sideways. Page Up and Page Down (or Shift with the up and down
// arrows, for keyboards without them) move straight up and down, out of the
// plane.
//
// Speed is a fraction of the camera's distance from the point it orbits
// around per second, so it feels the same whether you are looking at one
// system or the whole galaxy.

export const MOVEMENT_KEYS = Object.freeze({
    ArrowUp: { forward: 1, sideways: 0, vertical: 0 },
    ArrowDown: { forward: -1, sideways: 0, vertical: 0 },
    ArrowLeft: { forward: 0, sideways: -1, vertical: 0 },
    ArrowRight: { forward: 0, sideways: 1, vertical: 0 },
    PageUp: { forward: 0, sideways: 0, vertical: 1 },
    PageDown: { forward: 0, sideways: 0, vertical: -1 },
    'Shift+ArrowUp': { forward: 0, sideways: 0, vertical: 1 },
    'Shift+ArrowDown': { forward: 0, sideways: 0, vertical: -1 },
});

// The name a key press is held under: Shift turns the up and down arrows
// into the vertical keys.
export function movementKeyName(key, shiftIsHeld) {
    if (shiftIsHeld && (key === 'ArrowUp' || key === 'ArrowDown')) {
        return `Shift+${key}`;
    }
    return key;
}

const SCREEN_UP = new Vector3(0, 1, 0);

// How far to move the camera (and its orbit target), in scene coordinates.
// Returns a zero vector when no movement keys are held.
export function calculateKeyboardMovement({ heldKeys, cameraQuaternion, cameraDistance, speedPerSecond, elapsedSeconds }) {
    let forwardAmount = 0;
    let sidewaysAmount = 0;
    let verticalAmount = 0;
    for (const key of heldKeys) {
        const keyMovement = MOVEMENT_KEYS[key];
        if (keyMovement !== undefined) {
            forwardAmount += keyMovement.forward;
            sidewaysAmount += keyMovement.sideways;
            verticalAmount += keyMovement.vertical;
        }
    }
    const movement = new Vector3();

    if (forwardAmount !== 0 || sidewaysAmount !== 0) {
        // "Forward" is the direction the camera looks plus the direction that
        // is up on screen, flattened onto the plane. Looking at the horizon
        // that is the view direction; looking straight down it is the top of
        // the screen. Adding the two covers every angle in between without a
        // special case. From below the plane, looking up, the screen's up
        // direction leans back towards the viewer instead, so it is taken
        // away rather than added; otherwise the two cancel out at 45 degrees
        // and the keys reverse beyond it.
        const viewDirection = new Vector3(0, 0, -1).applyQuaternion(cameraQuaternion);
        const screenUpDirection = SCREEN_UP.clone().applyQuaternion(cameraQuaternion);
        const isLookingUpwards = viewDirection.y > 0;
        const forwardDirection = viewDirection.addScaledVector(screenUpDirection, isLookingUpwards ? -1 : 1).setY(0);
        if (forwardDirection.lengthSq() > 1e-12) {
            forwardDirection.normalize();
            const sidewaysDirection = new Vector3().crossVectors(forwardDirection, SCREEN_UP);
            movement.addScaledVector(forwardDirection, forwardAmount).addScaledVector(sidewaysDirection, sidewaysAmount);
        }
    }
    movement.y += verticalAmount;

    if (movement.lengthSq() === 0) {
        return movement;
    }
    // Holding two keys at once (diagonal) shouldn't be faster than one.
    movement.normalize().multiplyScalar(cameraDistance * speedPerSecond * elapsedSeconds);
    return movement;
}
