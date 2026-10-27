import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three';

// Arrowheads half way along each leg of a route, pointing the way the route
// goes, or a little further along on a leg it also travels the other way so
// the two arrows don't overlap. They are a fixed size in pixels and always
// lie flat to the screen, turned to follow each leg as it appears on screen.
// All the arrows are one instanced mesh, one draw call however long the route.

const ARROW_HALF_SIZE_PIXELS = 8;
// Each arrow sits on a larger dark copy of itself, so it stands out against
// a bright, crowded star field.
const BACKING_SCALE = 1.6;
// A leg must be at least this many arrow lengths long on screen to get an
// arrow; otherwise the arrow would hide the leg (for example one pointing
// almost straight at the camera).
const MINIMUM_LEG_LENGTH_IN_ARROWS = 3;
// A leg travelled both ways must be longer, to fit two arrows apart.
const MINIMUM_TWO_WAY_LEG_LENGTH_IN_ARROWS = 4;
// How far past the middle of a leg travelled both ways its arrow sits, in
// arrow lengths, on screen: far enough that the two arrows' dark backings
// don't touch.
const TWO_WAY_ARROW_SHIFT_IN_ARROWS = 1;

// Whether a leg gets an arrow, which way it points on screen (radians,
// anticlockwise from screen-up), and how far along the leg it sits on screen
// (0 at the start, 1 at the end). Screen positions are pixels with y up.
export function placeArrowOnLeg(legStartOnScreen, legEndOnScreen, { isTravelledBothWays = false, arrowHalfSizePixels = ARROW_HALF_SIZE_PIXELS } = {}) {
  const acrossScreen = legEndOnScreen.x - legStartOnScreen.x;
  const upScreen = legEndOnScreen.y - legStartOnScreen.y;
  const legLengthOnScreen = Math.hypot(acrossScreen, upScreen);
  const arrowLength = arrowHalfSizePixels * 2;
  const minimumLengthInArrows = isTravelledBothWays ? MINIMUM_TWO_WAY_LEG_LENGTH_IN_ARROWS : MINIMUM_LEG_LENGTH_IN_ARROWS;
  if (legLengthOnScreen < arrowLength * minimumLengthInArrows) {
    return { isShown: false, angle: 0, fractionAlongLeg: 0.5 };
  }
  const fractionAlongLeg = isTravelledBothWays
    ? 0.5 + arrowLength * TWO_WAY_ARROW_SHIFT_IN_ARROWS / legLengthOnScreen
    : 0.5;
    // The arrow shape points up, so turn it from up to the leg's direction.
  return { isShown: true, angle: Math.atan2(-acrossScreen, upScreen), fractionAlongLeg };
}

// Where a point a fraction of the way along a leg on screen is along the leg
// in space. Perspective squeezes the far part of a leg, so the two differ
// unless both ends are the same distance in front of the camera.
// startDepth, endDepth: each end's distance in front of the camera.
export function fractionInSpaceForFractionOnScreen(fractionOnScreen, startDepth, endDepth) {
  return fractionOnScreen * startDepth / ((1 - fractionOnScreen) * endDepth + fractionOnScreen * startDepth);
}

// A chevron pointing up (+y), one unit from its centre to its tip, with a
// notch in the back.
function createArrowGeometry() {
  const tip = [0, 1, 0];
  const leftWing = [-0.8, -0.8, 0];
  const notch = [0, -0.35, 0];
  const rightWing = [0.8, -0.8, 0];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([...tip, ...leftWing, ...notch, ...tip, ...notch, ...rightWing]), 3));
  return geometry;
}

