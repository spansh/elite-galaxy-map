import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Vite is used to build, never as a server: its development server serves
// files from the machine on request, and scanners on the internet look for
// it and use holes in that to read files they shouldn't. `pnpm run demo`
// (scripts/serve-demo.mjs) builds the demo with Vite and serves the result
// with a plain static file server instead, the way `ember serve` does.
//
// `pnpm run build` writes dist/galaxy-map.standalone.js, for pages using an
// import map without a bundler; only three stays as an import. Bundlers use
// the source directly.
//
// `pnpm run build:demo` (--mode demo) writes the demo to dist-demo/: plain
// files to put behind any web server. scripts/serve-demo.mjs builds the same
// with --mode demo-watch, which also reloads the page after each rebuild.
export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    throw new Error('The Vite development server is not used here. Run `pnpm run demo` instead (see scripts/serve-demo.mjs).');
  }
  if (mode === 'demo' || mode === 'demo-watch') {
    return {
      root: fileURLToPath(new URL('./examples', import.meta.url)),
      // The demo's own data (dumps, density maps) is served from
      // examples/public/ as it is, not copied: dumps can be gigabytes.
      publicDir: false,
      build: {
        outDir: fileURLToPath(new URL('./dist-demo', import.meta.url)),
        emptyOutDir: true,
        sourcemap: true,
        // three.js is big; the warning about it says nothing new.
        chunkSizeWarningLimit: 4000,
      },
    };
  }
  const isExternal = moduleName => moduleName === 'three' || moduleName.startsWith('three/');
  return {
    build: {
      emptyOutDir: true,
      sourcemap: true,
      lib: {
        entry: fileURLToPath(new URL('./src/index.js', import.meta.url)),
        formats: ['es'],
        fileName: () => 'galaxy-map.standalone.js',
      },
      rollupOptions: { external: isExternal },
    },
  };
});
