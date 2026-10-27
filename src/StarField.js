import { BufferAttribute, BufferGeometry, Group, Points, Sphere, Vector3 } from 'three';
import { sceneZToGalacticZ, galacticZToSceneZ } from './coordinates.js';
import { DEFAULT_STAR_APPEARANCE, MAXIMUM_LAYER_COUNT, applyLayerAppearance, createStarMaterial } from './starMaterial.js';

// Every loaded star, of every layer. A layer is a named set of systems drawn
// in one colour (for example "Neutron stars" or "K class stars").
//
// Stars are sorted into cubic cells of space, whatever their layer. Each
// cell is one draw call, which lets three.js skip cells that are off screen,
// lets picking ignore cells nowhere near the mouse, and keeps vertex
// positions small (they are stored relative to the cell's corner), so there
// is no float precision jitter when zoomed right in. Each star records the
// number of its layer, and the shader looks up that layer's colour, size and
// visibility, so splitting stars into more layers costs no extra draws.

export { MAXIMUM_LAYER_COUNT };

const INITIAL_CELL_CAPACITY = 1024;

// For picking, each cell is further divided into this many boxes along each
// axis, so only the stars in boxes near the mouse ray need testing.
const PICKING_BOXES_PER_AXIS = 8;
const PICKING_BOXES_PER_CELL = PICKING_BOXES_PER_AXIS ** 3;

// Cell indices are packed into one number so they can be Map keys without
// building a string for every system. 2048 cells each way is far more than
// the galaxy needs at any sensible cell size.
const CELL_INDEX_OFFSET = 1024;
const CELL_INDEX_RANGE = 2048;

// Names are not kept as one string per system (millions of small strings
// are slow to send between threads and make garbage collection pause the
// page). Each batch's names are kept as one long string, and each system
// records which batch string holds its name and where.
const NO_NAME = 0xffffffff;

// The level of detail draws a random sample of a crowded cell's stars. A
// layer with only a few stars in a cell would be sampled down to one or two
// over-bright dots, so the rarest layers in each cell, up to this share of
// the cell's stars, are kept at the front of the cell and always drawn.
export const ALWAYS_DRAWN_SHARE = 0.05;

// When a cell on screen takes in new stars, its drawn sample becomes a
// different set of stars. Rather than cut from one set to the other, which
// makes a crowded view "boil" while data loads, the cell dissolves between
// them over this long.
export const CROSS_FADE_MILLISECONDS = 1500;

// Turns the names given for a batch into one string plus the start of each
// name within it (with one extra entry marking the end of the last name).
// Names may come as an array of strings, or already joined with newlines.
export function joinBatchNames(names, systemCount) {
  const nameStarts = new Uint32Array(systemCount + 1);
  if (typeof names === 'string') {
    let searchFrom = 0;
    for (let systemIndex = 0; systemIndex < systemCount; systemIndex++) {
      nameStarts[systemIndex] = searchFrom;
      const newlinePosition = names.indexOf('\n', searchFrom);
      searchFrom = newlinePosition < 0 ? names.length + 1 : newlinePosition + 1;
    }
    nameStarts[systemCount] = searchFrom;
    return { joinedNames: names, nameStarts };
  }
  let position = 0;
  for (let systemIndex = 0; systemIndex < systemCount; systemIndex++) {
    nameStarts[systemIndex] = position;
    position += (names[systemIndex] ?? '').length + 1;
  }
  nameStarts[systemCount] = position;
  return { joinedNames: names.join('\n'), nameStarts };
}

// Chooses which layers a cell always draws in full: the rarest ones, as many
// as fit within ALWAYS_DRAWN_SHARE of the cell. Returns a Uint8Array with 1
// for each such layer.
//
// previousChoice (the same kind of array) is the choice made last time.
// Layers chosen before stay chosen until they hold twice the share, so a
// layer hovering around the limit as stars arrive doesn't keep switching
// between drawn in full and sampled, which would make its stars pop.
export function chooseAlwaysDrawnLayers(systemCountByLayer, systemCount, previousChoice = null) {
  const alwaysDrawn = new Uint8Array(systemCountByLayer.length);
  const byCountAscending = (first, second) => systemCountByLayer[first] - systemCountByLayer[second];
  const previouslyChosen = [];
  const otherLayers = [];
  for (let layerIndex = 0; layerIndex < systemCountByLayer.length; layerIndex++) {
    if (systemCountByLayer[layerIndex] === 0) {
      continue;
    }
    if (previousChoice !== null && previousChoice[layerIndex] === 1) {
      previouslyChosen.push(layerIndex);
    } else {
      otherLayers.push(layerIndex);
    }
  }
  const allowance = systemCount * ALWAYS_DRAWN_SHARE;
  let alwaysDrawnCount = 0;
  for (const layerIndex of previouslyChosen.sort(byCountAscending)) {
    if (alwaysDrawnCount + systemCountByLayer[layerIndex] > allowance * 2) {
      break;
    }
    alwaysDrawnCount += systemCountByLayer[layerIndex];
    alwaysDrawn[layerIndex] = 1;
  }
  for (const layerIndex of otherLayers.sort(byCountAscending)) {
    if (alwaysDrawnCount + systemCountByLayer[layerIndex] > allowance) {
      break;
    }
    alwaysDrawnCount += systemCountByLayer[layerIndex];
    alwaysDrawn[layerIndex] = 1;
  }
  return alwaysDrawn;
}

