import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { parseDumpLine, readLines, unpackIfGzipped } from '../examples/spansh-loader/readLines.js';

function streamOfChunks(chunks) {
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(chunk);
            }
            controller.close();
        },
    });
}

async function collectLines(byteStream) {
    const lines = [];
    for await (const line of readLines(byteStream)) {
        lines.push(line);
    }
    return lines;
}

describe('readLines', () => {
    it('joins lines split across chunks and keeps a last line with no newline', async () => {
        const encoder = new TextEncoder();
        const lines = await collectLines(streamOfChunks([encoder.encode('first li'), encoder.encode('ne\nsecond\nthi'), encoder.encode('rd')]));
        expect(lines).toEqual(['first line', 'second', 'third']);
    });

    it('decodes a multi-byte character split between chunks', async () => {
        const bytes = new TextEncoder().encode('Fóð Áá\nnext\n');
        // Split in the middle of the two-byte "ó".
        const splitPoint = 2;
        const lines = await collectLines(streamOfChunks([bytes.slice(0, splitPoint), bytes.slice(splitPoint)]));
        expect(lines).toEqual(['Fóð Áá', 'next']);
    });
});

describe('parseDumpLine', () => {
    it('skips the array brackets and parses systems with or without a trailing comma', () => {
        expect(parseDumpLine('[')).toBeNull();
        expect(parseDumpLine(']')).toBeNull();
        expect(parseDumpLine('')).toBeNull();
        const system = parseDumpLine('\t{"name":"Sol","coords":{"x":0,"y":0,"z":0}},');
        expect(system).toEqual({ name: 'Sol', coords: { x: 0, y: 0, z: 0 } });
        expect(parseDumpLine('{"name":"Last","coords":{"x":1,"y":2,"z":3}}').name).toBe('Last');
    });
});

describe('unpackIfGzipped', () => {
    const dumpText = '[\n{"name":"Sol"},\n{"name":"Achenar"}\n]\n';

    it('unpacks gzip bytes, whatever the file is called', async () => {
        const packed = new Uint8Array(gzipSync(Buffer.from(dumpText)));
        const { byteStream, wasGzip } = await unpackIfGzipped(streamOfChunks([packed]));
        expect(wasGzip).toBe(true);
        expect(await new Response(byteStream).text()).toBe(dumpText);
    });

    it('recognises gzip even when it arrives a byte at a time', async () => {
        const packed = new Uint8Array(gzipSync(Buffer.from(dumpText)));
        const oneByteChunks = Array.from(packed, byteValue => new Uint8Array([byteValue]));
        const { byteStream, wasGzip } = await unpackIfGzipped(streamOfChunks(oneByteChunks));
        expect(wasGzip).toBe(true);
        expect(await new Response(byteStream).text()).toBe(dumpText);
    });

    it('passes plain text through, including text the browser already unpacked', async () => {
        const plain = new TextEncoder().encode(dumpText);
        const { byteStream, wasGzip } = await unpackIfGzipped(streamOfChunks([plain.subarray(0, 1), plain.subarray(1)]));
        expect(wasGzip).toBe(false);
        expect(await new Response(byteStream).text()).toBe(dumpText);
    });

    it('copes with an empty body', async () => {
        const { byteStream, wasGzip } = await unpackIfGzipped(streamOfChunks([]));
        expect(wasGzip).toBe(false);
        expect(await new Response(byteStream).text()).toBe('');
    });
});
