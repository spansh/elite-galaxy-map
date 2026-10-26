#!/usr/bin/env node
// `pnpm run demo`: builds the demo with Vite, rebuilds it whenever a file
// changes, and serves it, reloading the page after each rebuild, much as
// `ember serve` does.
//
// Vite's own development server isn't used: it serves files from the machine
// on request, and scanners on the internet look for it and use holes in
// that to read files they shouldn't. This server only serves the files that
// are in the build's output folder and the extra folders in SETTINGS: it
// lists them, skipping dotfiles, and a request can only fetch a path on that
// list, so nothing a visitor sends is ever turned into a path on disk.
//
// Settings, from the environment (named with SETTINGS.environmentPrefix):
//   DEMO_PORT           port to listen on (default SETTINGS.defaultPort)
//   DEMO_HOST           address to listen on (default 127.0.0.1, this
//                       machine only; browsers still reach it as
//                       localhost); 0.0.0.0 for every interface, for
//                       example inside a container whose port is published
//                       on 127.0.0.1 only. Never make it reachable from the
//                       internet.
//   DEMO_ALLOWED_HOSTS  host names the demo may be opened as besides
//                       localhost and IP addresses, comma separated; a
//                       leading dot allows every name under a domain. Other
//                       names are refused, against DNS rebinding.
//
//     DEMO_PORT=8080 pnpm run demo
//
// To use it in another project: copy this file into the project's scripts/
// folder, change SETTINGS below, and give the Vite config a build mode
// (SETTINGS.viteBuildMode) whose build.outDir is SETTINGS.builtFolder. Its
// only dependency is Vite. For the page to reload itself after a rebuild,
// add this to its JavaScript (Vite drops it from builds in other modes):
//
//     if (import.meta.env.MODE === 'demo-watch') {
//         new EventSource('/__demo-reload').addEventListener('rebuilt', () => location.reload());
//     }

// ---- Settings -------------------------------------------------------------

// Paths are relative to the project folder: the one above this script's.
const SETTINGS = {
    // The Vite config to build with, and the mode to build in.
    viteConfigFile: 'vite.config.js',
    viteBuildMode: 'demo-watch',
    // Where that build writes its output (its build.outDir).
    builtFolder: 'dist-demo',
    // Folders served as they are from the root of the site, after the built
    // files: for files too big to copy into every build, such as data.
    extraFolders: ['examples/public'],
    // Start of the environment variables' names (DEMO_PORT and so on).
    environmentPrefix: 'DEMO',
    defaultPort: 5173,
    // Where the page listens for "rebuilt" messages.
    reloadEventsPath: '/__demo-reload',
};

import { createReadStream, readdirSync, statSync, watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectFolder = fileURLToPath(new URL('..', import.meta.url));
const builtFolder = join(projectFolder, SETTINGS.builtFolder);
const extraFolders = SETTINGS.extraFolders.map(folder => join(projectFolder, folder));

const environmentSetting = name => process.env[`${SETTINGS.environmentPrefix}_${name}`];
const port = Number(environmentSetting('PORT') ?? SETTINGS.defaultPort);
// 127.0.0.1 rather than localhost, which Node may take to mean the IPv6
// address ::1 alone: SSH tunnels and Docker's port publishing then can't
// reach it over IPv4, and connections are reset.
const listenAddress = environmentSetting('HOST') || '127.0.0.1';
const allowedHostNames = (environmentSetting('ALLOWED_HOSTS') ?? '')
    .split(',')
    .map(hostName => hostName.trim().toLowerCase())
    .filter(hostName => hostName !== '');

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.map': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.wasm': 'application/wasm',
    // Sent as it is, as downloads.spansh.co.uk does: the example loader
    // unpacks it, and can then show progress against the file's size.
    '.gz': 'application/gzip',
};

// ---- Which files can be served ------------------------------------------

// Every file under a folder, by the URL path it's served at. Dotfiles and
// dot folders are left out, and so are folders reached through symbolic
// links (a linked file, such as a dump kept elsewhere, is fine).
function listFiles(folder) {
    const filesByUrlPath = new Map();
    const visit = (absoluteFolder, urlFolder) => {
        let entries;
        try {
            entries = readdirSync(absoluteFolder, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) {
                continue;
            }
            const absolutePath = join(absoluteFolder, entry.name);
            const urlPath = `${urlFolder}/${entry.name}`;
            if (entry.isDirectory()) {
                visit(absolutePath, urlPath);
            } else if (entry.isFile() || (entry.isSymbolicLink() && isFile(absolutePath))) {
                filesByUrlPath.set(urlPath, absolutePath);
            }
        }
    };
    visit(folder, '');
    return filesByUrlPath;
}

function isFile(absolutePath) {
    try {
        return statSync(absolutePath).isFile();
    } catch {
        return false;
    }
}

// Every file in the extra folders; where two have a file at the same path,
// the earlier folder's wins.
function listExtraFiles() {
    const filesByUrlPath = new Map();
    for (const folder of [...extraFolders].reverse()) {
        for (const [urlPath, absolutePath] of listFiles(folder)) {
            filesByUrlPath.set(urlPath, absolutePath);
        }
    }
    return filesByUrlPath;
}

