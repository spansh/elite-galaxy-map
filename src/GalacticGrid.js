import {
    AddEquation, Color, CustomBlending, DoubleSide, Group, Mesh, OneFactor, OneMinusDstColorFactor, PlaneGeometry, ShaderMaterial, Vector3,
} from 'three';
import { Text } from 'troika-three-text';
import { galacticZToSceneZ } from './coordinates.js';
import { GRID_SPACINGS_IN_LIGHT_YEARS, chooseLabelledGridSpacing, formatGridCoordinates, nearestGridCorner } from './gridMaths.js';

// A flat grid at one galactic height, with 10, 100, 1,000 and 10,000 ly
// squares. Rather than switching whole grids on and off at fixed camera
// distances, the fragment shader works out, pixel by pixel, how close
// together each grid's lines are on screen and fades a grid out as its lines
// crowd together. The fine grids therefore disappear smoothly as you zoom
// out, and also towards the horizon when the grid is seen at a shallow angle.
//
// The grid is drawn on top of the finished picture, always at full
// resolution, rather than with the stars: those are drawn at reduced
// resolution while the view moves, and the grid's one pixel lines would blur
// and dim there, then sharpen with a pop when movement stops. It is "screen"
// blended (result = picture + grid x (1 - picture)): over dark space that is
// simply adding its light, and over bright areas it adds less, as it did
// when it went through the tone mapping with the stars.
//
// The grid plane is moved to the height of the selected system. The
// nearest grid corner to the point the camera orbits around gets
// a coordinate label laid flat on the grid.

const vertexShader = /* glsl */ `
    varying vec2 galacticXZ;

    void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        galacticXZ = vec2(worldPosition.x, -worldPosition.z);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

const fragmentShader = /* glsl */ `
    precision highp float;

    uniform float gridSpacings[4];
    uniform vec3 gridColours[4];
    uniform float gridOpacities[4];
    uniform vec3 axisColour;
    uniform float axisOpacity;
    uniform vec2 fadeCentre;
    uniform float fadeRadius;
    // The same brightness squeeze the stars get (see ToneMappingPass), so
    // the grid looks the same as when it was drawn with them.
    uniform float exposure;

    varying vec2 galacticXZ;

    vec3 linearToSrgb(vec3 linearColour) {
        vec3 lowPart = linearColour * 12.92;
        vec3 highPart = 1.055 * pow(linearColour, vec3(1.0 / 2.4)) - 0.055;
        return mix(lowPart, highPart, step(vec3(0.0031308), linearColour));
    }

    // How much of this pixel is covered by a line of a grid with this
    // spacing, already faded according to how crowded that grid's lines are.
    float gridLineCoverage(float spacing) {
        vec2 positionInSquares = galacticXZ / spacing;
        vec2 squaresPerPixel = fwidth(positionInSquares);
        vec2 pixelsFromLine = abs(fract(positionInSquares - 0.5) - 0.5) / max(squaresPerPixel, vec2(1e-6));
        float coverage = 1.0 - min(min(pixelsFromLine.x, pixelsFromLine.y), 1.0);
        float pixelsBetweenLines = 1.0 / max(max(squaresPerPixel.x, squaresPerPixel.y), 1e-6);
        float crowdingFade = smoothstep(5.0, 24.0, pixelsBetweenLines);
        return coverage * crowdingFade;
    }

    void main() {
        vec3 colour = vec3(0.0);
        float opacity = 0.0;
        for (int gridIndex = 0; gridIndex < 4; gridIndex++) {
            float coverage = gridLineCoverage(gridSpacings[gridIndex]) * gridOpacities[gridIndex];
            if (coverage > opacity) {
                opacity = coverage;
                colour = gridColours[gridIndex];
            }
        }

        // Lines through Sol (x = 0 and z = 0), marking the quadrants.
        vec2 pixelsPerLightYear = fwidth(galacticXZ);
        vec2 pixelsFromAxis = abs(galacticXZ) / max(pixelsPerLightYear, vec2(1e-6));
        float axisCoverage = (1.0 - min(min(pixelsFromAxis.x, pixelsFromAxis.y) / 1.5, 1.0)) * axisOpacity;
        if (axisCoverage > opacity) {
            opacity = axisCoverage;
            colour = axisColour;
        }

        float distanceFromCentre = length(galacticXZ - fadeCentre);
        opacity *= 1.0 - smoothstep(fadeRadius * 0.4, fadeRadius, distanceFromCentre);
        if (opacity < 0.004) {
            discard;
        }
        vec3 light = 1.0 - exp(-colour * opacity * exposure);
        gl_FragColor = vec4(linearToSrgb(light), 1.0);
    }
