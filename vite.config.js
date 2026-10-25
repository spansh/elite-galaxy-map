import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// `pnpm run demo` serves examples/ for development, on every network
// interface so it can be reached from outside a container. The port is
// Vite's usual 5173, or DEMO_PORT if set:
//     DEMO_PORT=8080 pnpm run demo
// `pnpm run build` writes dist/galaxy-map.standalone.js, for pages using an
// import map without a bundler; only three stays as an import. Bundlers use
// the source directly.
export default defineConfig(({ command }) => {
    if (command === 'serve') {
        return {
            root: fileURLToPath(new URL('./examples', import.meta.url)),
            server: {
                host: '0.0.0.0',
                port: process.env.DEMO_PORT ? Number(process.env.DEMO_PORT) : 5173,
                // With a port asked for, fail rather than quietly move to
                // another one (which a container, say, wouldn't publish).
                strictPort: Boolean(process.env.DEMO_PORT),
                // Host names the demo may be opened as, besides localhost,
                // from DEMO_ALLOWED_HOSTS (comma separated). Vite refuses
                // requests addressed to any other name, to guard against DNS
                // rebinding. A leading dot allows every name under a domain:
                //     DEMO_ALLOWED_HOSTS=demo.example.com,.example.org pnpm run demo
                allowedHosts: (process.env.DEMO_ALLOWED_HOSTS ?? '')
                    .split(',')
                    .map(hostName => hostName.trim())
                    .filter(hostName => hostName !== ''),
                fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] },
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
