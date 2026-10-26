// Types for elite-galaxy-map/read-lines.js, the example loader's dump reading helpers.

/** Splits a byte stream into lines of text. */
export function readLines(byteStream: ReadableStream<Uint8Array>): AsyncGenerator<string>;

/** Parses one line of a Spansh dump; null for the bracket and blank lines. */
export function parseDumpLine(line: string): Record<string, unknown> | null;

/** Unpacks a byte stream if it starts with the gzip signature. */
export function unpackIfGzipped(byteStream: ReadableStream<Uint8Array>): Promise<{ byteStream: ReadableStream<Uint8Array>; wasGzip: boolean }>;