`;

export const DEFAULT_GRID_APPEARANCE = Object.freeze({
    gridColours: ['#2b4656', '#335568', '#3e6880', '#4f7f99'],
    gridOpacities: [0.18, 0.24, 0.3, 0.34],
    axisColour: '#b8772c',
    axisOpacity: 0.45,
    labelColour: '#9cc7de',
    labelOpacity: 0.85,
});

export class GalacticGrid {
    constructor({ fontUrl, appearance = {}, exposure = 1.2 }) {
        this.appearance = { ...DEFAULT_GRID_APPEARANCE, ...appearance };
        this.galacticHeight = 0;

        this.material = new ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                gridSpacings: { value: [...GRID_SPACINGS_IN_LIGHT_YEARS] },
                gridColours: { value: this.appearance.gridColours.map(colour => new Color(colour)) },
                gridOpacities: { value: [...this.appearance.gridOpacities] },
                axisColour: { value: new Color(this.appearance.axisColour) },
                axisOpacity: { value: this.appearance.axisOpacity },
                fadeCentre: { value: [0, 0] },
                fadeRadius: { value: 100000 },
                exposure: { value: exposure },
            },
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: CustomBlending,
            blendEquation: AddEquation,
            blendSrc: OneMinusDstColorFactor,
            blendDst: OneFactor,
            side: DoubleSide,
        });
        // One square, scaled each frame to cover the area around the camera
        // target. Keeping it no bigger than needed keeps the interpolated
        // coordinates precise.
        const planeGeometry = new PlaneGeometry(1, 1);
        planeGeometry.rotateX(-Math.PI / 2);
        this.plane = new Mesh(planeGeometry, this.material);
        this.plane.frustumCulled = false;
        this.plane.renderOrder = -10;
        this.plane.name = 'galactic grid';
        // The plane and its label are both drawn over the finished picture,
        // at full resolution; the plane first, so markers and text go on top.
        this.planeSceneObject = this.plane;

        // The label is laid flat on the grid. labelHolder turns about the
        // vertical axis to face the camera's direction so the text is never
        // upside down; the text itself is tipped over to lie flat.
        this.labelHolder = new Group();
        this.label = new Text();
        this.label.font = fontUrl;
        this.label.anchorX = 'left';
        this.label.anchorY = 'bottom';
        this.label.color = this.appearance.labelColour;
        this.label.fillOpacity = this.appearance.labelOpacity;
        this.label.outlineWidth = '4%';
        this.label.outlineColor = '#000000';
        this.label.outlineOpacity = 0.6;
        // With an outline, troika's material is a list (outline, then fill),
        // so the depth settings go on each. The label is drawn over
        // everything else in its layer, and leaves no depth behind to clip
        // the system names drawn after it.
        for (const material of [this.label.material].flat()) {
            material.depthTest = false;
            material.depthWrite = false;
        }
        this.label.renderOrder = -5;
        this.label.rotation.x = -Math.PI / 2;
        this.labelHolder.add(this.label);
        this.labelHolder.name = 'grid coordinate label';
        this.labelSceneObject = this.labelHolder;
        this.labelIsEnabled = true;
        this.labelledCornerText = null;
        this.isVisible = true;
    }

    setGalacticHeight(galacticHeight) {
        this.galacticHeight = galacticHeight;
    }

    // Called before each render. orbitTarget is in scene coordinates.
    // Returns true if the label text changed (troika then re-renders when its
    // new glyphs are ready, through onTextReady).
    updateForCamera({ camera, orbitTarget, pixelsPerLightYearAtUnitDistance, onTextReady }) {
        const cameraDistance = camera.position.distanceTo(orbitTarget);
        const cameraHeightAboveGrid = camera.position.y - this.galacticHeight;
        const viewReach = Math.max(cameraDistance, Math.abs(cameraHeightAboveGrid)) * 12;
        const planeSize = Math.min(Math.max(viewReach, 2000), 800000);

        // Snap the plane's centre to the coarsest grid so moving it never
        // moves the lines themselves.
        const coarsestSpacing = GRID_SPACINGS_IN_LIGHT_YEARS[GRID_SPACINGS_IN_LIGHT_YEARS.length - 1];
        this.plane.position.set(
            Math.round(orbitTarget.x / coarsestSpacing) * coarsestSpacing,
            this.galacticHeight,
            Math.round(orbitTarget.z / coarsestSpacing) * coarsestSpacing,
        );
        this.plane.scale.set(planeSize + coarsestSpacing * 2, 1, planeSize + coarsestSpacing * 2);
        this.material.uniforms.fadeCentre.value = [orbitTarget.x, -orbitTarget.z];
        this.material.uniforms.fadeRadius.value = planeSize / 2;

        // Label: the grid corner nearest the orbit target, on the finest grid
        // with room for the text.
        const pixelsPerLightYearAtTarget = pixelsPerLightYearAtUnitDistance / Math.max(cameraDistance, 1);
        const labelSpacing = chooseLabelledGridSpacing(pixelsPerLightYearAtTarget);
        const corner = nearestGridCorner(orbitTarget.x, -orbitTarget.z, labelSpacing);
        const cornerText = formatGridCoordinates(corner.x, this.galacticHeight, corner.z);

        this.labelHolder.position.set(corner.x, this.galacticHeight, galacticZToSceneZ(corner.z));
        const cameraDirection = new Vector3().subVectors(orbitTarget, camera.position);
        this.labelHolder.rotation.y = Math.atan2(-cameraDirection.x, -cameraDirection.z);
        // Seen from below, tip the text the other way so it faces down. Its
        // top then points back towards the camera, which is "up" on screen
        // when looking up at the underside of the grid.
        const cameraIsBelowGrid = cameraHeightAboveGrid < 0;
        this.label.rotation.x = cameraIsBelowGrid ? Math.PI / 2 : -Math.PI / 2;
        // Fade the label when looking along the grid edge-on, where flat text
        // would be an unreadable sliver.
        const viewSteepness = Math.abs(cameraHeightAboveGrid) / Math.max(cameraDistance, 1);
        const edgeOnFade = Math.min(Math.max((viewSteepness - 0.08) / 0.15, 0), 1);
        this.label.fillOpacity = this.appearance.labelOpacity * edgeOnFade;
        this.label.outlineOpacity = 0.6 * edgeOnFade;

        // A tenth of the grid square, but never so small it can't be read,
        // and never so big it swamps the view (which happens when even the
        // coarsest grid's squares are small on screen). Rounded so tiny zoom
        // changes don't re-lay out the text every frame.
        const minimumReadableFontSize = 16 / pixelsPerLightYearAtTarget;
        const largestSensibleFontSize = 26 / pixelsPerLightYearAtTarget;
        const unroundedFontSize = Math.min(Math.max(labelSpacing * 0.1, minimumReadableFontSize), largestSensibleFontSize);
        const fontSizeStep = Math.pow(2, Math.floor(Math.log2(unroundedFontSize)) - 2);
        const fontSize = Math.ceil(unroundedFontSize / fontSizeStep) * fontSizeStep;
        const textChanged = cornerText !== this.labelledCornerText || this.label.fontSize !== fontSize;
        if (textChanged) {
            this.labelledCornerText = cornerText;
            this.label.text = cornerText;
            this.label.fontSize = fontSize;
            this.label.position.set(labelSpacing * 0.03, 0, 0);
            this.label.sync(onTextReady);
        }
        return textChanged;
    }

    set visible(isVisible) {
        this.isVisible = isVisible;
        this.planeSceneObject.visible = isVisible;
        this.labelSceneObject.visible = isVisible && this.labelIsEnabled;
    }

    get visible() {
        return this.isVisible;
    }

    // Shows or hides the coordinate label, independently of the grid lines.
    setLabelEnabled(isEnabled) {
        this.labelIsEnabled = isEnabled;
        this.labelSceneObject.visible = this.isVisible && isEnabled;
    }

    // The area the coordinate label covers on screen, in pixels with y up,
    // so system names can keep clear of it. Null when it isn't showing.
    labelScreenRectangle(camera, viewportWidth, viewportHeight) {
        const bounds = this.label.textRenderInfo?.blockBounds;
        if (!this.isVisible || !this.labelIsEnabled || !bounds || this.label.fillOpacity < 0.05) {
            return null;
        }
        this.label.updateWorldMatrix(true, false);
        const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[0], bounds[3]], [bounds[2], bounds[3]]];
        const rectangle = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
        for (const [cornerX, cornerY] of corners) {
            const projected = new Vector3(cornerX, cornerY, 0).applyMatrix4(this.label.matrixWorld).project(camera);
            if (projected.z > 1) {
                return null;
            }
            const screenX = (projected.x + 1) / 2 * viewportWidth;
            const screenY = (projected.y + 1) / 2 * viewportHeight;
            rectangle.left = Math.min(rectangle.left, screenX);
            rectangle.right = Math.max(rectangle.right, screenX);
            rectangle.bottom = Math.min(rectangle.bottom, screenY);
            rectangle.top = Math.max(rectangle.top, screenY);
        }
        return rectangle;
    }

    setExposure(exposure) {
        this.material.uniforms.exposure.value = exposure;
    }

    dispose() {
        this.plane.geometry.dispose();
        this.material.dispose();
        this.label.dispose();
    }
}
