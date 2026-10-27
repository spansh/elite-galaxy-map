import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { calculateKeyboardMovement, movementKeyName } from '../src/keyboardMovement.js';

// A camera at `position` looking at the origin, as OrbitControls leaves it.
function cameraLookingAtOrigin(position) {
  const camera = new PerspectiveCamera();
  camera.position.copy(position);
  camera.lookAt(0, 0, 0);
  return camera;
}

function movementFor(heldKeys, camera, elapsedSeconds = 1) {
  return calculateKeyboardMovement({
    heldKeys: new Set(heldKeys),
    cameraQuaternion: camera.quaternion,
    cameraDistance: camera.position.length(),
    speedPerSecond: 0.5,
    elapsedSeconds,
  });
}

describe('calculateKeyboardMovement', () => {
  const cameraLookingNorth = cameraLookingAtOrigin(new Vector3(0, 300, 400));

  it('moves away from the viewer, level with the plane, for the up arrow', () => {
    const movement = movementFor(['ArrowUp'], cameraLookingNorth);
    // Camera distance 500, half of it per second.
    expect(movement.x).toBeCloseTo(0);
    expect(movement.y).toBeCloseTo(0);
    expect(movement.z).toBeCloseTo(-250);
  });

  it('still moves away from the viewer when the camera is below the plane, at any angle', () => {
    // Facing -z (north) from below, at 30, 45 and 60 degrees under the plane.
    for (const degreesBelow of [30, 45, 60, 89]) {
      const radians = degreesBelow * Math.PI / 180;
      const camera = cameraLookingAtOrigin(new Vector3(0, -500 * Math.sin(radians), 500 * Math.cos(radians)));
      const movement = movementFor(['ArrowUp'], camera);
      expect(movement.y).toBeCloseTo(0);
      expect(movement.z).toBeCloseTo(-250);
    }
  });

  it('slides sideways for left and right', () => {
    expect(movementFor(['ArrowRight'], cameraLookingNorth).x).toBeCloseTo(250);
    expect(movementFor(['ArrowLeft'], cameraLookingNorth).x).toBeCloseTo(-250);
  });

  it('moves towards the top of the screen when looking straight down', () => {
    const cameraLookingDown = cameraLookingAtOrigin(new Vector3(0, 500, 0.0001));
    const movement = movementFor(['ArrowUp'], cameraLookingDown);
    expect(movement.y).toBeCloseTo(0);
    expect(movement.z).toBeLessThan(-249);
  });

  it('goes no faster diagonally, and opposite keys cancel', () => {
    expect(movementFor(['ArrowUp', 'ArrowRight'], cameraLookingNorth).length()).toBeCloseTo(250);
    expect(movementFor(['ArrowUp', 'ArrowDown'], cameraLookingNorth).length()).toBe(0);
  });

  it('moves straight up and down for Page Up and Page Down, whatever the camera angle', () => {
    const upward = movementFor(['PageUp'], cameraLookingNorth);
    expect(upward.toArray().map(value => Math.round(value))).toEqual([0, 250, 0]);
    const cameraLookingDown = cameraLookingAtOrigin(new Vector3(0, 500, 0.0001));
    expect(movementFor(['PageDown'], cameraLookingDown).y).toBeCloseTo(-250);
  });

  it('treats Shift with the up and down arrows as vertical movement', () => {
    expect(movementKeyName('ArrowUp', true)).toBe('Shift+ArrowUp');
    expect(movementKeyName('ArrowLeft', true)).toBe('ArrowLeft');
    expect(movementKeyName('ArrowDown', false)).toBe('ArrowDown');
    expect(movementFor(['Shift+ArrowDown'], cameraLookingNorth).y).toBeCloseTo(-250);
  });

  it('goes no faster when moving forward and up together', () => {
    expect(movementFor(['ArrowUp', 'PageUp'], cameraLookingNorth).length()).toBeCloseTo(250);
  });

  it('scales with the time since the last frame and ignores other keys', () => {
    expect(movementFor(['ArrowDown'], cameraLookingNorth, 0.1).z).toBeCloseTo(25);
    expect(movementFor(['KeyW', 'Shift'], cameraLookingNorth).length()).toBe(0);
  });
});