let builtFiles = new Map();
let extraFiles = listExtraFiles();

function findFile(urlPath) {
    return builtFiles.get(urlPath) ?? extraFiles.get(urlPath);
}

// A file added to an extra folder while the server runs (a dump, say) is
// found by listing the folders again whenever anything in them changes,
// once the changes have settled for a moment.
let relistingTimer;
for (const folder of extraFolders) {
    try {
        watch(folder, { recursive: true }, () => {
            clearTimeout(relistingTimer);
            relistingTimer = setTimeout(() => {
                extraFiles = listExtraFiles();
            }, 100);
        }).on('error', () => {});
    } catch {
        // The folder doesn't exist; there's nothing in it to serve.
    }
}

// ---- Requests -----------------------------------------------------------

function isAllowedHost(hostHeader) {
    if (hostHeader === undefined) {
        return false;
    }
    const hostName = hostHeader.toLowerCase().replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
    if (hostName === 'localhost' || hostName.endsWith('.localhost') || isIP(hostName) !== 0) {
        return true;
    }
    return allowedHostNames.some(allowed => allowed.startsWith('.')
        ? hostName.endsWith(allowed) || hostName === allowed.slice(1)
        : hostName === allowed);
}

function sendText(response, statusCode, text) {
    response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(text);
}

const pagesWaitingForReload = new Set();

function startReloadEvents(response) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    response.write(': connected\n\n');
    pagesWaitingForReload.add(response);
    response.on('close', () => pagesWaitingForReload.delete(response));
}

function tellPages(eventName, message = '') {
    for (const response of pagesWaitingForReload) {
        response.write(`event: ${eventName}\ndata: ${JSON.stringify(message)}\n\n`);
    }
}

async function sendFile(request, response, absolutePath) {
    let fileStatus;
    try {
        fileStatus = await stat(absolutePath);
    } catch {
        // Gone since it was listed, for example during a rebuild.
        sendText(response, 404, 'Not found');
        return;
    }
    response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(absolutePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': fileStatus.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
        response.end();
        return;
    }
    const fileStream = createReadStream(absolutePath);
    // A read that fails part way (the file removed by a rebuild, say) ends
    // this response; it never takes the server down.
    fileStream.on('error', () => response.destroy());
    response.on('close', () => fileStream.destroy());
    fileStream.pipe(response);
}

function handleRequest(request, response) {
    if (!isAllowedHost(request.headers.host)) {
        sendText(response, 403, `This server doesn't answer to the host name "${request.headers.host}". Add it to ${SETTINGS.environmentPrefix}_ALLOWED_HOSTS to allow it.`);
        return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendText(response, 405, 'Only GET and HEAD');
        return;
    }
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(request.url, 'http://demo').pathname);
    } catch {
        sendText(response, 400, 'Bad request');
        return;
    }
    if (urlPath === SETTINGS.reloadEventsPath) {
        startReloadEvents(response);
        return;
    }
    if (urlPath.endsWith('/')) {
        urlPath += 'index.html';
    }
    // Looked up by name in the lists of files: never joined onto a folder.
    const absolutePath = findFile(urlPath);
    if (absolutePath === undefined) {
        sendText(response, 404, 'Not found');
        return;
    }
    sendFile(request, response, absolutePath).catch(() => response.destroy());
}

// ---- Building -----------------------------------------------------------

const watcher = await build({
    configFile: join(projectFolder, SETTINGS.viteConfigFile),
    mode: SETTINGS.viteBuildMode,
    logLevel: 'warn',
    build: { watch: {} },
});
watcher.on('event', event => {
    if (event.code === 'START') {
        console.log('Building...');
    } else if (event.code === 'BUNDLE_END') {
        event.result.close();
        builtFiles = listFiles(builtFolder);
        console.log(`Built in ${(event.duration / 1000).toFixed(1)} s`);
        tellPages('rebuilt');
    } else if (event.code === 'ERROR') {
        event.result?.close();
        console.error(`Build failed: ${event.error.message}`);
        tellPages('buildfailed', event.error.message);
    }
});

const server = createServer(handleRequest);
server.listen(port, listenAddress, () => {
    const shownAddress = listenAddress.includes(':') ? `[${listenAddress}]` : listenAddress;
    const isThisMachineOnly = ['127.0.0.1', '::1', 'localhost'].includes(listenAddress);
    console.log(`Serving at http://${isThisMachineOnly || listenAddress === '0.0.0.0' ? 'localhost' : shownAddress}:${port}/`);
    if (!isThisMachineOnly) {
        console.log(`Listening on ${shownAddress}: keep this port off the internet (publish it on 127.0.0.1 and use an SSH tunnel).`);
    }
});

const stop = async () => {
    for (const response of pagesWaitingForReload) {
        response.end();
    }
    server.close();
    await watcher.close();
    process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
