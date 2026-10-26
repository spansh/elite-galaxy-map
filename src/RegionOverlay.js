import {
    Color, DataTexture, DoubleSide, Group, Mesh, NearestFilter, PlaneGeometry, RedFormat, ShaderMaterial, UnsignedByteType, Vector3,
} from 'three';
import { Text } from 'troika-three-text';
import { galacticZToSceneZ } from './coordinates.js';
import { placeLabels } from './labelPlacement.js';

// The borders and names of the galactic regions (see galaxyRegions.js),
// drawn over the finished picture like the grid, on the grid's plane:
// regions have no height, so they follow the grid as it moves to the
// selected system's height.
//
// The borders are one flat square over the whole region map. Its shader
// looks up the region under each pixel and under the pixels next to it on
// screen, and draws a border where they differ, so the lines stay a pixel or
// two wide at any zoom. Borders are lines, not coloured areas, so they can
// be read without telling colours apart.
//
// The names face the camera at a fixed size on screen, each at the point of
// its region furthest from its edges. Bigger regions are named first; a name
// that would cover another, a system's name or ring, or the grid label is
// left out, as is the name of a region too small on screen to hold it.

export const DEFAULT_REGION_APPEARANCE = Object.freeze({
    borderColour: '#b5cfe0',
    borderOpacity: 0.55,
    labelColour: '#a9c6d8',
    labelOpacity: 0.8,
    // In CSS pixels.
    labelFontSize: 12,
});

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

    uniform sampler2D regionOfCell;
    uniform vec2 mapOrigin;
    uniform vec2 mapSizeInLightYears;
    uniform vec3 borderColour;
    uniform float borderOpacity;

    varying vec2 galacticXZ;

    float regionAt(vec2 mapPosition) {
        return floor(texture2D(regionOfCell, mapPosition).r * 255.0 + 0.5);
    }

    void main() {
        vec2 mapPosition = (galacticXZ - mapOrigin) / mapSizeInLightYears;
        // A pixel and a half across and up the screen, in map units, so
        // borders come out about three pixels wide, softer at their edges.
        vec2 pixelAcross = dFdx(mapPosition) * 1.5;
        vec2 pixelUp = dFdy(mapPosition) * 1.5;
        float here = regionAt(mapPosition);
        // How many of the four pixels around this one are in another region.
        float differing = 0.0;
        differing += step(0.5, abs(regionAt(mapPosition + pixelAcross) - here));
        differing += step(0.5, abs(regionAt(mapPosition - pixelAcross) - here));
        differing += step(0.5, abs(regionAt(mapPosition + pixelUp) - here));
        differing += step(0.5, abs(regionAt(mapPosition - pixelUp) - here));
        float coverage = min(differing * 0.5, 1.0);
        if (coverage < 0.01) {
            discard;
        }
        gl_FragColor = vec4(borderColour, borderOpacity * coverage);
    }
