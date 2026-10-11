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
    server: {
        watch: {
            // API validators and catalog resources are published together by the
            // authored-input watcher, then its ready marker restarts Express/Vite.
            // Do not hydrate against intermediate generator writes; ordinary Vue
            // and stylesheet source edits still use Vite's normal HMR boundary.
            // Test traces and review/coverage reports contain HTML, but they are
            // runtime evidence rather than application inputs. Watching them would
            // replace a live document and discard drafts while a browser test runs.
            ignored: ['**/.generated/**', '**/src/modules/localization/generated/**', '**/src/types/**',
                '**/.temp/**', '**/test-results/**', '**/playwright-report/**', '**/coverage/**', '**/dist/**'],
        },
    },
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