// Merges several lists of system indices, each already in random order, into
// one list in random order, keeping the order within each list: at each step
// the next system is taken from a list chosen with probability in proportion
// to how many it has left. If every list is a random order of its systems,
// the result is a random order of them all.
export function interleaveRandomly(lists, output, outputStart, nextRandomNumber) {
  const positions = new Uint32Array(lists.length);
  const lengths = lists.map(list => list.length);
  let remaining = lengths.reduce((total, length) => total + length, 0);
  let writePosition = outputStart;
  while (remaining > 0) {
    // A random one of the systems left, counted across the lists.
    let chosenPlace = Math.floor(nextRandomNumber() * remaining);
    let listNumber = 0;
    while (chosenPlace >= lengths[listNumber] - positions[listNumber]) {
      chosenPlace -= lengths[listNumber] - positions[listNumber];
      listNumber++;
    }
    output[writePosition++] = lists[listNumber][positions[listNumber]++];
    remaining--;
  }
  return writePosition;
}

function packCellIndices(cellIndexX, cellIndexY, cellIndexZ) {
  return ((cellIndexX + CELL_INDEX_OFFSET) * CELL_INDEX_RANGE + (cellIndexY + CELL_INDEX_OFFSET)) * CELL_INDEX_RANGE
    + (cellIndexZ + CELL_INDEX_OFFSET);
}

// Reorders a typed array so that entry n becomes the entry that was at
// newOrder[n], for the first keptCount entries.
function reorderInPlace(values, newOrder, keptCount, originalCount) {
  const oldValues = values.slice(0, originalCount);
  for (let newIndex = 0; newIndex < keptCount; newIndex++) {
    values[newIndex] = oldValues[newOrder[newIndex]];
  }
}

export class StarCell {
  constructor(cellOriginInScene, cellSize, material) {
    this.cellOriginInScene = cellOriginInScene;
    this.cellSize = cellSize;
    this.systemCount = 0;
    this.capacity = INITIAL_CELL_CAPACITY;
    this.positionsRelativeToCell = new Float32Array(this.capacity * 3);
    this.layerOfSystem = new Uint8Array(this.capacity);
    this.systemCountByLayer = new Uint32Array(MAXIMUM_LAYER_COUNT);
    // Where each system's name is: which batch string, and the start and
    // end positions within it.
    this.nameBatchOfSystem = new Uint32Array(this.capacity).fill(NO_NAME);
    this.nameStartOfSystem = new Uint32Array(this.capacity);
    this.nameEndOfSystem = new Uint32Array(this.capacity);
    this.keys = [];
    this.pickingIndex = null;
    // The first shuffledCount systems are in a known order (see
    // shuffleInNewSystems); systems after them arrived since.
    this.shuffledCount = 0;
    // Of those, the first alwaysDrawnCount belong to the cell's rarest
    // layers (marked in alwaysDrawnLayers) and are always drawn. The rest
    // of the shuffled systems are in random order, so drawing the first N
    // of them draws an even sample.
    this.alwaysDrawnCount = 0;
    this.alwaysDrawnLayers = new Uint8Array(MAXIMUM_LAYER_COUNT);
    // How many of each layer's stars are in that front block. Stars of
    // an always drawn layer that arrived since the last shuffle wait at
    // the back, with the sampled stars, until the next one.
    this.alwaysDrawnCountByLayer = new Uint32Array(MAXIMUM_LAYER_COUNT);
    this.timeOfLastAddition = 0;
    // Set each frame by the level of detail: where the fade of the sample
    // starts and ends, and how much brighter to draw the sampled stars to
    // make up for the rest.
    this.brightnessCompensation = 1;
    this.fadeStart = 0;
    this.fadeEnd = 0;
    // Bookkeeping used while a batch is being added.
    this.batchNumber = -1;
    this.systemsArrivingInBatch = 0;
    this.firstSystemToUpload = 0;

    this.points = new Points(this.createGeometry(), material);
    this.points.position.copy(cellOriginInScene);
    this.points.matrixAutoUpdate = false;
    this.points.updateMatrix();
    // Every cell shares one material; each sets its own level of detail
    // just before it is drawn.
    this.points.onBeforeRender = (renderer, scene, camera, geometry, sharedMaterial) => {
      const uniforms = sharedMaterial.uniforms;
      uniforms.sampleStart.value = this.alwaysDrawnCount;
      uniforms.brightnessCompensation.value = this.brightnessCompensation;
      uniforms.fadeStart.value = this.fadeStart;
      uniforms.fadeEnd.value = this.fadeEnd;
      uniforms.crossFadeWeight.value = this.outgoingPoints === null ? 1 : this.crossFadeProgress;
      sharedMaterial.uniformsNeedUpdate = true;
      // Once drawn, everything uploaded so far is on the graphics card.
      this.hasPendingUpload = false;
    };
    // Set by the level of detail: whether the cell was on screen in the
    // last frame. Only cells on screen dissolve when they change.
    this.wasOnScreen = false;
    // Whether systems have changed since the cell was last drawn (and so
    // uploaded), and the first of them.
    this.hasPendingUpload = true;
    this.firstSystemWaitingForUpload = 0;
    // While dissolving: the cell's previous stars, as last drawn, and
    // how far through the dissolve it is (0 to 1).
    this.outgoingPoints = null;
    this.crossFadeStartTime = 0;
    this.crossFadeProgress = 1;
  }

