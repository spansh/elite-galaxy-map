import { AdditiveBlending, BackSide, BoxGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { galacticZToSceneZ } from '../coordinates.js';

// The galaxy glow: a glowing volume of dust. The galaxy is a box the size of
// the density map; each pixel on screen walks a ray through the box, adding
// up light from the density map with a soft falloff above and below the
// galactic plane (thicker where the map is brighter, so the core bulges).
//
// It is smooth, with no grain, and looks right edge-on. The cost is per
// pixel, so it depends on screen size rather than the map; the stepCount
// setting trades quality for speed.

const vertexShader = /* glsl */ `
    varying vec3 worldPosition;
    void main() {
        vec4 position4 = modelMatrix * vec4(position, 1.0);
        worldPosition = position4.xyz;
        gl_Position = projectionMatrix * viewMatrix * position4;
    }
`;

const fragmentShader = /* glsl */ `
    precision highp float;

    uniform sampler2D densityMap;
    uniform vec3 boxMinimum;
    uniform vec3 boxMaximum;
    uniform float planeHeight;
    uniform float thinnestDisc;
    uniform float thickestBulge;
    uniform float nearFadeDistance;
    uniform float backdropOpacity;
    uniform float brightness;

    varying vec3 worldPosition;

    #define STEP_COUNT __STEP_COUNT__

    // Cheap per-pixel noise used to stagger where each ray starts sampling,
    // which turns banding between steps into fine, invisible grain.
    float interleavedGradientNoise(vec2 pixel) {
        return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    }

    void main() {
        vec3 rayDirection = normalize(worldPosition - cameraPosition);
        vec3 inverseDirection = 1.0 / rayDirection;
        vec3 entryDistances = (boxMinimum - cameraPosition) * inverseDirection;
        vec3 exitDistances = (boxMaximum - cameraPosition) * inverseDirection;
        vec3 nearestDistances = min(entryDistances, exitDistances);
        vec3 farthestDistances = max(entryDistances, exitDistances);
        float rayStart = max(max(max(nearestDistances.x, nearestDistances.y), nearestDistances.z), 0.0);
        float rayEnd = min(min(farthestDistances.x, farthestDistances.y), farthestDistances.z);
        if (rayEnd <= rayStart) {
            discard;
        }

        float stepLength = (rayEnd - rayStart) / float(STEP_COUNT);
        float sampleDistance = rayStart + stepLength * interleavedGradientNoise(gl_FragCoord.xy);
        vec3 boxSize = boxMaximum - boxMinimum;
        vec3 gatheredLight = vec3(0.0);

        for (int stepIndex = 0; stepIndex < STEP_COUNT; stepIndex++) {
            vec3 samplePosition = cameraPosition + rayDirection * sampleDistance;
            // Galactic z is the negated scene z, and the top of the map is the
            // highest galactic z, so v runs with -z.
            vec2 mapPosition = vec2(
                (samplePosition.x - boxMinimum.x) / boxSize.x,
                (boxMaximum.z - samplePosition.z) / boxSize.z
            );
            vec3 mapColour = texture2D(densityMap, mapPosition).rgb;
            float mapBrightness = dot(mapColour, vec3(0.299, 0.587, 0.114));
            float thickness = mix(thinnestDisc, thickestBulge, mapBrightness * mapBrightness);
            float heightAbovePlane = samplePosition.y - planeHeight;
            float verticalFalloff = exp(-0.5 * heightAbovePlane * heightAbovePlane / (thickness * thickness));
            float nearFade = smoothstep(0.0, nearFadeDistance, sampleDistance);
            // Divide by thickness so a thick bulge is not also much brighter
            // than a thin arm with the same map brightness.
            gatheredLight += mapColour * mapBrightness * verticalFalloff * nearFade * stepLength / thickness;
            sampleDistance += stepLength;
        }

        gl_FragColor = vec4(gatheredLight * brightness * backdropOpacity, 1.0);
    }
`;

export const DEFAULT_VOLUMETRIC_SETTINGS = Object.freeze({
    thinnestDiscLightYears: 150,
    thickestBulgeLightYears: 1800,
    boxHeightLightYears: 10000,
    planeGalacticHeight: -21,
    stepCount: 48,
    brightness: 0.08,
});

export class VolumetricBackdrop {
    constructor(densityMap, settings = {}) {
        const volumeSettings = { ...DEFAULT_VOLUMETRIC_SETTINGS, ...settings };
        const area = densityMap.area;
        const boxCentre = new Vector3(area.centreX, volumeSettings.planeGalacticHeight, galacticZToSceneZ(area.centreZ));
        const boxHalfSize = new Vector3(area.widthInLightYears / 2, volumeSettings.boxHeightLightYears / 2, area.widthInLightYears / 2);

        this.material = new ShaderMaterial({
            vertexShader,
            fragmentShader: fragmentShader.replace('__STEP_COUNT__', String(Math.round(volumeSettings.stepCount))),
            uniforms: {
                densityMap: { value: densityMap.texture },
                boxMinimum: { value: boxCentre.clone().sub(boxHalfSize) },
                boxMaximum: { value: boxCentre.clone().add(boxHalfSize) },
                planeHeight: { value: volumeSettings.planeGalacticHeight },
                thinnestDisc: { value: volumeSettings.thinnestDiscLightYears },
                thickestBulge: { value: volumeSettings.thickestBulgeLightYears },
                nearFadeDistance: { value: 3000 },
                backdropOpacity: { value: 1 },
                brightness: { value: volumeSettings.brightness },
            },
            // Drawing the inside faces means the volume still renders when the
            // camera is inside the box, which is most of the time.
            side: BackSide,
            blending: AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
        const boxGeometry = new BoxGeometry(boxHalfSize.x * 2, boxHalfSize.y * 2, boxHalfSize.z * 2);
        this.sceneObject = new Mesh(boxGeometry, this.material);
        this.sceneObject.position.copy(boxCentre);
        this.sceneObject.name = 'volumetric backdrop';
        this.sceneObject.renderOrder = -20;
        this.sceneObject.frustumCulled = false;
    }

    updateForCamera({ cameraDistanceFromTarget, opacity }) {
        this.material.uniforms.backdropOpacity.value = opacity;
        this.material.uniforms.nearFadeDistance.value = Math.min(Math.max(cameraDistanceFromTarget * 0.6, 400), 6000);
    }

    dispose() {
        this.sceneObject.geometry.dispose();
        this.material.dispose();
    }
}
