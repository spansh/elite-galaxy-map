import { describe, expect, it } from 'vitest';
import { Ray, Vector3 } from 'three';
import { ALWAYS_DRAWN_SHARE, CROSS_FADE_MILLISECONDS, StarField, chooseAlwaysDrawnLayers, interleaveRandomly, joinBatchNames } from '../src/StarField.js';
import { galacticToScene } from '../src/coordinates.js';

// A star field whose addSystems goes to one layer called "test", so the
// tests read as they did when each layer held its own stars.
function createFieldWithOneLayer() {
    const field = new StarField({ cellSize: 1000 });
    const addToField = field.addSystems.bind(field);
    field.addSystems = (layerOrBatch, batch) => (batch === undefined ? addToField('test', layerOrBatch) : addToField(layerOrBatch, batch));
    return field;
}

// A ray from a point in galactic coordinates towards another.
function rayBetween(fromGalactic, towardsGalactic) {
    const origin = galacticToScene(fromGalactic);
    const direction = galacticToScene(towardsGalactic).sub(origin).normalize();
    return new Ray(origin, direction);
}

describe('joinBatchNames', () => {
    it('records where each name starts in the joined string', () => {
        const { joinedNames, nameStarts } = joinBatchNames(['Sol', 'Achenar', 'Colonia'], 3);
        expect(joinedNames).toBe('Sol\nAchenar\nColonia');
        expect([...nameStarts]).toEqual([0, 4, 12, 20]);
    });

    it('gives the same layout for names already joined with newlines', () => {
        const fromArray = joinBatchNames(['Sol', 'Achenar', 'Colonia'], 3);
        const fromString = joinBatchNames('Sol\nAchenar\nColonia', 3);
        expect(fromString.joinedNames).toBe(fromArray.joinedNames);
        expect([...fromString.nameStarts]).toEqual([...fromArray.nameStarts]);
    });
});