  // Keeps the stars as currently drawn on screen, to dissolve out of, and
  // gives the cell new graphics buffers for its new order. The old buffers
  // already hold the old order on the graphics card and are left alone, so
  // the outgoing stars cost no upload. Only done for a cell on screen whose
  // buffers are fully uploaded.
  startCrossFade() {
    this.finishCrossFade();
    if (!this.wasOnScreen || this.hasPendingUpload || !this.points.visible || this.points.parent === null) {
      return;
    }
    const outgoingPoints = new Points(this.points.geometry, this.points.material);
    outgoingPoints.position.copy(this.cellOriginInScene);
    outgoingPoints.matrixAutoUpdate = false;
    outgoingPoints.updateMatrix();
    outgoingPoints.name = `${this.points.name} (dissolving out)`;
    const lastDrawn = {
      sampleStart: this.alwaysDrawnCount,
      brightnessCompensation: this.brightnessCompensation,
      fadeStart: this.fadeStart,
      fadeEnd: this.fadeEnd,
    };
    outgoingPoints.onBeforeRender = (renderer, scene, camera, geometry, sharedMaterial) => {
      const uniforms = sharedMaterial.uniforms;
      uniforms.sampleStart.value = lastDrawn.sampleStart;
      uniforms.brightnessCompensation.value = lastDrawn.brightnessCompensation;
      uniforms.fadeStart.value = lastDrawn.fadeStart;
      uniforms.fadeEnd.value = lastDrawn.fadeEnd;
      uniforms.crossFadeWeight.value = 1 - this.crossFadeProgress;
      sharedMaterial.uniformsNeedUpdate = true;
    };
    this.points.parent.add(outgoingPoints);
    this.outgoingPoints = outgoingPoints;
    this.points.geometry = this.createGeometry();
    this.hasPendingUpload = true;
    this.firstSystemWaitingForUpload = 0;
    this.crossFadeStartTime = performance.now();
    this.crossFadeProgress = 0;
  }

  // Moves the dissolve on to the time given. Returns true while it is
  // still going.
  advanceCrossFade(now) {
    if (this.outgoingPoints === null) {
      return false;
    }
    const linearProgress = Math.min(Math.max((now - this.crossFadeStartTime) / CROSS_FADE_MILLISECONDS, 0), 1);
    // Eased, so the change starts and ends gently.
    this.crossFadeProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
    this.outgoingPoints.visible = this.points.visible;
    if (linearProgress >= 1) {
      this.finishCrossFade();
      return false;
    }
    return true;
  }

  finishCrossFade() {
    if (this.outgoingPoints === null) {
      return;
    }
    this.outgoingPoints.parent?.remove(this.outgoingPoints);
    this.outgoingPoints.geometry.dispose();
    this.outgoingPoints = null;
    this.crossFadeProgress = 1;
  }

  get unshuffledCount() {
    return this.systemCount - this.shuffledCount;
  }

  // Mixes the systems that arrived since the last shuffle in among the
  // rest, at random places. Afterwards the cell is the stars of its rarest
  // layers (always drawn), then the others, each part in random order, so
  // the first N of the others are an even sample of them.
  //
  // The new systems are shuffled among themselves, then slotted in among
  // the existing ones without changing the existing ones' order. A star
  // that was in the drawn sample therefore stays in it, only moving back by
  // the number of newcomers slotted in ahead of it; at the end of the
  // sample that move is gradual, through the fade. (Swapping each newcomer
  // with a random earlier star would also give a random order, but would
  // throw stars out of the sample at once, so they would pop as data
  // loads.) Systems move anywhere in the cell, so the whole cell is
  // uploaded again.
  shuffleInNewSystems(nextRandomNumber) {
    if (this.unshuffledCount === 0) {
      return;
    }
    const previousChoice = this.alwaysDrawnLayers;
    this.alwaysDrawnLayers = chooseAlwaysDrawnLayers(this.systemCountByLayer, this.systemCount, previousChoice);
    const alwaysDrawnLayers = this.alwaysDrawnLayers;
    const layerOfSystem = this.layerOfSystem;
    const previousAlwaysDrawnCount = this.alwaysDrawnCount;
    const previousShuffledCount = this.shuffledCount;

    // The newcomers in random order (a Fisher-Yates shuffle of their
    // indices; the stars themselves are only moved once, at the end).
    const arrivingCount = this.systemCount - previousShuffledCount;
    const arrivingOrder = new Uint32Array(arrivingCount);
    for (let position = 0; position < arrivingCount; position++) {
      arrivingOrder[position] = previousShuffledCount + position;
    }
    for (let position = arrivingCount - 1; position > 0; position--) {
      const swapWith = Math.floor(nextRandomNumber() * (position + 1));
      const heldSystem = arrivingOrder[position];
      arrivingOrder[position] = arrivingOrder[swapWith];
      arrivingOrder[swapWith] = heldSystem;
    }

    // Sort the systems into lists by the part they come from and the
    // part they go to, each list keeping the current order.
    const goesToFront = systemIndex => alwaysDrawnLayers[layerOfSystem[systemIndex]] === 1;
    const systemsBetween = (firstIndex, endIndex, wantFront) => {
      let matchingCount = 0;
      for (let systemIndex = firstIndex; systemIndex < endIndex; systemIndex++) {
        if (goesToFront(systemIndex) === wantFront) {
          matchingCount++;
        }
      }
      const matchingSystems = new Uint32Array(matchingCount);
      let writePosition = 0;
      for (let systemIndex = firstIndex; systemIndex < endIndex; systemIndex++) {
        if (goesToFront(systemIndex) === wantFront) {
          matchingSystems[writePosition++] = systemIndex;
        }
      }
      return matchingSystems;
    };
    const arrivingSystems = wantFront => {
      let matchingCount = 0;
      for (let position = 0; position < arrivingCount; position++) {
        if (goesToFront(arrivingOrder[position]) === wantFront) {
          matchingCount++;
        }
      }
      const matchingSystems = new Uint32Array(matchingCount);
      let writePosition = 0;
      for (let position = 0; position < arrivingCount; position++) {
        if (goesToFront(arrivingOrder[position]) === wantFront) {
          matchingSystems[writePosition++] = arrivingOrder[position];
        }
      }
      return matchingSystems;
    };
    const alwaysDrawnLists = [
      systemsBetween(0, previousAlwaysDrawnCount, true),
      systemsBetween(previousAlwaysDrawnCount, previousShuffledCount, true),
      arrivingSystems(true),
    ];
    const sampledLists = [
      systemsBetween(previousAlwaysDrawnCount, previousShuffledCount, false),
      systemsBetween(0, previousAlwaysDrawnCount, false),
      arrivingSystems(false),
    ];
    const newOrder = new Uint32Array(this.systemCount);
    this.startCrossFade();
    const alwaysDrawnCount = interleaveRandomly(alwaysDrawnLists, newOrder, 0, nextRandomNumber);
    interleaveRandomly(sampledLists, newOrder, alwaysDrawnCount, nextRandomNumber);
    this.applyOrder(newOrder, this.systemCount);
    this.alwaysDrawnCount = alwaysDrawnCount;
    this.alwaysDrawnCountByLayer.fill(0);
    for (let systemIndex = 0; systemIndex < alwaysDrawnCount; systemIndex++) {
      this.alwaysDrawnCountByLayer[layerOfSystem[systemIndex]]++;
    }
    this.shuffledCount = this.systemCount;
    // Systems have moved, so picking must sort them into boxes again.
    this.pickingIndex = null;
    this.uploadSystemsFrom(0);
  }