export class RouteArrows {
  // routePositions: scene positions of the route's systems, in order.
  // legsTravelledBothWays: true or false for each leg (see
  // findLegsTravelledBothWays in highlightPlaces.js).
  constructor(routePositions, colour, { legsTravelledBothWays = [] } = {}) {
    this.legStarts = routePositions.slice(0, -1);
    this.legEnds = routePositions.slice(1);
    this.legsTravelledBothWays = legsTravelledBothWays;
    this.geometry = createArrowGeometry();
    this.material = new MeshBasicMaterial({
      color: new Color(colour), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: DoubleSide,
    });
    this.backingMaterial = new MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, side: DoubleSide,
    });
    this.arrows = new InstancedMesh(this.geometry, this.material, this.legStarts.length);
    this.backings = new InstancedMesh(this.geometry, this.backingMaterial, this.legStarts.length);
    for (const instancedMesh of [this.arrows, this.backings]) {
      instancedMesh.frustumCulled = false;
    }
    this.backings.renderOrder = 98.5;
    this.arrows.renderOrder = 99;
    this.sceneObject = new Group();
    this.sceneObject.add(this.backings, this.arrows);
    this.sceneObject.name = 'route arrows';
  }

  updateForCamera({ camera, viewportWidth, viewportHeight, pixelsPerLightYearAtUnitDistance }) {
    const depthInFrontOfCamera = scenePosition => -scenePosition.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const toScreen = scenePosition => {
      const projected = scenePosition.clone().project(camera);
      return { x: (projected.x + 1) / 2 * viewportWidth, y: (projected.y + 1) / 2 * viewportHeight, isBehindCamera: projected.z > 1 };
    };
    const arrowMatrix = new Matrix4();
    const arrowRotation = new Quaternion();
    const turnOnScreen = new Quaternion();
    const middleOfLeg = new Vector3();
    const arrowPosition = new Vector3();
    const arrowScale = new Vector3();
    const screenFacingAxis = new Vector3(0, 0, 1);
    for (let legIndex = 0; legIndex < this.legStarts.length; legIndex++) {
      const legStart = this.legStarts[legIndex];
      const legEnd = this.legEnds[legIndex];
      middleOfLeg.addVectors(legStart, legEnd).multiplyScalar(0.5);
      const startOnScreen = toScreen(legStart);
      const endOnScreen = toScreen(legEnd);
      const middleIsBehindCamera = toScreen(middleOfLeg).isBehindCamera;
      const placement = placeArrowOnLeg(startOnScreen, endOnScreen, { isTravelledBothWays: this.legsTravelledBothWays[legIndex] === true });
      if (!placement.isShown || middleIsBehindCamera || startOnScreen.isBehindCamera || endOnScreen.isBehindCamera) {
        // A zero-size arrow draws nothing.
        arrowMatrix.makeScale(0, 0, 0);
        this.arrows.setMatrixAt(legIndex, arrowMatrix);
        this.backings.setMatrixAt(legIndex, arrowMatrix);
        continue;
      }
      // Face the screen, then turn within the screen to follow the leg.
      turnOnScreen.setFromAxisAngle(screenFacingAxis, placement.angle);
      arrowRotation.copy(camera.quaternion).multiply(turnOnScreen);
      const fractionInSpace = fractionInSpaceForFractionOnScreen(placement.fractionAlongLeg, depthInFrontOfCamera(legStart), depthInFrontOfCamera(legEnd));
      arrowPosition.lerpVectors(legStart, legEnd, fractionInSpace);
      const lightYearsPerPixel = camera.position.distanceTo(arrowPosition) / pixelsPerLightYearAtUnitDistance;
      arrowScale.setScalar(lightYearsPerPixel * ARROW_HALF_SIZE_PIXELS);
      arrowMatrix.compose(arrowPosition, arrowRotation, arrowScale);
      this.arrows.setMatrixAt(legIndex, arrowMatrix);
      arrowScale.multiplyScalar(BACKING_SCALE);
      arrowMatrix.compose(arrowPosition, arrowRotation, arrowScale);
      this.backings.setMatrixAt(legIndex, arrowMatrix);
    }
    this.arrows.instanceMatrix.needsUpdate = true;
    this.backings.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.backingMaterial.dispose();
    this.arrows.dispose();
    this.backings.dispose();
  }
}