describe('StarField', () => {
    it('puts systems into cells and counts them', () => {
        const field = createFieldWithOneLayer();
        field.addSystems({ galacticPositions: new Float32Array([0, 0, 0, 10, 0, 0, 5000, 0, 5000]) });
        expect(field.systemCount).toBe(3);
        expect([...field.cells].length).toBe(2);
    });

    it('stores positions relative to the cell, with z flipped for the scene', () => {
        const field = createFieldWithOneLayer();
        field.addSystems({ galacticPositions: new Float32Array([1500, 20, 2500]), names: ['Test system'] });
        const [cell] = field.cells;
        // Galactic z 2500 is scene z -2500, which is in the cell starting at -3000.
        expect(cell.cellOriginInScene.toArray()).toEqual([1000, 0, -3000]);
        expect([...cell.positionsRelativeToCell.subarray(0, 3)]).toEqual([500, 20, 500]);
        expect(field.describeSystem(cell, 0)).toEqual({
            layer: 'test', name: 'Test system', key: undefined, coordinates: { x: 1500, y: 20, z: 2500 },
        });
    });

    it('keeps each name with its system across several batches and cell growth', () => {
        const field = createFieldWithOneLayer();
        const systemsPerBatch = 1500;
        for (let batch = 0; batch < 3; batch++) {
            const positions = new Float32Array(systemsPerBatch * 3);
            const names = [];
            for (let index = 0; index < systemsPerBatch; index++) {
                positions[index * 3] = index % 100;
                positions[index * 3 + 1] = batch;
                // Negative galactic z is positive scene z, keeping every system in one cell.
                positions[index * 3 + 2] = -Math.floor(index / 100);
                names.push(`batch ${batch} system ${index}`);
            }
            // Alternate between array names and pre-joined names.
            field.addSystems({ galacticPositions: positions, names: batch % 2 === 0 ? names : names.join('\n') });
        }
        const [cell] = field.cells;
        expect(cell.systemCount).toBe(4500);
        expect(cell.capacity).toBeGreaterThanOrEqual(4500);
        const lastSystem = field.describeSystem(cell, 4499);
        expect(lastSystem.name).toBe('batch 2 system 1499');
        expect(lastSystem.coordinates).toEqual({ x: 99, y: 2, z: -14 });
        expect(field.describeSystem(cell, 1500).name).toBe('batch 1 system 0');
    });

    it('leaves names undefined for batches sent without them', () => {
        const field = createFieldWithOneLayer();
        field.addSystems({ galacticPositions: new Float32Array([1, 2, 3]) });
        field.addSystems({ galacticPositions: new Float32Array([4, 5, 6]), names: ['Named'] });
        const [cell] = field.cells;
        expect(field.describeSystem(cell, 0).name).toBeUndefined();
        expect(field.describeSystem(cell, 1).name).toBe('Named');
    });

    it('rejects positions that are not whole x, y, z triples', () => {
        expect(() => createFieldWithOneLayer().addSystems({ galacticPositions: new Float32Array(4) })).toThrow(/multiple of 3/);
    });

    it('picks the system nearest the ray, within the angular tolerance', () => {
        const field = createFieldWithOneLayer();
        field.addSystems({
            galacticPositions: new Float32Array([0, 0, 0, 30, 0, 0, 2000, 0, 2000]),
            names: ['Sol', 'Off to the side', 'Far away'],
        });
        const ray = rayBetween({ x: 0, y: 500, z: 0 }, { x: 1, y: 0, z: 0 });
        const match = field.findSystemNearestRay(ray, 0.01);
        expect(match.system.name).toBe('Sol');
        // Nothing within a very tight tolerance of a ray aimed between stars.
        const missingRay = rayBetween({ x: 0, y: 500, z: 0 }, { x: 15, y: 0, z: 0 });
        expect(field.findSystemNearestRay(missingRay, 0.001)).toBeNull();
    });

    it('prefers the nearer of two stars lying on the ray', () => {
        const field = createFieldWithOneLayer();
        field.addSystems({ galacticPositions: new Float32Array([0, -100, 0, 0, 100, 0]), names: ['Lower', 'Upper'] });
        const ray = rayBetween({ x: 0, y: 1000, z: 0 }, { x: 0, y: 0, z: 0 });
        expect(field.findSystemNearestRay(ray, 0.01).system.name).toBe('Upper');
    });

    it('ignores stars behind the ray origin and hidden layers', () => {
        const field = createFieldWithOneLayer();
        field.addSystems({ galacticPositions: new Float32Array([0, 0, 0]), names: ['Behind'] });
        const ray = rayBetween({ x: 0, y: 100, z: 0 }, { x: 0, y: 200, z: 0 });
        expect(field.findSystemNearestRay(ray, 0.1)).toBeNull();
        const towardsStar = rayBetween({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 0 });
        field.setLayerVisibility('test', false);
        expect(field.findSystemNearestRay(towardsStar, 0.1)).toBeNull();
    });

    it('rebuilds the picking index when systems are added after a pick', () => {
        const field = createFieldWithOneLayer();
        field.addSystems({ galacticPositions: new Float32Array([100, 0, 100]), names: ['First'] });
        const ray = rayBetween({ x: 900, y: 500, z: 900 }, { x: 900, y: 0, z: 900 });
        expect(field.findSystemNearestRay(ray, 0.01)).toBeNull();
        field.addSystems({ galacticPositions: new Float32Array([900, 0, 900]), names: ['Second'] });
        expect(field.findSystemNearestRay(ray, 0.01).system.name).toBe('Second');
    });

    it('agrees with checking every star, on random data', () => {
        const field = createFieldWithOneLayer();
        let seed = 7;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const systemCount = 20000;
        const positions = new Float32Array(systemCount * 3);
        for (let index = 0; index < positions.length; index++) {
            positions[index] = (random() - 0.5) * 6000;
        }
        field.addSystems({ galacticPositions: positions });
        for (let trial = 0; trial < 25; trial++) {
            const origin = new Vector3((random() - 0.5) * 20000, (random() - 0.5) * 20000, (random() - 0.5) * 20000);
            const direction = new Vector3((random() - 0.5) * 2000, (random() - 0.5) * 2000, (random() - 0.5) * 2000).sub(origin).normalize();
            const ray = new Ray(origin, direction);
            const tolerance = 0.002;
            let bestAngle = tolerance;
            let bestPosition = null;
            for (let index = 0; index < systemCount; index++) {
                const scenePosition = galacticToScene({ x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2] });
                const towards = scenePosition.clone().sub(origin);
                const along = towards.dot(direction);
                if (along <= 0) {
                    continue;
                }
                const angle = Math.atan2(Math.sqrt(Math.max(towards.lengthSq() - along * along, 0)), along);
                if (angle < bestAngle) {
                    bestAngle = angle;
                    bestPosition = scenePosition;
                }
            }
            const match = field.findSystemNearestRay(ray, tolerance);
            if (bestPosition === null) {
                expect(match).toBeNull();
            } else {
                const matchPosition = galacticToScene(match.system.coordinates);
                expect(matchPosition.distanceTo(bestPosition)).toBeLessThan(0.01);
            }
        }
    });
});