  // Drops the systems for which isKept is false, keeping the rest in
  // their order.
  keepOnlySystems(isKept) {
    const originalCount = this.systemCount;
    const newOrder = new Uint32Array(originalCount);
    let keptCount = 0;
    for (let systemIndex = 0; systemIndex < originalCount; systemIndex++) {
      if (isKept(systemIndex)) {
        newOrder[keptCount++] = systemIndex;
      }
    }
    this.applyOrder(newOrder, keptCount);
  }

  // Puts the systems in a new order: newOrder[n] is the current index of
  // the system that goes nth. Only the first keptCount entries are used;
  // systems not listed there are dropped.
  applyOrder(newOrder, keptCount) {
    const originalCount = this.systemCount;
    // Each array is reordered on its own, which keeps memory access
    // simple and fast for the millions of stars in a busy cell.
    const positions = this.positionsRelativeToCell;
    const oldPositions = positions.slice(0, originalCount * 3);
    for (let newIndex = 0; newIndex < keptCount; newIndex++) {
      const oldOffset = newOrder[newIndex] * 3;
      const newOffset = newIndex * 3;
      positions[newOffset] = oldPositions[oldOffset];
      positions[newOffset + 1] = oldPositions[oldOffset + 1];
      positions[newOffset + 2] = oldPositions[oldOffset + 2];
    }
    reorderInPlace(this.layerOfSystem, newOrder, keptCount, originalCount);
    reorderInPlace(this.nameBatchOfSystem, newOrder, keptCount, originalCount);
    reorderInPlace(this.nameStartOfSystem, newOrder, keptCount, originalCount);
    reorderInPlace(this.nameEndOfSystem, newOrder, keptCount, originalCount);
    if (this.keys.length > 0) {
      const oldKeys = this.keys;
      const newKeys = [];
      for (let newIndex = 0; newIndex < keptCount; newIndex++) {
        const key = oldKeys[newOrder[newIndex]];
        if (key !== undefined) {
          newKeys[newIndex] = key;
        }
      }
      this.keys = newKeys;
    }
    this.nameBatchOfSystem.fill(NO_NAME, keptCount, originalCount);
    this.systemCount = keptCount;
  }

  // Drops every star of one layer, keeping the order of the rest (so the
  // rare stars stay at the front and the sample stays random).
  removeLayer(layerIndex) {
    if (this.systemCountByLayer[layerIndex] === 0) {
      return;
    }
    // The outgoing stars would include the removed layer's.
    this.finishCrossFade();
    const layerOfSystem = this.layerOfSystem;
    const isKept = systemIndex => layerOfSystem[systemIndex] !== layerIndex;
    let keptShuffled = 0;
    let keptAlwaysDrawn = 0;
    for (let systemIndex = 0; systemIndex < this.shuffledCount; systemIndex++) {
      if (isKept(systemIndex)) {
        keptShuffled++;
        if (systemIndex < this.alwaysDrawnCount) {
          keptAlwaysDrawn++;
        }
      }
    }
    this.keepOnlySystems(isKept);
    this.shuffledCount = keptShuffled;
    this.alwaysDrawnCount = keptAlwaysDrawn;
    this.alwaysDrawnLayers[layerIndex] = 0;
    this.alwaysDrawnCountByLayer[layerIndex] = 0;
    this.systemCountByLayer[layerIndex] = 0;
    this.pickingIndex = null;
    this.uploadSystemsFrom(0);
  }

  createGeometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positionsRelativeToCell, 3));
    geometry.setAttribute('starLayer', new BufferAttribute(this.layerOfSystem, 1));
    geometry.setDrawRange(0, this.systemCount);
    const halfCell = this.cellSize / 2;
    geometry.boundingSphere = new Sphere(new Vector3(halfCell, halfCell, halfCell), halfCell * Math.sqrt(3));
    return geometry;
  }

  // Makes room for more systems. Returns true if the GPU buffers had to be
  // replaced, in which case everything must be uploaded again.
  ensureCapacity(requiredSystemCount) {
    if (requiredSystemCount <= this.capacity) {
      return false;
    }
    let newCapacity = this.capacity;
    while (newCapacity < requiredSystemCount) {
      newCapacity *= 2;
    }
    const largerPositions = new Float32Array(newCapacity * 3);
    largerPositions.set(this.positionsRelativeToCell.subarray(0, this.systemCount * 3));
    this.positionsRelativeToCell = largerPositions;
    const largerLayers = new Uint8Array(newCapacity);
    largerLayers.set(this.layerOfSystem.subarray(0, this.systemCount));
    this.layerOfSystem = largerLayers;
    const growNameIndex = (smallerArray, fillValue) => {
      const largerArray = new Uint32Array(newCapacity);
      largerArray.fill(fillValue, this.systemCount);
      largerArray.set(smallerArray.subarray(0, this.systemCount));
      return largerArray;
    };
    this.nameBatchOfSystem = growNameIndex(this.nameBatchOfSystem, NO_NAME);
    this.nameStartOfSystem = growNameIndex(this.nameStartOfSystem, 0);
    this.nameEndOfSystem = growNameIndex(this.nameEndOfSystem, 0);
    this.capacity = newCapacity;
    // A new geometry gets new GPU buffers; disposing the old geometry
    // frees the old buffers instead of leaking them.
    const previousGeometry = this.points.geometry;
    this.points.geometry = this.createGeometry();
    previousGeometry.dispose();
    return true;
  }

  appendSystem(relativeX, relativeY, relativeZ, layerIndex, nameBatch, nameStart, nameEnd, key) {
    const writeOffset = this.systemCount * 3;
    this.positionsRelativeToCell[writeOffset] = relativeX;
    this.positionsRelativeToCell[writeOffset + 1] = relativeY;
    this.positionsRelativeToCell[writeOffset + 2] = relativeZ;
    this.layerOfSystem[this.systemCount] = layerIndex;
    this.systemCountByLayer[layerIndex]++;
    this.nameBatchOfSystem[this.systemCount] = nameBatch;
    this.nameStartOfSystem[this.systemCount] = nameStart;
    this.nameEndOfSystem[this.systemCount] = nameEnd;
    // Keys are optional; only store them when given so systems loaded
    // without them cost nothing extra.
    if (key !== undefined) {
      this.keys[this.systemCount] = key;
    }
    this.systemCount++;
  }

  // Marks systems from firstNewSystemIndex on as needing to go to the
  // graphics card. Several batches often arrive before the cell is next
  // drawn (the loader sends one per star class), so the range waiting to
  // be uploaded is widened to cover them all, never replaced: replacing it
  // would leave earlier batches as zeros on the card, which draws them all
  // at the cell's corner.
  uploadSystemsFrom(firstNewSystemIndex) {
    const firstToUpload = this.hasPendingUpload
      ? Math.min(firstNewSystemIndex, this.firstSystemWaitingForUpload)
      : firstNewSystemIndex;
    this.firstSystemWaitingForUpload = firstToUpload;
    const geometry = this.points.geometry;
    const positionAttribute = geometry.getAttribute('position');
    positionAttribute.clearUpdateRanges();
    positionAttribute.addUpdateRange(firstToUpload * 3, (this.systemCount - firstToUpload) * 3);
    positionAttribute.needsUpdate = true;
    const layerAttribute = geometry.getAttribute('starLayer');
    layerAttribute.clearUpdateRanges();
    layerAttribute.addUpdateRange(firstToUpload, this.systemCount - firstToUpload);
    layerAttribute.needsUpdate = true;
    geometry.setDrawRange(0, this.systemCount);
    this.hasPendingUpload = true;
  }

  // How many of the cell's stars belong to layers marked in isVisibleLayer
  // (a Uint8Array by layer number), counted separately for the front block
  // that is always drawn and for the rest, which is sampled.
  countVisibleSystems(isVisibleLayer) {
    let alwaysDrawn = 0;
    let sampled = 0;
    for (let layerIndex = 0; layerIndex < MAXIMUM_LAYER_COUNT; layerIndex++) {
      const layerSystemCount = this.systemCountByLayer[layerIndex];
      if (layerSystemCount === 0 || isVisibleLayer[layerIndex] === 0) {
        continue;
      }
      const inFrontBlock = this.alwaysDrawnCountByLayer[layerIndex];
      alwaysDrawn += inFrontBlock;
      sampled += layerSystemCount - inFrontBlock;
    }
    return { alwaysDrawn, sampled };
  }

  // Sorts the cell's systems by picking box (a counting sort, so one pass
  // to count and one to place). Built the first time picking needs it and
  // rebuilt only after systems have arrived, moved or been removed.
  getPickingIndex() {
    if (this.pickingIndex !== null && this.pickingIndex.systemCount === this.systemCount && this.pickingIndex.shuffledCount === this.shuffledCount) {
      return this.pickingIndex;
    }
    const boxSize = this.cellSize / PICKING_BOXES_PER_AXIS;
    const lastBox = PICKING_BOXES_PER_AXIS - 1;
    const positions = this.positionsRelativeToCell;
    const boxOfSystem = new Uint16Array(this.systemCount);
    const boxStarts = new Uint32Array(PICKING_BOXES_PER_CELL + 1);
    for (let systemIndex = 0; systemIndex < this.systemCount; systemIndex++) {
      const boxX = Math.min(Math.max(Math.floor(positions[systemIndex * 3] / boxSize), 0), lastBox);
      const boxY = Math.min(Math.max(Math.floor(positions[systemIndex * 3 + 1] / boxSize), 0), lastBox);
      const boxZ = Math.min(Math.max(Math.floor(positions[systemIndex * 3 + 2] / boxSize), 0), lastBox);
      const box = boxX + boxY * PICKING_BOXES_PER_AXIS + boxZ * PICKING_BOXES_PER_AXIS * PICKING_BOXES_PER_AXIS;
      boxOfSystem[systemIndex] = box;
      boxStarts[box + 1]++;
    }
    for (let box = 0; box < PICKING_BOXES_PER_CELL; box++) {
      boxStarts[box + 1] += boxStarts[box];
    }
    const nextSlotInBox = boxStarts.slice(0, PICKING_BOXES_PER_CELL);
    const systemsInBoxOrder = new Uint32Array(this.systemCount);
    for (let systemIndex = 0; systemIndex < this.systemCount; systemIndex++) {
      systemsInBoxOrder[nextSlotInBox[boxOfSystem[systemIndex]]++] = systemIndex;
    }
    this.pickingIndex = { systemCount: this.systemCount, shuffledCount: this.shuffledCount, boxSize, boxStarts, systemsInBoxOrder };
    return this.pickingIndex;
  }

  dispose() {
    this.finishCrossFade();
    this.points.geometry.dispose();
  }
}

