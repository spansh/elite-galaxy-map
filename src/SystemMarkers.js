import {
    BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, PlaneGeometry,
} from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Text } from 'troika-three-text';
import { galacticToScene } from './coordinates.js';
import { formatGridCoordinates } from './gridMaths.js';
import { chooseRingsToDraw, placeLabels } from './labelPlacement.js';
import { createCentreDotGeometry, createMarkerOutlineGeometry, hasDistinctMarker } from './markerShapes.js';
import { RouteArrows } from './RouteArrows.js';

// The ring and name shown on the hovered system, and the ring, name,
// coordinates and line down to the grid shown on the selected one. Markers
// are sized in pixels: every frame they are scaled with distance so they
// look the same size wherever the camera is.

// A dark halo behind a ring, so the ring stands out against bright stars.
// It is a child of the ring, so it follows its size and visibility. Behind a
// centre dot it is filled in, so the dot stands out too.
function addDarkBacking(ring, shape, isSolid) {
    const backing = new Mesh(
        createMarkerOutlineGeometry(shape, { grow: 0.21, solid: isSolid }),
        new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: DoubleSide }),
    );
    backing.renderOrder = ring.renderOrder - 0.5;
    ring.add(backing);
    return backing;
}

// A ring of radius 1, in one of the shapes in markerShapes.js. withCentreDot
// adds a dot in the middle, a child of the ring sharing its material.
function createRing(colour, opacity, { shape = 'circle', withCentreDot = false } = {}) {
    const ring = new Mesh(
        createMarkerOutlineGeometry(shape),
        new MeshBasicMaterial({ color: new Color(colour), transparent: true, opacity, depthTest: false, depthWrite: false, side: DoubleSide }),
    );
    ring.renderOrder = 100;
    if (withCentreDot) {
        const centreDot = new Mesh(createCentreDotGeometry(), ring.material);
        centreDot.renderOrder = ring.renderOrder;
        ring.add(centreDot);
    }
    return ring;
}

// A dark, see-through plate behind a label, so names stay readable over a
// bright, crowded star field. Sized to the label's text every frame.
const LABEL_PLATE_PADDING_PIXELS = { across: 4, down: 1 };
function createLabelPlate(renderOrder) {
    const plate = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }),
    );
    plate.renderOrder = renderOrder;
    plate.visible = false;
    return plate;
}

function fitPlateToLabel(plate, label) {
    const bounds = label.textRenderInfo?.blockBounds;
    if (!label.visible || !bounds) {
        plate.visible = false;
        return;
    }
    plate.visible = true;
    plate.position.set(
        label.position.x + (bounds[0] + bounds[2]) / 2,
        label.position.y + (bounds[1] + bounds[3]) / 2,
        0,
    );
    plate.scale.set(
        bounds[2] - bounds[0] + LABEL_PLATE_PADDING_PIXELS.across * 2,
        bounds[3] - bounds[1] + LABEL_PLATE_PADDING_PIXELS.down * 2,
        1,
    );
}

function createLabel(fontUrl, colour, renderOrder) {
    const label = new Text();
    label.font = fontUrl;
    label.color = colour;
    label.anchorX = 'left';
    label.anchorY = 'middle';
    label.outlineWidth = '6%';
    label.outlineColor = '#000000';
    label.outlineOpacity = 0.7;
    // With an outline, troika's material is a list (outline, then fill), so
    // the depth settings go on each.
    for (const material of [label.material].flat()) {
        material.depthTest = false;
        material.depthWrite = false;
    }
    label.renderOrder = renderOrder;
    return label;
}

