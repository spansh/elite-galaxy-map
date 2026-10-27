// Splits a stream of bytes into lines of text. The decoding is done by
// TextDecoderStream, which (unlike calling TextDecoder.decode on each chunk)
// handles a multi-byte character that is split across two network chunks.
export async function* readLines(byteStream) {
  const textReader = byteStream.pipeThrough(new TextDecoderStream('utf-8')).getReader();
  let unfinishedLine = '';
  for (;;) {
    const { value: textChunk, done: streamFinished } = await textReader.read();
    if (streamFinished) {
      break;
    }
    const text = unfinishedLine + textChunk;
    let lineStart = 0;
    for (;;) {
      const lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd < 0) {
        break;
      }
      yield text.substring(lineStart, lineEnd);
      lineStart = lineEnd + 1;
    }
    unfinishedLine = text.substring(lineStart);
  }
  // The last line may not end with a newline.
  if (unfinishedLine.length > 0) {
    yield unfinishedLine;
  }
}

// Spansh dumps are a JSON array with one system per line:
//
//     [
//         {"id64":...,"name":"...","coords":{...}},
//         ...
//     ]
//
// Returns the parsed system, or null for the bracket and blank lines.
export function parseDumpLine(line) {
  let systemJson = line.trim();
  if (systemJson === '' || systemJson === '[' || systemJson === ']') {
    return null;
  }
  if (systemJson.endsWith(',')) {
    systemJson = systemJson.slice(0, -1);
  }
  return JSON.parse(systemJson);
}

// The two bytes every gzip file starts with.
const GZIP_SIGNATURE = [0x1f, 0x8b];

// Unpacks a byte stream if it is gzip, going by its first bytes rather than
// by the file name or headers: a server may send a .gz file as it is (as
// downloads.spansh.co.uk does), or have the browser unpack it on the way
// (Content-Encoding), and a page on another site often can't see which.
// Returns { byteStream, wasGzip }.
export async function unpackIfGzipped(byteStream) {
  const reader = byteStream.getReader();
  const firstChunks = [];
  let firstBytesSeen = 0;
  let streamFinished = false;
  while (firstBytesSeen < GZIP_SIGNATURE.length) {
    const { value, done } = await reader.read();
    if (done) {
      streamFinished = true;
      break;
    }
    firstChunks.push(value);
    firstBytesSeen += value.length;
  }
  const firstBytes = firstChunks.length === 0 ? new Uint8Array(0) : new Uint8Array(await new Blob(firstChunks).arrayBuffer());
  const wasGzip = GZIP_SIGNATURE.every((signatureByte, position) => firstBytes[position] === signatureByte);
  // The same stream again, with the bytes already read put back in front.
  const wholeStream = new ReadableStream({
    start(controller) {
      for (const chunk of firstChunks) {
        controller.enqueue(chunk);
      }
      if (streamFinished) {
        controller.close();
      }
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { byteStream: wasGzip ? wholeStream.pipeThrough(new DecompressionStream('gzip')) : wholeStream, wasGzip };
}