// One layer's settings. Its stars live in the field's cells.
class StarFieldLayer {
  constructor({ layerName, layerIndex, definitionNumber }) {
    this.layerName = layerName;
    this.layerIndex = layerIndex;
    this.definitionNumber = definitionNumber;
    this.label = layerName;
    // Layers are listed by order, then in the order they were defined.
    this.order = 0;
    this.appearance = { ...DEFAULT_STAR_APPEARANCE };
    this.visible = true;
    this.systemCount = 0;
  }
}

export class StarField {
  constructor({ cellSize }) {
    this.cellSize = cellSize;
    this.material = createStarMaterial();
    this.sceneObject = new Group();
    this.sceneObject.name = 'star field';
    this.cellsByPackedIndex = new Map();
    this.joinedNamesOfBatches = [];
    // Which layer each batch of names belongs to, so a removed layer's
    // names can be let go.
    this.layerIndexOfBatch = [];
    this.layersByName = new Map();
    this.layersByIndex = new Array(MAXIMUM_LAYER_COUNT).fill(null);
    // 1 for each layer number in use and visible, for the level of detail
    // and picking.
    this.isVisibleLayer = new Uint8Array(MAXIMUM_LAYER_COUNT);
    this.systemCount = 0;
    this.batchCount = 0;
    this.layersDefined = 0;
  }

  get cells() {
    return this.cellsByPackedIndex.values();
  }

  getLayer(layerName) {
    return this.layersByName.get(layerName);
  }

  // Every layer, by order then by when it was defined.
  getLayersInOrder() {
    return [...this.layersByName.values()].sort((first, second) =>
      first.order - second.order || first.definitionNumber - second.definitionNumber);
  }

  // Creates a layer, or changes an existing one. Appearance settings left
  // out keep their current (or default) values.
  defineLayer(layerName, { label, order, visible, ...appearanceChanges } = {}) {
    let layer = this.layersByName.get(layerName);
    if (layer === undefined) {
      const layerIndex = this.layersByIndex.indexOf(null);
      if (layerIndex < 0) {
        throw new Error(`Cannot define layer "${layerName}": the map holds at most ${MAXIMUM_LAYER_COUNT} layers at once. Remove one first.`);
      }
      layer = new StarFieldLayer({ layerName, layerIndex, definitionNumber: this.layersDefined++ });
      this.layersByName.set(layerName, layer);
      this.layersByIndex[layerIndex] = layer;
    }
    for (const [settingName, value] of Object.entries(appearanceChanges)) {
      if (value !== undefined && settingName in DEFAULT_STAR_APPEARANCE) {
        layer.appearance[settingName] = value;
      }
    }
    if (label !== undefined) {
      layer.label = label;
    }
    if (order !== undefined) {
      layer.order = order;
    }
    if (visible !== undefined) {
      layer.visible = visible;
    }
    this.applyLayer(layer);
    return layer;
  }

  setLayerVisibility(layerName, isVisible) {
    const layer = this.layersByName.get(layerName);
    if (layer === undefined) {
      return false;
    }
    layer.visible = isVisible;
    this.applyLayer(layer);
    return true;
  }

  applyLayer(layer) {
    applyLayerAppearance(this.material, layer.layerIndex, layer.appearance, layer.visible);
    this.isVisibleLayer[layer.layerIndex] = layer.visible ? 1 : 0;
  }

  setPixelsPerLightYearAtUnitDistance(pixelsPerLightYear) {
    this.material.uniforms.pixelsPerLightYearAtUnitDistance.value = pixelsPerLightYear;
  }

  findOrCreateCell(cellIndexX, cellIndexY, cellIndexZ) {
    const packedIndex = packCellIndices(cellIndexX, cellIndexY, cellIndexZ);
    let cell = this.cellsByPackedIndex.get(packedIndex);
    if (cell === undefined) {
      const cellOrigin = new Vector3(cellIndexX * this.cellSize, cellIndexY * this.cellSize, cellIndexZ * this.cellSize);
      cell = new StarCell(cellOrigin, this.cellSize, this.material);
      cell.points.name = `cell ${cellIndexX},${cellIndexY},${cellIndexZ}`;
      this.cellsByPackedIndex.set(packedIndex, cell);
      this.sceneObject.add(cell.points);
    }
    return cell;
  }