class SystemMarker {
    constructor({ fontUrl, colour, ringOpacity, ringPixelRadius, showCoordinates, showDropLine, shape = 'circle', withCentreDot = false }) {
        this.ringPixelRadius = ringPixelRadius;
        this.showCoordinates = showCoordinates;
        this.showDropLine = showDropLine;
        this.system = null;
        this.labelIsWanted = true;

        this.sceneObject = new Group();
        this.sceneObject.visible = false;
        // Everything that keeps a constant on-screen size, facing the camera.
        this.billboard = new Group();
        this.sceneObject.add(this.billboard);
        this.ring = createRing(colour, ringOpacity, { shape, withCentreDot });
        this.ringBacking = addDarkBacking(this.ring, shape, withCentreDot);
        this.billboard.add(this.ring);

        this.nameLabel = createLabel(fontUrl, colour, 101);
        this.nameLabel.fontSize = 16;
        this.nameLabelUsualHeight = showCoordinates ? 8 : 0;
        this.nameLabel.position.set(this.ringPixelRadius + 8, this.nameLabelUsualHeight, 0);
        this.billboard.add(this.nameLabel);
        this.nameLabelPlate = createLabelPlate(100.5);
        this.billboard.add(this.nameLabelPlate);

        if (showCoordinates) {
            this.coordinatesLabel = createLabel(fontUrl, colour, 101);
            this.coordinatesLabel.fontSize = 11;
            this.coordinatesLabel.fillOpacity = 0.75;
            this.coordinatesLabel.position.set(this.ringPixelRadius + 8, -9, 0);
            this.billboard.add(this.coordinatesLabel);
            this.coordinatesLabelPlate = createLabelPlate(100.5);
            this.billboard.add(this.coordinatesLabelPlate);
        }

        if (showDropLine) {
            const dropLineGeometry = new BufferGeometry();
            dropLineGeometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
            this.dropLine = new Line(
                dropLineGeometry,
                new LineBasicMaterial({ color: new Color(colour), transparent: true, opacity: 0.45, depthWrite: false }),
            );
            this.dropLine.frustumCulled = false;
            this.dropLine.renderOrder = 99;
            this.sceneObject.add(this.dropLine);
            this.dropLineFoot = createRing(colour, 0.45);
            this.dropLineFoot.rotation.x = -Math.PI / 2;
            this.sceneObject.add(this.dropLineFoot);
        }
    }

    // Hides the name while keeping the ring, for example on a highlighted
    // system that is also selected and so already named by the selection.
    setLabelWanted(isWanted) {
        this.labelIsWanted = isWanted;
    }

    // Sizes the plates behind the labels to match them; called once the
    // labels' places and visibility are settled for the frame.
    fitLabelPlates() {
        fitPlateToLabel(this.nameLabelPlate, this.nameLabel);
        if (this.coordinatesLabel) {
            this.coordinatesLabel.visible = this.system !== null;
            fitPlateToLabel(this.coordinatesLabelPlate, this.coordinatesLabel);
        }
    }

    // Where the marker's system is on screen, in pixels with y up, or null
    // when it is hidden or behind the camera.
    screenPosition(camera, viewportWidth, viewportHeight) {
        if (this.system === null) {
            return null;
        }
        const projected = this.billboard.position.clone().project(camera);
        if (projected.z > 1) {
            return null;
        }
        return { x: (projected.x + 1) / 2 * viewportWidth, y: (projected.y + 1) / 2 * viewportHeight };
    }

    // The name label's size in pixels, once its text has been laid out; an
    // estimate before then.
    nameLabelSize() {
        const bounds = this.nameLabel.textRenderInfo?.blockBounds;
        if (bounds) {
            return { width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] };
        }
        const characterCount = (this.nameLabel.text ?? '').length;
        return { width: characterCount * this.nameLabel.fontSize * 0.55, height: this.nameLabel.fontSize * 1.2 };
    }

    // Returns a promise that resolves when the text is ready to draw.
    // withName: false skips laying out the name, for markers whose name is
    // never shown (most stops on a long route), which saves a lot of work.
    showSystem(system, { withName = true } = {}) {
        this.system = system;
        this.sceneObject.visible = system !== null;
        if (system === null) {
            return Promise.resolve();
        }
        galacticToScene(system.coordinates, this.billboard.position);
        const pendingTexts = [];
        if (withName) {
            this.nameLabel.text = system.name ?? '(unnamed system)';
            pendingTexts.push(new Promise(resolve => this.nameLabel.sync(resolve)));
        }
        if (this.coordinatesLabel) {
            const coordinates = system.coordinates;
            this.coordinatesLabel.text = formatGridCoordinates(coordinates.x, coordinates.y, coordinates.z);
            pendingTexts.push(new Promise(resolve => this.coordinatesLabel.sync(resolve)));
        }
        return Promise.all(pendingTexts);
    }

    updateForCamera({ camera, pixelsPerLightYearAtUnitDistance, gridHeight }) {
        if (this.system === null) {
            return;
        }
        const distanceFromCamera = Math.max(camera.position.distanceTo(this.billboard.position), 0.001);
        const lightYearsPerPixel = distanceFromCamera / pixelsPerLightYearAtUnitDistance;
        this.billboard.quaternion.copy(camera.quaternion);
        // Ring geometry has radius 1, text is sized in pixels; one scale covers both.
        this.billboard.scale.setScalar(lightYearsPerPixel);
        this.ring.scale.setScalar(this.ringPixelRadius);

        this.nameLabel.visible = this.labelIsWanted && this.labelHasRoom !== false;

        if (this.dropLine) {
            const systemPosition = this.billboard.position;
            const linePositions = this.dropLine.geometry.getAttribute('position');
            linePositions.setXYZ(0, systemPosition.x, systemPosition.y, systemPosition.z);
            linePositions.setXYZ(1, systemPosition.x, gridHeight, systemPosition.z);
            linePositions.needsUpdate = true;
            this.dropLine.visible = Math.abs(systemPosition.y - gridHeight) > lightYearsPerPixel * 2;
            // Placed before it is sized, so its size is right for where it is now.
            this.dropLineFoot.position.set(systemPosition.x, gridHeight, systemPosition.z);
            const footDistance = Math.max(camera.position.distanceTo(this.dropLineFoot.position), 0.001);
            this.dropLineFoot.scale.setScalar(footDistance / pixelsPerLightYearAtUnitDistance * 4);
            this.dropLineFoot.visible = this.dropLine.visible;
        }
    }

    dispose() {
        // The ring's children (its backing and any centre dot) included.
        this.ring.traverse(part => {
            part.geometry.dispose();
            part.material.dispose();
        });
        this.nameLabel.dispose();
        this.coordinatesLabel?.dispose();
        for (const plate of [this.nameLabelPlate, this.coordinatesLabelPlate]) {
            plate?.geometry.dispose();
            plate?.material.dispose();
        }
        if (this.dropLine) {
            this.dropLine.geometry.dispose();
            this.dropLine.material.dispose();
            this.dropLineFoot.geometry.dispose();
            this.dropLineFoot.material.dispose();
        }
    }
}