`;

// Names are only shown for regions at least this many times as wide on
// screen as the name itself (judged by the square root of their area).
const REGION_WIDTH_PER_NAME_WIDTH = 1.2;

export class RegionOverlay {
    // regions: a GalaxyRegions (see galaxyRegions.js).
    constructor({ regions, fontUrl, appearance = {}, onTextReady }) {
        this.regions = regions;
        this.appearance = { ...DEFAULT_REGION_APPEARANCE, ...appearance };
        this.galacticHeight = 0;
        this.isVisible = true;
        this.sceneObject = new Group();
        this.sceneObject.name = 'galactic regions';

        const cellSize = regions.cellSizeInLightYears;
        const mapWidth = regions.width * cellSize;
        const mapHeight = regions.height * cellSize;
        // Row 0 of the texture is the lowest z, as in the region map.
        this.texture = new DataTexture(regions.regionOfCell, regions.width, regions.height, RedFormat, UnsignedByteType);
        this.texture.magFilter = NearestFilter;
        this.texture.minFilter = NearestFilter;
        this.texture.generateMipmaps = false;
        this.texture.needsUpdate = true;
        this.material = new ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                regionOfCell: { value: this.texture },
                mapOrigin: { value: [regions.originX, regions.originZ] },
                mapSizeInLightYears: { value: [mapWidth, mapHeight] },
                borderColour: { value: new Color(this.appearance.borderColour) },
                borderOpacity: { value: this.appearance.borderOpacity },
            },
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: DoubleSide,
        });
        const planeGeometry = new PlaneGeometry(mapWidth, mapHeight);
        planeGeometry.rotateX(-Math.PI / 2);
        this.borders = new Mesh(planeGeometry, this.material);
        this.borders.frustumCulled = false;
        // After the grid (-10), before its label (-5) and the markers.
        this.borders.renderOrder = -9;
        this.mapCentre = { x: regions.originX + mapWidth / 2, z: regions.originZ + mapHeight / 2 };
        this.sceneObject.add(this.borders);

        // Biggest regions first: they get first claim on room for their name.
        this.labels = regions.allRegions
            .sort((first, second) => second.areaInCells - first.areaInCells)
            .map(region => {
                const billboard = new Group();
                const text = new Text();
                text.font = fontUrl;
                text.text = region.name.toUpperCase();
                text.fontSize = this.appearance.labelFontSize;
                text.letterSpacing = 0.08;
                text.anchorX = 'center';
                text.anchorY = 'middle';
                text.color = this.appearance.labelColour;
                text.fillOpacity = this.appearance.labelOpacity;
                text.outlineWidth = '8%';
                text.outlineColor = '#000000';
                text.outlineOpacity = 0.7;
                for (const material of [text.material].flat()) {
                    material.depthTest = false;
                    material.depthWrite = false;
                }
                text.renderOrder = -4;
                text.sync(onTextReady);
                billboard.add(text);
                billboard.visible = false;
                this.sceneObject.add(billboard);
                return { region, billboard, text };
            });
    }

    setGalacticHeight(galacticHeight) {
        this.galacticHeight = galacticHeight;
    }

    set visible(isVisible) {
        this.isVisible = isVisible;
        this.sceneObject.visible = isVisible;
    }

    get visible() {
        return this.isVisible;
    }

    // Called before each render, after the system names are placed:
    // obstacles are the screen areas they, their rings and the grid label
    // take up (pixels, y up), which region names keep clear of.
    updateForCamera({ camera, pixelsPerLightYearAtUnitDistance, viewportWidth, viewportHeight, obstacles = [] }) {
        if (!this.isVisible) {
            return;
        }
        this.borders.position.set(this.mapCentre.x, this.galacticHeight, galacticZToSceneZ(this.mapCentre.z));

        // Flat things are unreadable seen edge on, so names fade out as the
        // view gets close to level with the plane, as the grid label does.
        const viewDirection = new Vector3();
        camera.getWorldDirection(viewDirection);
        const viewSteepness = Math.abs(viewDirection.y);
        const edgeOnFade = Math.min(Math.max((viewSteepness - 0.08) / 0.15, 0), 1);

        const requests = [];
        const requested = [];
        for (const label of this.labels) {
            label.billboard.visible = false;
            if (edgeOnFade <= 0) {
                continue;
            }
            const bounds = label.text.textRenderInfo?.blockBounds;
            if (!bounds) {
                continue;
            }
            const anchor = new Vector3(label.region.labelX, this.galacticHeight, galacticZToSceneZ(label.region.labelZ));
            const projected = anchor.clone().project(camera);
            if (projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2) {
                continue;
            }
            const distance = Math.max(camera.position.distanceTo(anchor), 0.001);
            const pixelsPerLightYear = pixelsPerLightYearAtUnitDistance / distance;
            const width = bounds[2] - bounds[0];
            const height = bounds[3] - bounds[1];
            const regionWidthOnScreen = Math.sqrt(label.region.areaInCells) * this.regions.cellSizeInLightYears * pixelsPerLightYear;
            if (regionWidthOnScreen < width * REGION_WIDTH_PER_NAME_WIDTH) {
                continue;
            }
            const screenX = (projected.x + 1) / 2 * viewportWidth;
            const screenY = (projected.y + 1) / 2 * viewportHeight;
            // Only whole names: one cut off by the edge of the map is no use.
            const fitsOnScreen = screenX - width / 2 >= 0 && screenX + width / 2 <= viewportWidth
                && screenY - height / 2 >= 0 && screenY + height / 2 <= viewportHeight;
            if (!fitsOnScreen) {
                continue;
            }
            requests.push({ anchorX: screenX - width / 2, anchorY: screenY, gapFromAnchor: 0, width, height, canMove: false });
            requested.push({ label, anchor, distance, pixelsPerLightYear });
        }
        const placements = placeLabels(requests, obstacles);
        placements.forEach((placement, index) => {
            const { label, anchor, pixelsPerLightYear } = requested[index];
            if (!placement.isShown) {
                return;
            }
            label.billboard.visible = true;
            label.billboard.position.copy(anchor);
            label.billboard.quaternion.copy(camera.quaternion);
            label.billboard.scale.setScalar(1 / pixelsPerLightYear);
            label.text.fillOpacity = this.appearance.labelOpacity * edgeOnFade;
            label.text.outlineOpacity = 0.7 * edgeOnFade;
        });
    }

    dispose() {
        this.borders.geometry.dispose();
        this.material.dispose();
        this.texture.dispose();
        for (const label of this.labels) {
            label.text.dispose();
        }
    }
}
