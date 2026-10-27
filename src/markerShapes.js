import { CircleGeometry, RingGeometry } from 'three';

// The shapes a highlighted system's ring can take, so kinds of system can be
// told apart without relying on colour. Each is a regular polygon (a circle
// being one with many sides), turned so it sits as you'd expect: a diamond on
// its point, a square on its side, a triangle pointing up.
export const MARKER_SHAPES = Object.freeze({
  circle: Object.freeze({ sides: 48, rotation: 0 }),
  diamond: Object.freeze({ sides: 4, rotation: 0 }),
  square: Object.freeze({ sides: 4, rotation: Math.PI / 4 }),
  triangle: Object.freeze({ sides: 3, rotation: Math.PI / 2 }),
});

export const MARKER_SHAPE_NAMES = Object.freeze(Object.keys(MARKER_SHAPES));

// How far the outline's outer edge sits from the centre, measured to the
// middle of a side rather than to a corner, for a marker of radius 1. Shapes
// with fewer sides sit a little further out, so that each looks about as big
// as the circle.
const OUTER_EDGE_DISTANCE = Object.freeze({ circle: 1, diamond: 0.92, square: 0.88, triangle: 0.8 });
const OUTLINE_THICKNESS = 0.19;
// The dot in the middle of a marker with centreDot.
export const CENTRE_DOT_RADIUS = 0.4;

// Distance from the centre to a corner, for a given distance to the middle of
// a side.
function cornerDistance(shapeName, edgeDistance) {
  const { sides } = MARKER_SHAPES[shapeName];
  return edgeDistance / Math.cos(Math.PI / sides);
}

// An outline of the shape for a marker of radius 1. grow widens it both ways,
// for the dark backing behind it; solid fills the middle in, for a backing
// behind a centre dot.
export function createMarkerOutlineGeometry(shapeName, { grow = 0, solid = false } = {}) {
  const { sides, rotation } = MARKER_SHAPES[shapeName];
  const outerEdge = OUTER_EDGE_DISTANCE[shapeName] + grow;
  const innerEdge = solid ? 0 : Math.max(OUTER_EDGE_DISTANCE[shapeName] - OUTLINE_THICKNESS - grow, 0);
  return new RingGeometry(cornerDistance(shapeName, innerEdge), cornerDistance(shapeName, outerEdge), sides, 1, rotation);
}

export function createCentreDotGeometry() {
  return new CircleGeometry(CENTRE_DOT_RADIUS, 24);
}

// The corners of the shape's outer edge, for a marker of the given radius
// centred on (0, 0) with y pointing up: for drawing the shape elsewhere, such
// as in a legend.
export function markerOutlineCorners(shapeName, radius) {
  const { sides, rotation } = MARKER_SHAPES[shapeName];
  const distance = cornerDistance(shapeName, OUTER_EDGE_DISTANCE[shapeName] - OUTLINE_THICKNESS / 2) * radius;
  return Array.from({ length: sides }, (unused, cornerIndex) => {
    const angle = rotation + cornerIndex * 2 * Math.PI / sides;
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  });
}

// Whether a highlighted system is marked out from ordinary ones, by colour,
// shape or a centre dot.
export function hasDistinctMarker(system) {
  return system?.colour !== undefined
    || (system?.shape !== undefined && system.shape !== 'circle')
    || system?.centreDot === true;
}