export class SystemMarkers {
    constructor({ fontUrl, hoverColour = '#d6e9f5', selectionColour = '#ff9a2e', highlightColour = '#ffd27a' }) {
        this.fontUrl = fontUrl;
        this.highlightColour = highlightColour;
        this.highlightMarkers = [];
        this.routeLine = null;
        this.routeArrows = null;
        // Set when labels are arranged (see arrangeLabels).
        this.screenAreasInUse = [];
        this.sceneObject = new Group();
        this.sceneObject.name = 'system markers';
        this.hoverMarker = new SystemMarker({
            fontUrl, colour: hoverColour, ringOpacity: 0.6, ringPixelRadius: 9, showCoordinates: false, showDropLine: false,
        });
        this.selectionMarker = new SystemMarker({
            fontUrl, colour: selectionColour, ringOpacity: 0.95, ringPixelRadius: 12, showCoordinates: true, showDropLine: true,
        });
        this.sceneObject.add(this.hoverMarker.sceneObject, this.selectionMarker.sceneObject);
    }

    showHoveredSystem(system) {
        // No point labelling the hover when the system is already named, as
        // the selection or as a named highlight. Unnamed highlights (most
        // stops on a long route) do get their name on hover.
        const isAlreadyNamed = system !== null && (
            isSameSystem(system, this.selectionMarker.system)
            || this.highlightMarkers.some(marker => marker.nameLabel.visible && isSameSystem(system, marker.system))
        );
        return this.hoverMarker.showSystem(isAlreadyNamed ? null : system);
    }

    // Highlighted systems keep a ring on screen all the time. Whether they
    // are named depends on showNames, or a system's own showName:
    //   true      always named; the label moves up or down to find room
    //   'ifRoom'  named only where the label fits beside the system without
    //             covering anything, such as stops along a long route
    //   false     never named (the name still shows on hover)
    // Each system may give its own colour, a shape for its ring (see
    // markerShapes.js) and a dot in the middle (centreDot), so kinds of
    // system can be told apart without relying on colour. With asRoute, a
    // line joins the systems in the order given. Replaces any earlier
    // highlights.
    // Returns a promise that resolves when all the names are ready to draw.
    setHighlightedSystems(systems, { asRoute = false, showNames = true } = {}) {
        for (const marker of this.highlightMarkers) {
            this.sceneObject.remove(marker.sceneObject);
            marker.dispose();
        }
        this.removeRouteLine();
        if (asRoute && systems.length >= 2) {
            this.createRouteLine(systems);
        }
        this.highlightMarkers = systems.map(system => {
            const isNamedAlways = (system.showName ?? showNames) === true;
            const marker = new SystemMarker({
                fontUrl: this.fontUrl,
                colour: system.colour ?? this.highlightColour,
                ringOpacity: 0.9,
                // Stops that are not named (most of a long route) get
                // smaller rings, so the route reads as a line of dots;
                // marked out stops a little less small, so their shape and
                // centre dot can still be made out.
                ringPixelRadius: isNamedAlways ? 8 : (hasDistinctMarker(system) ? 6.5 : 5),
                showCoordinates: false,
                showDropLine: false,
                shape: system.shape,
                withCentreDot: system.centreDot === true,
            });
            marker.namingRule = system.showName ?? showNames;
            marker.namedAlways = marker.namingRule === true;
            this.sceneObject.add(marker.sceneObject);
            return marker;
        });
        return Promise.all(this.highlightMarkers.map((marker, index) => marker.showSystem(systems[index], { withName: marker.namingRule !== false })));
    }