describe('StarCell shuffling', () => {
    it('puts a cell in random order, keeping each name and key with its star', () => {
        const field = createFieldWithOneLayer();
        const systemCount = 3000;
        const positions = new Float32Array(systemCount * 3);
        const names = [];
        const keys = [];
        for (let index = 0; index < systemCount; index++) {
            positions[index * 3] = index % 1000;
            positions[index * 3 + 1] = Math.floor(index / 1000);
            positions[index * 3 + 2] = -1;
            names.push(`system ${index}`);
            keys.push(index);
        }
        field.addSystems({ galacticPositions: positions, names, keys });
        const [cell] = field.cells;
        expect(cell.unshuffledCount).toBe(systemCount);

        let seed = 99;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        cell.shuffleInNewSystems(random);
        expect(cell.unshuffledCount).toBe(0);

        const seenKeys = new Set();
        let movedCount = 0;
        for (let indexInCell = 0; indexInCell < systemCount; indexInCell++) {
            const system = field.describeSystem(cell, indexInCell);
            seenKeys.add(system.key);
            if (system.key !== indexInCell) {
                movedCount++;
            }
            // Each star still carries its own name, key and position.
            expect(system.name).toBe(`system ${system.key}`);
            expect(system.coordinates.x).toBe(system.key % 1000);
            expect(system.coordinates.y).toBe(Math.floor(system.key / 1000));
        }
        expect(seenKeys.size).toBe(systemCount);
        expect(movedCount).toBeGreaterThan(systemCount * 0.9);
        // The first 300 are an even sample: about a third from each row.
        const firstRows = Array.from({ length: 300 }, (unused, index) => Math.floor(field.describeSystem(cell, index).key / 1000));
        for (const row of [0, 1, 2]) {
            const share = firstRows.filter(value => value === row).length / 300;
            expect(share).toBeGreaterThan(0.2);
            expect(share).toBeLessThan(0.47);
        }
    });

    it('shuffles later arrivals in among the rest, and picking still finds them', () => {
        const field = createFieldWithOneLayer();
        field.addSystems({ galacticPositions: new Float32Array([100, 0, -100]), names: ['First'] });
        const [cell] = field.cells;
        cell.shuffleInNewSystems(Math.random);
        field.addSystems({ galacticPositions: new Float32Array([900, 0, -900]), names: ['Second'] });
        expect(cell.unshuffledCount).toBe(1);
        cell.shuffleInNewSystems(Math.random);
        expect(cell.shuffledCount).toBe(2);
        const ray = rayBetween({ x: 900, y: 500, z: -900 }, { x: 900, y: 0, z: -900 });
        expect(field.findSystemNearestRay(ray, 0.01).system.name).toBe('Second');
    });
});

