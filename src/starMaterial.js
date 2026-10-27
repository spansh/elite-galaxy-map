import { AdditiveBlending, Color, ShaderMaterial, Vector4 } from 'three';

// Stars are drawn as soft round points. Their size is given in light years so
// that they grow as you fly towards them. Two clamps keep the result readable:
//
//  - Points never grow beyond maximumPixelSize, so a close star cannot fill
//    the screen (and cost a screen's worth of blending). (A sampled star
//    standing in for others may grow up to twice that; see areaGrowth.)
//  - Points never shrink below minimumPixelSize. Instead of shrinking further
//    they get dimmer, so the brightness of a crowded region stays roughly
//    proportional to how many stars are in it, rather than saturating white.
//
// Every layer shares one material. Each star carries the number of its layer,
// and the shader looks up that layer's appearance in two uniform arrays, so
// a cell holding stars of many layers is still a single draw.

export const MAXIMUM_LAYER_COUNT = 64;

const vertexShader = /* glsl */ `
  #define MAXIMUM_LAYER_COUNT ${MAXIMUM_LAYER_COUNT}
  attribute float starLayer;

  // For each layer: star size in light years, smallest and largest point
  // size in pixels, and the dimmest a distant star may get.
  uniform vec4 layerAppearance[MAXIMUM_LAYER_COUNT];
  // For each layer: colour, and opacity (0 when the layer is hidden).
  uniform vec4 layerColourAndOpacity[MAXIMUM_LAYER_COUNT];
  uniform float pixelsPerLightYearAtUnitDistance;
  // Below 1 while the view moves and is drawn at lower resolution. Sizes
  // and brightness are worked out at full resolution, then the point is
  // shrunk to match, so a star gives the same light either way.
  uniform float resolutionScale;
  // A cell's stars before sampleStart are always drawn as they are (the
  // few stars of rare layers). From sampleStart on, the stars are a random
  // sample standing in for the rest, made brighter by
  // brightnessCompensation to make up for the ones not drawn.
  uniform float sampleStart;
  uniform float brightnessCompensation;
  // Stars stand in for the ones not drawn partly by growing (up to this
  // many times their area) and the rest by brightening, so a sample looks
  // like a soft glow rather than scattered bright dots.
  const float LARGEST_AREA_GROWTH = 4.0;
  // The last stars of a sample fade out between these two places in the
  // cell's (random) order, so stars fade rather than pop as the sample
  // grows and shrinks.
  uniform float fadeStart;
  uniform float fadeEnd;
  // Below 1 while a cell dissolves from one random sample of its stars to
  // another (see StarCell.startCrossFade): the outgoing sample is drawn at
  // 1 - progress and the incoming one at progress, so the light stays the
  // same throughout.
  uniform float crossFadeWeight;

  varying vec3 starLight;

  void main() {
    int layer = int(starLayer + 0.5);
    vec4 colourAndOpacity = layerColourAndOpacity[layer];
    if (colourAndOpacity.a <= 0.0) {
      // A hidden layer: put the point outside the view so it costs no
      // drawing at all.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      starLight = vec3(0.0);
      return;
    }
    vec4 appearance = layerAppearance[layer];
    float starSizeInLightYears = appearance.x;
    float minimumPixelSize = appearance.y;
    float maximumPixelSize = appearance.z;
    float minimumBrightness = appearance.w;

    float vertexNumber = float(gl_VertexID);
    bool isSampled = vertexNumber >= sampleStart;
    float compensation = isSampled ? brightnessCompensation : 1.0;
    float areaGrowth = min(compensation, LARGEST_AREA_GROWTH);

    vec4 positionRelativeToCamera = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * positionRelativeToCamera;

    float distanceFromCamera = max(-positionRelativeToCamera.z, 0.001);
    float naturalPixelSize = starSizeInLightYears * pixelsPerLightYearAtUnitDistance / distanceFromCamera;

    float pointSize = clamp(naturalPixelSize, minimumPixelSize, maximumPixelSize) * sqrt(areaGrowth);
    gl_PointSize = max(pointSize * resolutionScale, 1.0);
    // Whatever the growth in area doesn't make up, the brightness does.
    float brightness = clamp(naturalPixelSize / minimumPixelSize, minimumBrightness, 1.0) * compensation / areaGrowth;
    if (isSampled && fadeEnd > fadeStart) {
      brightness *= clamp((fadeEnd - vertexNumber) / (fadeEnd - fadeStart), 0.0, 1.0);
    }
    starLight = colourAndOpacity.rgb * colourAndOpacity.a * brightness * crossFadeWeight;
  }
`;

const fragmentShader = /* glsl */ `
  // Below 1 to dim the stars, so highlighted systems and routes stand out.
  uniform float starDimming;

  varying vec3 starLight;

  void main() {
    vec2 offsetFromCentre = gl_PointCoord * 2.0 - 1.0;
    float distanceFromCentreSquared = dot(offsetFromCentre, offsetFromCentre);
    // The corners of the square point fade to nothing rather than being
    // discarded: with additive blending nothing shows there either way,
    // and discard stops GPUs (notably Apple's) skipping hidden work.
    float insideCircle = step(distanceFromCentreSquared, 1.0);
    float brightCore = exp(-distanceFromCentreSquared * 7.0) * insideCircle;
    float softHalo = max(1.0 - distanceFromCentreSquared, 0.0) * 0.3;
    float intensity = (brightCore + softHalo) * starDimming;
    gl_FragColor = vec4(starLight * intensity, 1.0);
  }
`;

export const DEFAULT_STAR_APPEARANCE = Object.freeze({
  colour: '#9fc8ff',
  starSizeInLightYears: 4,
  minimumPixelSize: 2,
  maximumPixelSize: 24,
  minimumBrightness: 0.12,
  opacity: 1,
});

export function createStarMaterial() {
  const vectorsForEachLayer = () => Array.from({ length: MAXIMUM_LAYER_COUNT }, () => new Vector4());
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      layerAppearance: { value: vectorsForEachLayer() },
      layerColourAndOpacity: { value: vectorsForEachLayer() },
      pixelsPerLightYearAtUnitDistance: { value: 1000 },
      resolutionScale: { value: 1 },
      sampleStart: { value: 0 },
      brightnessCompensation: { value: 1 },
      fadeStart: { value: 0 },
      fadeEnd: { value: 0 },
      crossFadeWeight: { value: 1 },
      starDimming: { value: 1 },
    },
    blending: AdditiveBlending,
    // The light buffer has no depth buffer: stars simply add up.
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

const workingColour = new Color();

// Writes one layer's appearance into the material's uniform arrays. A hidden
// layer gets opacity 0, which the shader skips entirely.
export function applyLayerAppearance(material, layerIndex, appearance, isVisible) {
  material.uniforms.layerAppearance.value[layerIndex].set(
    appearance.starSizeInLightYears,
    appearance.minimumPixelSize,
    appearance.maximumPixelSize,
    appearance.minimumBrightness,
  );
  workingColour.set(appearance.colour);
  material.uniforms.layerColourAndOpacity.value[layerIndex].set(
    workingColour.r, workingColour.g, workingColour.b, isVisible ? appearance.opacity : 0,
  );
  material.uniformsNeedUpdate = true;
}
