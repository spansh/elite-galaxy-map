// Example loader: streams a Spansh systems dump in a Web Worker and posts
// galaxy map commands back to the page, which passes them straight on:
//
//     const loader = new Worker(new URL('./spansh-loader-worker.js', import.meta.url), { type: 'module' });
//     loader.addEventListener('message', event => galaxyMap.dispatch(event.data));
//     loader.postMessage({ type: 'startLoading', url: '/dumps/systems_neutron.json.gz' });
//
// Messages this worker accepts:
//   { type: 'startLoading', url, batchSize?, includeNames? }
//   { type: 'stopLoading' }
//
// Systems are split into map layers by the class of their main star (see
// starClasses.js): one per spectral letter, plus white dwarfs, neutron stars
// and so on. The map draws all layers together, so this costs nothing
// extra. Positions are sent as transferable Float32Arrays, so nothing is
// copied between threads.

import { parseDumpLine, readLines, unpackIfGzipped } from './readLines.js';
import { layerForMainStar } from './starClasses.js';

const PROGRESS_INTERVAL_MILLISECONDS = 250;
// Partly filled batches are still sent this often, so the first stars, and
// layers with few systems, appear promptly.
const FLUSH_INTERVAL_MILLISECONDS = 400;

let currentLoadingAbort = null;

class LayerBatch {
  // postToPage sends a message to the page (and stays silent once the
  // load has been stopped).
  constructor(layerDescription, batchSize, includeNames, postToPage) {
    this.layerDescription = layerDescription;
    this.postToPage = postToPage;
    this.batchSize = batchSize;
    this.includeNames = includeNames;
    this.hasBeenDefined = false;
    this.startNewBatch();
  }

  startNewBatch() {
    this.positions = new Float32Array(this.batchSize * 3);
    this.names = this.includeNames ? [] : undefined;
    this.systemCount = 0;
  }

  add(system) {
    const writeOffset = this.systemCount * 3;
    this.positions[writeOffset] = system.coords.x;
    this.positions[writeOffset + 1] = system.coords.y;
    this.positions[writeOffset + 2] = system.coords.z;
    this.names?.push(system.name);
    this.systemCount++;
  }

  get isFull() {
    return this.systemCount >= this.batchSize;
  }

  send() {
    if (this.systemCount === 0) {
      return;
    }
    if (!this.hasBeenDefined) {
      this.postToPage({ type: 'defineLayer', ...this.layerDescription });
      this.hasBeenDefined = true;
    }
    // slice() makes a buffer of exactly the right length to hand over.
    const positions = this.positions.slice(0, this.systemCount * 3);
    // One joined string crosses to the page far faster than an array of
    // a hundred thousand small ones, and the map stores it as it is.
    const names = this.names === undefined ? undefined : this.names.join('\n');
    this.postToPage({ type: 'addSystems', layer: this.layerDescription.layer, positions, names }, [positions.buffer]);
    this.startNewBatch();
  }
}

function countBytesPassingThrough(onBytes) {
  return new TransformStream({
    transform(chunk, controller) {
      onBytes(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });
}

async function loadDump({ url, batchSize = 100000, includeNames = true }, abortSignal) {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }
  // Once stopped (or replaced by a new load), nothing more reaches the page.
  const postToPage = (message, transfer) => {
    if (!abortSignal.aborted) {
      self.postMessage(message, transfer);
    }
  };
  let loadedBytes = 0;
  const countedStream = response.body.pipeThrough(countBytesPassingThrough(byteCount => { loadedBytes += byteCount; }));
  const { byteStream, wasGzip } = await unpackIfGzipped(countedStream);
  // Content-Length is the size of the body as sent. The bytes counted are
  // that only if the browser didn't unpack it on the way, which it does
  // with Content-Encoding (a header a page on another site may not be
  // allowed to see). A .gz file whose bytes aren't gzip by the time they
  // arrive was unpacked that way, so there's no total to show then.
  const fileName = new URL(url, self.location.href).pathname;
  const browserUnpackedTheBody = response.headers.get('content-encoding') !== null || (fileName.endsWith('.gz') && !wasGzip);
  const totalBytes = browserUnpackedTheBody ? undefined : Number(response.headers.get('content-length')) || undefined;

  const batchesByLayer = new Map();
  // There are only a few dozen main star types, so each is classified once.
  const layerByMainStar = new Map();
  const batchForStar = mainStar => {
    let layerDescription = layerByMainStar.get(mainStar);
    if (layerDescription === undefined) {
      layerDescription = layerForMainStar(mainStar);
      layerByMainStar.set(mainStar, layerDescription);
    }
    let batch = batchesByLayer.get(layerDescription.layer);
    if (batch === undefined) {
      batch = new LayerBatch(layerDescription, batchSize, includeNames, postToPage);
      batchesByLayer.set(layerDescription.layer, batch);
    }
    return batch;
  };

  let systemCount = 0;
  let lastProgressTime = 0;
  let lastFlushTime = performance.now();
  for await (const line of readLines(byteStream)) {
    // Stopped: drop what is still being read rather than send it.
    if (abortSignal.aborted) {
      return;
    }
    const system = parseDumpLine(line);
    if (system === null) {
      continue;
    }
    const batch = batchForStar(system.mainStar);
    batch.add(system);
    systemCount++;
    if (batch.isFull) {
      batch.send();
    }
    // Checking the clock on every line would cost more than the parsing.
    if ((systemCount & 0x3ff) === 0) {
      const now = performance.now();
      if (now - lastFlushTime > FLUSH_INTERVAL_MILLISECONDS) {
        for (const pendingBatch of batchesByLayer.values()) {
          pendingBatch.send();
        }
        lastFlushTime = now;
      }
      if (now - lastProgressTime > PROGRESS_INTERVAL_MILLISECONDS) {
        postToPage({ type: 'loadingProgress', loadedBytes, totalBytes, systemCount });
        lastProgressTime = now;
      }
    }
  }
  if (abortSignal.aborted) {
    return;
  }
  // Send whatever is left, however few systems that is.
  for (const pendingBatch of batchesByLayer.values()) {
    pendingBatch.send();
  }
  postToPage({ type: 'loadingProgress', loadedBytes, totalBytes, systemCount });
  postToPage({ type: 'loadingFinished', systemCount });
}

self.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'startLoading': {
      currentLoadingAbort?.abort();
      const loadingAbort = new AbortController();
      currentLoadingAbort = loadingAbort;
      loadDump(message, loadingAbort.signal).catch(error => {
        if (!loadingAbort.signal.aborted) {
          self.postMessage({ type: 'loadingFailed', message: error.message });
        }
      });
      break;
    }
    case 'stopLoading':
      currentLoadingAbort?.abort();
      currentLoadingAbort = null;
      self.postMessage({ type: 'loadingFinished' });
      break;
    default:
      self.postMessage({ type: 'loadingFailed', message: `Loader does not understand message type "${message.type}"` });
  }
});