describe('StarField layers', () => {
    // Stars of several layers spread through one cell.
    function fieldWithLayers(countsByLayer) {
        const field = new StarField({ cellSize: 1000 });
        let seed = 3;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (const [layerName, count] of Object.entries(countsByLayer)) {
            const positions = new Float32Array(count * 3);
            const names = [];
            for (let index = 0; index < count; index++) {
                positions[index * 3] = random() * 999;
                positions[index * 3 + 1] = random() * 999;
                positions[index * 3 + 2] = -random() * 999;
                names.push(`${layerName} ${index}`);
            }
            field.addSystems(layerName, { galacticPositions: positions, names });
        }
        return field;
    }

    it('keeps stars of every layer in the same cells, each knowing its layer', () => {
        const field = fieldWithLayers({ k: 500, m: 800 });
        expect([...field.cells].length).toBe(1);
        const [cell] = field.cells;
        expect(cell.systemCount).toBe(1300);
        expect(field.getLayer('k').systemCount).toBe(500);
        expect(field.describeSystem(cell, 0).layer).toBe('k');
        expect(field.describeSystem(cell, 0).name).toBe('k 0');
        expect(field.describeSystem(cell, 1299).layer).toBe('m');
    });

    it('lists layers by order, then by when they were defined', () => {
        const field = new StarField({ cellSize: 1000 });
        field.defineLayer('third', { order: 5 });
        field.defineLayer('first', { order: 1 });
        field.defineLayer('second', {});
        field.defineLayer('second', { order: 1, colour: '#ff0000' });
        expect(field.getLayersInOrder().map(layer => layer.layerName)).toEqual(['first', 'second', 'third']);
        expect(field.getLayer('second').appearance.colour).toBe('#ff0000');
    });

    it('writes each layer into the shader, with hidden layers at opacity 0', () => {
        const field = new StarField({ cellSize: 1000 });
        const layer = field.defineLayer('blue', { colour: '#0000ff', starSizeInLightYears: 7, opacity: 0.5 });
        const uniforms = field.material.uniforms;
        expect(uniforms.layerAppearance.value[layer.layerIndex].x).toBe(7);
        expect(uniforms.layerColourAndOpacity.value[layer.layerIndex].toArray()).toEqual([0, 0, 1, 0.5]);
        field.setLayerVisibility('blue', false);
        expect(uniforms.layerColourAndOpacity.value[layer.layerIndex].w).toBe(0);
    });

    it('moves the rarest layers to the front of a cell when shuffling, keeping the rest random', () => {
        const field = fieldWithLayers({ common: 9000, rare: 100, scarce: 300 });
        const [cell] = field.cells;
        cell.shuffleInNewSystems(Math.random);
        expect(cell.alwaysDrawnCount).toBe(400);
        const layersAt = (start, end) => new Set(Array.from({ length: end - start }, (unused, offset) => field.describeSystem(cell, start + offset).layer));
        expect(layersAt(0, 400)).toEqual(new Set(['rare', 'scarce']));
        expect(layersAt(400, 9400)).toEqual(new Set(['common']));
        // Every name still belongs to its star's layer.
        for (let index = 0; index < cell.systemCount; index += 97) {
            const system = field.describeSystem(cell, index);
            expect(system.name.startsWith(system.layer)).toBe(true);
        }
    });

    it('chooses rare layers within the always drawn share', () => {
        const counts = new Uint32Array(8);
        counts[0] = 10000;
        counts[1] = 200;
        counts[2] = 400;
        counts[3] = 600;
        const chosen = chooseAlwaysDrawnLayers(counts, 11200);
        // 5% of 11200 is 560: the 200 fit, but adding the 400 would not.
        const allowance = 11200 * ALWAYS_DRAWN_SHARE;
        let total = 0;
        for (let layerIndex = 0; layerIndex < 8; layerIndex++) {
            if (chosen[layerIndex]) {
                total += counts[layerIndex];
            }
        }
        expect(total).toBeLessThanOrEqual(allowance);
        expect([...chosen.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
        // A cell of one layer has nothing rare in it.
        expect([...chooseAlwaysDrawnLayers(new Uint32Array([500, 0]), 500)]).toEqual([0, 0]);
    });

    it('removes one layer, keeping the others in order and their names', () => {
        const field = fieldWithLayers({ common: 4000, rare: 100 });
        const [cell] = field.cells;
        cell.shuffleInNewSystems(Math.random);
        field.addSystems('common', { galacticPositions: new Float32Array([5, 5, -5]), names: ['late arrival'] });
        const commonBefore = [];
        for (let index = 0; index < cell.systemCount; index++) {
            const system = field.describeSystem(cell, index);
            if (system.layer === 'common') {
                commonBefore.push(system.name);
            }
        }
        field.removeLayer('rare');
        expect(field.getLayer('rare')).toBeUndefined();
        expect(field.systemCount).toBe(4001);
        expect(cell.systemCount).toBe(4001);
        expect(cell.alwaysDrawnCount).toBe(0);
        expect(cell.shuffledCount).toBe(4000);
        const commonAfter = Array.from({ length: cell.systemCount }, (unused, index) => field.describeSystem(cell, index).name);
        expect(commonAfter).toEqual(commonBefore);
        // The freed layer number is reused, without the old names.
        const reused = field.defineLayer('new');
        expect(reused.layerIndex).toBe(1);
    });

    it('drops empty cells when a layer is cleared, and lets go of its names', () => {
        const field = new StarField({ cellSize: 1000 });
        field.addSystems('near', { galacticPositions: new Float32Array([1, 1, -1]), names: ['Near'] });
        field.addSystems('far', { galacticPositions: new Float32Array([5000, 1, -1]), names: ['Far'] });
        expect([...field.cells].length).toBe(2);
        field.clearLayer('far');
        expect([...field.cells].length).toBe(1);
        expect(field.getLayer('far').systemCount).toBe(0);
        expect(field.joinedNamesOfBatches.filter(names => names !== null)).toEqual(['Near']);
    });

    it('picks only stars of visible layers', () => {
        const field = new StarField({ cellSize: 1000 });
        field.addSystems('upper', { galacticPositions: new Float32Array([0, 100, 0]), names: ['Upper'] });
        field.addSystems('lower', { galacticPositions: new Float32Array([0, -100, 0]), names: ['Lower'] });
        const ray = rayBetween({ x: 0, y: 1000, z: 0 }, { x: 0, y: 0, z: 0 });
        expect(field.findSystemNearestRay(ray, 0.01).system.name).toBe('Upper');
        field.setLayerVisibility('upper', false);
        expect(field.findSystemNearestRay(ray, 0.01).system.name).toBe('Lower');
    });

    it('counts visible stars separately for always drawn and sampled layers', () => {
        const field = fieldWithLayers({ common: 3000, rare: 50 });
        const [cell] = field.cells;
        cell.shuffleInNewSystems(Math.random);
        expect(cell.countVisibleSystems(field.isVisibleLayer)).toEqual({ alwaysDrawn: 50, sampled: 3000 });
        field.setLayerVisibility('common', false);
        expect(cell.countVisibleSystems(field.isVisibleLayer)).toEqual({ alwaysDrawn: 50, sampled: 0 });
    });

    it('counts rare stars that arrived since the last shuffle with the sampled stars, where they wait', () => {
        const field = fieldWithLayers({ common: 3000, rare: 20 });
        const [cell] = field.cells;
        cell.shuffleInNewSystems(Math.random);
        field.addSystems('rare', { galacticPositions: new Float32Array(90).fill(-3).map((value, index) => (index % 3 === 2 ? value : -value)) });
        field.setLayerVisibility('common', false);
        // Only 20 are in the front block; the 30 newcomers are at the back.
        expect(cell.countVisibleSystems(field.isVisibleLayer)).toEqual({ alwaysDrawn: 20, sampled: 30 });
        cell.shuffleInNewSystems(Math.random);
        expect(cell.countVisibleSystems(field.isVisibleLayer)).toEqual({ alwaysDrawn: 50, sampled: 0 });
    });

    it('refuses more layers than the shader holds', () => {
        const field = new StarField({ cellSize: 1000 });
        for (let index = 0; index < 64; index++) {
            field.defineLayer(`layer ${index}`);
        }
        expect(() => field.defineLayer('one too many')).toThrow(/at most 64 layers/);
    });
});

describe('shuffling in arrivals without disturbing the drawn sample', () => {
    function addRow(field, layerName, count, firstKey) {
        const positions = new Float32Array(count * 3);
        const keys = [];
        for (let index = 0; index < count; index++) {
            positions[index * 3] = (index * 7919) % 997;
            positions[index * 3 + 1] = (index * 104729) % 991;
            positions[index * 3 + 2] = -((index * 1299709) % 983);
            keys.push(firstKey + index);
        }
        field.addSystems(layerName, { galacticPositions: positions, keys });
    }

    it('keeps the order of stars already shuffled, only slotting newcomers in between', () => {
        const field = new StarField({ cellSize: 1000 });
        addRow(field, 'stars', 5000, 0);
        const [cell] = field.cells;
        cell.shuffleInNewSystems(Math.random);
        const orderBefore = Array.from({ length: cell.systemCount }, (unused, index) => cell.keys[index]);
        addRow(field, 'stars', 2000, 5000);
        cell.shuffleInNewSystems(Math.random);
        const orderAfter = Array.from({ length: cell.systemCount }, (unused, index) => cell.keys[index]);
        expect(orderAfter.filter(key => key < 5000)).toEqual(orderBefore);
        // The newcomers are spread through the cell, not left at the end:
        // about 2 in 7 of the first 1000 are new.
        const newcomersInFirstThousand = orderAfter.slice(0, 1000).filter(key => key >= 5000).length;
        expect(newcomersInFirstThousand).toBeGreaterThan(200);
        expect(newcomersInFirstThousand).toBeLessThan(380);
        // So of the first 1000 drawn before, nearly all are still among
        // the first 1500 now.
        const firstThousandBefore = new Set(orderBefore.slice(0, 1000));
        const stillNearTheFront = orderAfter.slice(0, 1500).filter(key => firstThousandBefore.has(key)).length;
        expect(stillNearTheFront).toBeGreaterThan(950);
    });

    it('interleaves lists at random, keeping each list in order', () => {
        const output = new Uint32Array(30);
        const first = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        const second = Array.from({ length: 20 }, (unused, index) => 100 + index);
        expect(interleaveRandomly([first, second], output, 0, Math.random)).toBe(30);
        const merged = [...output];
        expect(merged.filter(value => value < 100)).toEqual(first);
        expect(merged.filter(value => value >= 100)).toEqual(second);
        // Over many runs, each list's items land evenly through the output.
        const firstListCountInFirstHalf = [];
        for (let run = 0; run < 400; run++) {
            interleaveRandomly([first, second], output, 0, Math.random);
            firstListCountInFirstHalf.push([...output.subarray(0, 15)].filter(value => value < 100).length);
        }
        const average = firstListCountInFirstHalf.reduce((total, count) => total + count, 0) / 400;
        expect(average).toBeGreaterThan(4.6);
        expect(average).toBeLessThan(5.4);
    });

    it('keeps a layer drawn in full until it holds twice the share', () => {
        const counts = new Uint32Array(4);
        counts[0] = 10000;
        counts[1] = 600;
        // 600 is over 5% of 10600 (530), so a fresh choice leaves it out...
        expect(chooseAlwaysDrawnLayers(counts, 10600)[1]).toBe(0);
        // ...but a layer already drawn in full stays so up to 10% (1060).
        const previous = new Uint8Array(4);
        previous[1] = 1;
        expect(chooseAlwaysDrawnLayers(counts, 10600, previous)[1]).toBe(1);
        counts[1] = 1200;
        expect(chooseAlwaysDrawnLayers(counts, 11200, previous)[1]).toBe(0);
    });
});

describe('dissolving a cell on screen between samples', () => {
    it('keeps the stars as drawn, fading them out while the new order fades in', () => {
        const field = new StarField({ cellSize: 1000 });
        const positions = new Float32Array(3000).map((unused, index) => (index % 3 === 2 ? -1 : 1) * ((index * 37) % 999));
        field.addSystems('stars', { galacticPositions: positions });
        const [cell] = field.cells;
        cell.shuffleInNewSystems(Math.random);
        // As if drawn on screen in the last frame.
        cell.wasOnScreen = true;
        cell.hasPendingUpload = false;
        field.addSystems('stars', { galacticPositions: positions.slice(0, 900) });
        // As if drawn again since, so the new stars are uploaded too.
        cell.hasPendingUpload = false;
        const geometryOnScreen = cell.points.geometry;
        cell.shuffleInNewSystems(Math.random);
        expect(cell.outgoingPoints).not.toBeNull();
        expect(cell.outgoingPoints.geometry).toBe(geometryOnScreen);
        expect(cell.points.geometry).not.toBe(geometryOnScreen);
        expect(field.sceneObject.children).toContain(cell.outgoingPoints);
        const start = cell.crossFadeStartTime;
        expect(cell.advanceCrossFade(start + CROSS_FADE_MILLISECONDS / 2)).toBe(true);
        expect(cell.crossFadeProgress).toBeCloseTo(0.5);
        const outgoing = cell.outgoingPoints;
        // Just after the end (start is a fraction of a millisecond, so exactly
        // the end can come out a hair short of it).
        expect(cell.advanceCrossFade(start + CROSS_FADE_MILLISECONDS + 1)).toBe(false);
        expect(cell.outgoingPoints).toBeNull();
        expect(cell.crossFadeProgress).toBe(1);
        expect(field.sceneObject.children).not.toContain(outgoing);
    });

    it('cuts straight to the new order for a cell off screen, or not yet uploaded', () => {
        const field = new StarField({ cellSize: 1000 });
        field.addSystems('stars', { galacticPositions: new Float32Array(3000).fill(1) });
        const [cell] = field.cells;
        cell.shuffleInNewSystems(Math.random);
        expect(cell.outgoingPoints).toBeNull();
        cell.wasOnScreen = true;
        field.addSystems('stars', { galacticPositions: new Float32Array(900).fill(2) });
        // Its new stars haven't been drawn (uploaded) yet.
        cell.shuffleInNewSystems(Math.random);
        expect(cell.outgoingPoints).toBeNull();
    });
});

describe('uploading to the graphics card', () => {
    const pendingRange = cell => {
        const [range] = cell.points.geometry.getAttribute('position').updateRanges;
        return { firstSystem: range.start / 3, systemCount: range.count / 3 };
    };
    const drawCell = cell => cell.points.onBeforeRender(null, null, null, cell.points.geometry, cell.points.material);

    it('uploads every batch that arrived since the cell was last drawn, not just the last', () => {
        const field = new StarField({ cellSize: 1000 });
        field.addSystems('k', { galacticPositions: new Float32Array(300).fill(5) });
        const [cell] = field.cells;
        drawCell(cell);
        // Three batches, of different layers, before the next draw.
        field.addSystems('k', { galacticPositions: new Float32Array(30).fill(6) });
        field.addSystems('m', { galacticPositions: new Float32Array(60).fill(7) });
        field.addSystems('g', { galacticPositions: new Float32Array(90).fill(8) });
        expect(pendingRange(cell)).toEqual({ firstSystem: 100, systemCount: 60 });
        drawCell(cell);
        field.addSystems('k', { galacticPositions: new Float32Array(3).fill(9) });
        expect(pendingRange(cell)).toEqual({ firstSystem: 160, systemCount: 1 });
    });
});