    // Moves highlight names up or down so they don't cover each other, the
    // selection's labels, or any ring. The selection keeps its place; the
    // highlights are placed most important first (see importance below), so
    // a route's named start and end, then its marked out stops, get the best
    // spots, and among equals earlier systems come first.
    // otherObstacles are extra screen areas names should keep clear of, such
    // as the grid's coordinate label.
    arrangeLabels({ camera, viewportWidth, viewportHeight, otherObstacles = [] }) {
        const ringObstacles = [];
        const labelRequests = [];
        const labelledMarkers = [];
        // Most important first: the selection, named highlights (such as a
        // route's start and end), stops marked out by colour, shape or centre
        // dot, then the rest in order.
        const importance = marker => {
            if (marker === this.selectionMarker) {
                return 0;
            }
            if (marker.namedAlways) {
                return 1;
            }
            return hasDistinctMarker(marker.system) ? 2 : 3;
        };
        const allMarkers = [this.selectionMarker, ...this.highlightMarkers]
            .map((marker, order) => ({ marker, order }))
            .sort((first, second) => importance(first.marker) - importance(second.marker) || first.order - second.order)
            .map(entry => entry.marker);

        // Labels start hidden each frame; only those placed below are shown.
        for (const marker of allMarkers) {
            marker.labelHasRoom = false;
            marker.nameLabel.visible = false;
        }

        // Where each marker is on screen, and which rings have room to draw.
        // Markers well off screen are left out, which also keeps the work
        // down when zoomed in on part of a long route.
        const offScreenMargin = 200;
        const markersOnScreen = [];
        for (const marker of allMarkers) {
            const position = marker.screenPosition(camera, viewportWidth, viewportHeight);
            const isOnScreen = position !== null
                && position.x > -offScreenMargin && position.x < viewportWidth + offScreenMargin
                && position.y > -offScreenMargin && position.y < viewportHeight + offScreenMargin;
            if (!isOnScreen) {
                continue;
            }
            markersOnScreen.push({ marker, position });
        }
        const ringIsDrawn = chooseRingsToDraw(markersOnScreen.map(({ marker, position }) => ({ ...position, radius: marker.ringPixelRadius })));
        markersOnScreen.forEach(({ marker }, index) => {
            // The selection and named systems always show their ring.
            marker.ring.visible = ringIsDrawn[index] || importance(marker) <= 1;
        });

        for (const { marker, position } of markersOnScreen) {
            if (!marker.ring.visible) {
                continue;
            }
            const radius = marker.ringPixelRadius;
            ringObstacles.push({ left: position.x - radius, right: position.x + radius, bottom: position.y - radius, top: position.y + radius });
            if (!marker.labelIsWanted) {
                continue;
            }
            const size = marker.nameLabelSize();
            const isSelection = marker === this.selectionMarker;
            const isOptionalName = !isSelection && marker.namingRule === 'ifRoom';
            labelRequests.push({
                anchorX: position.x,
                anchorY: position.y + marker.nameLabelUsualHeight,
                gapFromAnchor: radius + 8,
                width: size.width,
                // The selection's coordinates line sits below its name.
                height: isSelection ? size.height * 2 : size.height,
                isFixed: isSelection,
                canMove: !isOptionalName,
            });
            labelledMarkers.push(marker);
        }
        const placements = placeLabels(labelRequests, [...ringObstacles, ...otherObstacles]);
        // What the names and rings now take up on screen, along with the
        // other obstacles, for other labels (such as region names) to avoid.
        this.screenAreasInUse = [...ringObstacles, ...otherObstacles];
        placements.forEach((placement, index) => {
            const marker = labelledMarkers[index];
            marker.labelHasRoom = placement.isShown;
            marker.nameLabel.visible = placement.isShown;
            marker.nameLabel.position.y = marker.nameLabelUsualHeight + placement.verticalOffset;
            if (placement.isShown) {
                const request = labelRequests[index];
                const middleY = request.anchorY + placement.verticalOffset;
                this.screenAreasInUse.push({
                    left: request.anchorX + request.gapFromAnchor,
                    right: request.anchorX + request.gapFromAnchor + request.width,
                    bottom: middleY - request.height / 2,
                    top: middleY + request.height / 2,
                });
            }
        });
    }

