// Elite Dangerous galactic coordinates use x towards galactic east, y up out of
// the galactic plane and z towards the galactic core (Sagittarius A* is at
// roughly z = 25,900). That is a left-handed system. three.js is right-handed,
// so every galactic position is drawn with its z negated. Without the flip the
// galaxy would appear mirrored.
//
// Every conversion between the two spaces goes through these functions, so
// the rest of the module never has to remember which way z points.

import { Vector3 } from 'three';

export const SAGITTARIUS_A_STAR = Object.freeze({ x: 25.21875, y: -20.90625, z: 25899.96875 });

export function galacticToScene(galacticCoordinates, targetVector = new Vector3()) {
  return targetVector.set(galacticCoordinates.x, galacticCoordinates.y, -galacticCoordinates.z);
}

export function sceneToGalactic(sceneVector) {
  return { x: sceneVector.x, y: sceneVector.y, z: -sceneVector.z };
}

export function galacticZToSceneZ(galacticZ) {
  return -galacticZ;
}

export function sceneZToGalacticZ(sceneZ) {
  return -sceneZ;
}