  // galacticPositions holds x, y, z for each system, one after another.
  // names (an array, or one string with a newline between names) and keys
  // are optional and run in parallel with the positions. A layer that has
  // not been defined is created with the default appearance.
  addSystems(layerName, { galacticPositions, names, keys }) {
    const systemsInBatch = galacticPositions.length / 3;
    if (!Number.isInteger(systemsInBatch)) {
      throw new Error(`addSystems: positions length ${galacticPositions.length} is not a multiple of 3`);
    }
    const layer = this.layersByName.get(layerName) ?? this.defineLayer(layerName);
    const layerIndex = layer.layerIndex;
    let nameBatch = NO_NAME;
    let nameStarts = null;
    if (names !== undefined && names !== null) {
      const batchNames = joinBatchNames(names, systemsInBatch);
      nameBatch = this.joinedNamesOfBatches.push(batchNames.joinedNames) - 1;
      this.layerIndexOfBatch[nameBatch] = layerIndex;
      nameStarts = batchNames.nameStarts;
    }
    const cellSize = this.cellSize;
    const batchNumber = ++this.batchCount;

    // First pass: find each system's cell and count arrivals per cell, so
    // every cell grows at most once per batch.
    const cellsInBatch = [];
    const cellListPositionOfSystem = new Uint32Array(systemsInBatch);
    for (let systemIndex = 0; systemIndex < systemsInBatch; systemIndex++) {
      const sceneX = galacticPositions[systemIndex * 3];
      const sceneY = galacticPositions[systemIndex * 3 + 1];
      const sceneZ = galacticZToSceneZ(galacticPositions[systemIndex * 3 + 2]);
      const cell = this.findOrCreateCell(Math.floor(sceneX / cellSize), Math.floor(sceneY / cellSize), Math.floor(sceneZ / cellSize));
      if (cell.batchNumber !== batchNumber) {
        cell.batchNumber = batchNumber;
        cell.systemsArrivingInBatch = 0;
        cell.positionInBatchList = cellsInBatch.length;
        cellsInBatch.push(cell);
      }
      cell.systemsArrivingInBatch++;
      cellListPositionOfSystem[systemIndex] = cell.positionInBatchList;
    }

    for (const cell of cellsInBatch) {
      const buffersWereReplaced = cell.ensureCapacity(cell.systemCount + cell.systemsArrivingInBatch);
      cell.firstSystemToUpload = buffersWereReplaced ? 0 : cell.systemCount;
    }

    // Second pass: store each system relative to its cell's corner.
    for (let systemIndex = 0; systemIndex < systemsInBatch; systemIndex++) {
      const cell = cellsInBatch[cellListPositionOfSystem[systemIndex]];
      const origin = cell.cellOriginInScene;
      cell.appendSystem(
        galacticPositions[systemIndex * 3] - origin.x,
        galacticPositions[systemIndex * 3 + 1] - origin.y,
        galacticZToSceneZ(galacticPositions[systemIndex * 3 + 2]) - origin.z,
        layerIndex,
        nameBatch,
        nameStarts === null ? 0 : nameStarts[systemIndex],
        // The next name starts one character after this one's
        // separating newline.
        nameStarts === null ? 0 : nameStarts[systemIndex + 1] - 1,
        keys ? keys[systemIndex] : undefined,
      );
    }

    const now = performance.now();
    for (const cell of cellsInBatch) {
      cell.uploadSystemsFrom(cell.firstSystemToUpload);
      cell.timeOfLastAddition = now;
    }
    layer.systemCount += systemsInBatch;
    this.systemCount += systemsInBatch;
    return layer;
  }

  // Removes a layer's stars, keeping the layer and its settings.
  clearLayer(layerName) {
    const layer = this.layersByName.get(layerName);
    if (layer === undefined) {
      return false;
    }
    const layerIndex = layer.layerIndex;
    if (layer.systemCount > 0) {
      for (const [packedIndex, cell] of this.cellsByPackedIndex) {
        cell.removeLayer(layerIndex);
        if (cell.systemCount === 0) {
          this.sceneObject.remove(cell.points);
          cell.dispose();
          this.cellsByPackedIndex.delete(packedIndex);
        }
      }
    }
    this.joinedNamesOfBatches.forEach((joinedNames, batch) => {
      if (this.layerIndexOfBatch[batch] === layerIndex) {
        this.joinedNamesOfBatches[batch] = null;
        this.layerIndexOfBatch[batch] = -1;
      }
    });
    this.systemCount -= layer.systemCount;
    layer.systemCount = 0;
    return true;
  }

  removeLayer(layerName) {
    if (!this.clearLayer(layerName)) {
      return false;
    }
    const layer = this.layersByName.get(layerName);
    this.layersByName.delete(layerName);
    this.layersByIndex[layer.layerIndex] = null;
    this.isVisibleLayer[layer.layerIndex] = 0;
    applyLayerAppearance(this.material, layer.layerIndex, DEFAULT_STAR_APPEARANCE, false);
    return true;
  }

  // Removes every layer and star at once (much quicker than one by one).
  removeAllLayers() {
    for (const cell of this.cellsByPackedIndex.values()) {
      this.sceneObject.remove(cell.points);
      cell.dispose();
    }
    this.cellsByPackedIndex.clear();
    for (const layer of this.layersByName.values()) {
      applyLayerAppearance(this.material, layer.layerIndex, DEFAULT_STAR_APPEARANCE, false);
    }
    this.layersByName.clear();
    this.layersByIndex.fill(null);
    this.isVisibleLayer.fill(0);
    this.joinedNamesOfBatches = [];
    this.layerIndexOfBatch = [];
    this.systemCount = 0;
  }

  dispose() {
    this.removeAllLayers();
    this.material.dispose();
  }

  describeSystem(cell, indexInCell) {
    const positionOffset = indexInCell * 3;
    const sceneX = cell.positionsRelativeToCell[positionOffset] + cell.cellOriginInScene.x;
    const sceneY = cell.positionsRelativeToCell[positionOffset + 1] + cell.cellOriginInScene.y;
    const sceneZ = cell.positionsRelativeToCell[positionOffset + 2] + cell.cellOriginInScene.z;
    const nameBatch = cell.nameBatchOfSystem[indexInCell];
    const joinedNames = nameBatch === NO_NAME ? null : this.joinedNamesOfBatches[nameBatch];
    const name = joinedNames === null || joinedNames === undefined
      ? undefined
      : joinedNames.substring(cell.nameStartOfSystem[indexInCell], cell.nameEndOfSystem[indexInCell]);
    return {
      layer: this.layersByIndex[cell.layerOfSystem[indexInCell]]?.layerName,
      name,
      key: cell.keys[indexInCell],
      coordinates: { x: sceneX, y: sceneY, z: sceneZToGalacticZ(sceneZ) },
    };
  }

