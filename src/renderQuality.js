// How much quality to draw with, depending on how recently the view moved.
//
// While the view moves, stars and backdrop are drawn at lower resolution and
// with fewer stars. Once it has been still for a moment, the resolution goes
// back up at once and the extra stars are brought in over a short time, so
// they fill in rather than pop.

// Camera movement smaller than this per frame (as a share of the distance to
// the point it orbits, or as a turn) is too small to see, and doesn't count
// as moving. The last moments of a zoom or turn are tiny steps (a trackpad's
// momentum, the controls' damping) that can go on for a second or more;
// counting those would hold off the full quality picture until they end.
export const VISIBLE_MOVEMENT_SHARE = 0.0015;
export const VISIBLE_TURN_RADIANS = 0.0005;
// How long the view must be still before drawing at full resolution.
export const STILL_DELAY_MILLISECONDS = 150;
// After that, the extra stars of the full quality picture come in over this long.
export const DETAIL_EASE_IN_MILLISECONDS = 400;

// previous and current: { position, quaternion, aspect, fov } of the camera,
// with three.js Vector3 and Quaternion; orbitTarget is a Vector3.
export function cameraMovedVisibly(previous, current, orbitTarget) {
  if (previous === undefined) {
    return false;
  }
  const distanceFromTarget = Math.max(current.position.distanceTo(orbitTarget), 1);
  const movedShare = current.position.distanceTo(previous.position) / distanceFromTarget;
  const turnedRadians = 2 * Math.acos(Math.min(Math.abs(current.quaternion.dot(previous.quaternion)), 1));
  const lensChanged = current.aspect !== previous.aspect || current.fov !== previous.fov;
  return movedShare > VISIBLE_MOVEMENT_SHARE || turnedRadians > VISIBLE_TURN_RADIANS || lensChanged;
}

// Returns { isMoving, resolutionScale, starBudget, isEasingIn } for a frame
// drawn at time now. timeOfLastMovement is when the camera last moved
// visibly (undefined if never). settings holds starBudget,
// starBudgetWhileMoving and reducedResolutionScale (the resolution scale to
// use while moving).
export function chooseRenderQuality(now, timeOfLastMovement, settings) {
  const stillFor = timeOfLastMovement === undefined ? Infinity : now - timeOfLastMovement - STILL_DELAY_MILLISECONDS;
  const isMoving = stillFor < 0;
  const detailProgress = isMoving ? 0 : Math.min(stillFor / DETAIL_EASE_IN_MILLISECONDS, 1);
  // Eased, so the stars start and finish filling in gently.
  const easedDetail = detailProgress * detailProgress * (3 - 2 * detailProgress);
  return {
    isMoving,
    resolutionScale: isMoving ? settings.reducedResolutionScale : 1,
    starBudget: settings.starBudgetWhileMoving + (settings.starBudget - settings.starBudgetWhileMoving) * easedDetail,
    isEasingIn: !isMoving && detailProgress < 1,
  };
}