    // A line through the route's systems in order, a constant width in pixels
    // whatever the zoom. Points are stored relative to the first system so
    // they stay precise far from Sol.
    createRouteLine(systems) {
        const firstPosition = galacticToScene(systems[0].coordinates);
        const relativePositions = [];
        for (const system of systems) {
            const position = galacticToScene(system.coordinates).sub(firstPosition);
            relativePositions.push(position.x, position.y, position.z);
        }
        const geometry = new LineGeometry();
        geometry.setPositions(relativePositions);
        const material = new LineMaterial({
            color: this.highlightColour,
            linewidth: 2,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false,
        });
        this.routeLine = new Line2(geometry, material);
        // A wider dark line underneath, so the route stands out against a
        // bright, crowded star field.
        const backingMaterial = new LineMaterial({
            color: 0x000000,
            linewidth: 6,
            transparent: true,
            opacity: 0.55,
            depthTest: false,
            depthWrite: false,
        });
        this.routeLineBacking = new Line2(geometry, backingMaterial);
        for (const line of [this.routeLineBacking, this.routeLine]) {
            line.position.copy(firstPosition);
            line.computeLineDistances();
            // The line's own bounds are not kept up to date; never cull it.
            line.frustumCulled = false;
        }
        this.routeLineBacking.renderOrder = 97.5;
        this.routeLine.renderOrder = 98;
        this.sceneObject.add(this.routeLineBacking, this.routeLine);

        this.routeArrows = new RouteArrows(systems.map(system => galacticToScene(system.coordinates)), this.highlightColour);
        this.sceneObject.add(this.routeArrows.sceneObject);
    }

    removeRouteLine() {
        if (this.routeLine === null) {
            return;
        }
        this.sceneObject.remove(this.routeLine, this.routeLineBacking);
        this.routeLine.geometry.dispose();
        this.routeLine.material.dispose();
        this.routeLineBacking.material.dispose();
        this.routeLine = null;
        this.routeLineBacking = null;
        this.sceneObject.remove(this.routeArrows.sceneObject);
        this.routeArrows.dispose();
        this.routeArrows = null;
    }

    get highlightedSystems() {
        return this.highlightMarkers.map(marker => marker.system);
    }

    showSelectedSystem(system) {
        if (system !== null && isSameSystem(system, this.hoverMarker.system)) {
            this.hoverMarker.showSystem(null);
        }
        return this.selectionMarker.showSystem(system);
    }

    updateForCamera(cameraState) {
        this.hoverMarker.updateForCamera(cameraState);
        this.selectionMarker.updateForCamera(cameraState);
        for (const marker of this.highlightMarkers) {
            // The selection marker already names the selected system.
            marker.setLabelWanted(marker.namingRule !== false && !isSameSystem(marker.system, this.selectionMarker.system));
            marker.updateForCamera(cameraState);
        }
        // Line widths are in pixels, so the line needs the drawing size.
        if (this.routeLine !== null && cameraState.viewportWidth !== undefined) {
            this.routeLine.material.resolution.set(cameraState.viewportWidth, cameraState.viewportHeight);
            this.routeLineBacking.material.resolution.set(cameraState.viewportWidth, cameraState.viewportHeight);
        }
        if (cameraState.viewportWidth !== undefined) {
            this.routeArrows?.updateForCamera(cameraState);
            this.arrangeLabels(cameraState);
        }
        for (const marker of [this.hoverMarker, this.selectionMarker, ...this.highlightMarkers]) {
            marker.fitLabelPlates();
        }
    }

    dispose() {
        this.hoverMarker.dispose();
        this.selectionMarker.dispose();
        for (const marker of this.highlightMarkers) {
            marker.dispose();
        }
        this.removeRouteLine();
    }
}

export function isSameSystem(firstSystem, secondSystem) {
    if (firstSystem === null || secondSystem === null || firstSystem === undefined || secondSystem === undefined) {
        return false;
    }
    if (firstSystem.key !== undefined && secondSystem.key !== undefined) {
        return firstSystem.key === secondSystem.key;
    }
    // Coordinates are compared loosely: stars in a layer are stored with less
    // precision than coordinates a page passes in for a highlight or search.
    const closeEnough = 0.1;
    return firstSystem.name === secondSystem.name
        && Math.abs(firstSystem.coordinates.x - secondSystem.coordinates.x) < closeEnough
        && Math.abs(firstSystem.coordinates.y - secondSystem.coordinates.y) < closeEnough
        && Math.abs(firstSystem.coordinates.z - secondSystem.coordinates.z) < closeEnough;
}
