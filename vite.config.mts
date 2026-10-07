import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/** Each build owns its output directory; neither may clean legacy esbuild or server assets. */
export default defineConfig(({isSsrBuild}) => ({
    plugins: [vue()],
    publicDir: false,
    base: '/app/',
    build: {
        target: 'es2020',
        outDir: resolve(projectRoot, isSsrBuild ? 'dist/frontend-server' : 'dist/public/app'),
        emptyOutDir: true,
        manifest: !isSsrBuild,
        ssrManifest: !isSsrBuild,
        sourcemap: true,
        rollupOptions: {
            input: resolve(projectRoot, isSsrBuild
                ? 'src/frontend/app/entry-server.ts'
                : 'src/frontend/app/entry-client.ts'),
            output: isSsrBuild ? {entryFileNames: 'entry-server.mjs', chunkFileNames: '[name]-[hash].mjs'} : undefined,
        },
    },
}));