  // Finds the visible system closest to a ray, measured as an angle from
  // the ray as seen from its origin, so the tolerance behaves like a fixed
  // number of pixels on screen whatever the distance.
  //
  // Returns { angularDistance, distanceAlongRay, system } or null.
  findSystemNearestRay(ray, angularTolerance, minimumDistance = 0) {
    const isVisibleLayer = this.isVisibleLayer;
    const tangentOfTolerance = Math.tan(angularTolerance);
    const rayOrigin = ray.origin;
    const rayDirection = ray.direction;

    // Could a sphere hold anything within the tolerance cone around the ray?
    const sphereMayTouchCone = (centreX, centreY, centreZ, radius) => {
      const towardsCentreX = centreX - rayOrigin.x;
      const towardsCentreY = centreY - rayOrigin.y;
      const towardsCentreZ = centreZ - rayOrigin.z;
      const centreAlongRay = towardsCentreX * rayDirection.x + towardsCentreY * rayDirection.y + towardsCentreZ * rayDirection.z;
      if (centreAlongRay < -radius) {
        return false;
      }
      const centreDistanceSquared = towardsCentreX * towardsCentreX + towardsCentreY * towardsCentreY + towardsCentreZ * towardsCentreZ;
      const centreDistanceFromRay = Math.sqrt(Math.max(centreDistanceSquared - centreAlongRay * centreAlongRay, 0));
      return centreDistanceFromRay <= radius + Math.max(centreAlongRay + radius, 0) * tangentOfTolerance;
    };

    let bestAngularDistance = angularTolerance;
    let bestDistanceAlongRay = Infinity;
    let bestCell = null;
    let bestIndexInCell = -1;

    const halfCell = this.cellSize / 2;
    const cellRadius = halfCell * Math.sqrt(3);
    for (const cell of this.cellsByPackedIndex.values()) {
      const origin = cell.cellOriginInScene;
      if (!sphereMayTouchCone(origin.x + halfCell, origin.y + halfCell, origin.z + halfCell, cellRadius)) {
        continue;
      }
      const visibleCounts = cell.countVisibleSystems(isVisibleLayer);
      if (visibleCounts.alwaysDrawn + visibleCounts.sampled === 0) {
        continue;
      }
      const { boxSize, boxStarts, systemsInBoxOrder } = cell.getPickingIndex();
      const halfBox = boxSize / 2;
      const boxRadius = halfBox * Math.sqrt(3);
      const offsetX = origin.x - rayOrigin.x;
      const offsetY = origin.y - rayOrigin.y;
      const offsetZ = origin.z - rayOrigin.z;
      const positions = cell.positionsRelativeToCell;
      const layerOfSystem = cell.layerOfSystem;

      for (let box = 0; box < PICKING_BOXES_PER_CELL; box++) {
        const firstInBox = boxStarts[box];
        const endOfBox = boxStarts[box + 1];
        if (firstInBox === endOfBox) {
          continue;
        }
        const boxX = box % PICKING_BOXES_PER_AXIS;
        const boxY = Math.floor(box / PICKING_BOXES_PER_AXIS) % PICKING_BOXES_PER_AXIS;
        const boxZ = Math.floor(box / (PICKING_BOXES_PER_AXIS * PICKING_BOXES_PER_AXIS));
        const boxCentreX = origin.x + boxX * boxSize + halfBox;
        const boxCentreY = origin.y + boxY * boxSize + halfBox;
        const boxCentreZ = origin.z + boxZ * boxSize + halfBox;
        if (!sphereMayTouchCone(boxCentreX, boxCentreY, boxCentreZ, boxRadius)) {
          continue;
        }
        for (let slot = firstInBox; slot < endOfBox; slot++) {
          const indexInCell = systemsInBoxOrder[slot];
          if (isVisibleLayer[layerOfSystem[indexInCell]] === 0) {
            continue;
          }
          const towardsSystemX = positions[indexInCell * 3] + offsetX;
          const towardsSystemY = positions[indexInCell * 3 + 1] + offsetY;
          const towardsSystemZ = positions[indexInCell * 3 + 2] + offsetZ;
          const distanceAlongRay = towardsSystemX * rayDirection.x + towardsSystemY * rayDirection.y + towardsSystemZ * rayDirection.z;
          if (distanceAlongRay <= minimumDistance) {
            continue;
          }
          const distanceSquared = towardsSystemX * towardsSystemX + towardsSystemY * towardsSystemY + towardsSystemZ * towardsSystemZ;
          const distanceFromRay = Math.sqrt(Math.max(distanceSquared - distanceAlongRay * distanceAlongRay, 0));
          const angularDistance = Math.atan2(distanceFromRay, distanceAlongRay);
          const isCloserToRay = angularDistance < bestAngularDistance;
          // Between two stars at the same angle, prefer the nearer one.
          const isEquallyCloseButNearer = angularDistance === bestAngularDistance && distanceAlongRay < bestDistanceAlongRay;
          if (isCloserToRay || isEquallyCloseButNearer) {
            bestAngularDistance = angularDistance;
            bestDistanceAlongRay = distanceAlongRay;
            bestCell = cell;
            bestIndexInCell = indexInCell;
          }
        }
      }
    }

    if (bestCell === null) {
      return null;
    }
    return {
      angularDistance: bestAngularDistance,
      distanceAlongRay: bestDistanceAlongRay,
      system: this.describeSystem(bestCell, bestIndexInCell),
    };
  }
}
