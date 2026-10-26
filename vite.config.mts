import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {brotliCompress, constants, gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {defineConfig, type Plugin} from 'vite';
import vue from '@vitejs/plugin-vue';
import {frontendBoundary, frontendBrowserDependencies} from './src/backend/modules/frontendBoundary';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

/** Ship the full notice beside redistributed icon fonts. CSS-only dependencies
 * are not guaranteed to appear in JavaScript dependency-license inventories. */
function frontendAssetLicenses(): Plugin {
    return {name: 'surveyor-frontend-asset-licenses',
        generateBundle() {
            // Release packaging copies this public build tree verbatim, keeping
            // the upstream notice with the same release's emitted font files.
            this.emitFile({type: 'asset', fileName: 'licenses/bootstrap-icons-LICENSE.txt',
                source: readFileSync(resolve(projectRoot, 'node_modules/bootstrap-icons/LICENSE'), 'utf8')});
        },
    };
}

/** Prepare public asset encodings once during the client build. Request delivery
 * only selects these files; it never spends a slow client's wait compressing JS. */
function precompressedAssets(): Plugin {
    return {name: 'surveyor-precompressed-assets',
        async writeBundle(output, bundle) {
            if (!output.dir) return;
            // Only emitted browser text assets get sidecars. Source maps and SSR
            // modules remain outside public encoding negotiation and its manifest.
            for (const asset of Object.values(bundle)) {
                if (!/\.(?:js|css|svg)$/u.test(asset.fileName)) continue;
                const source = asset.type === 'chunk' ? asset.code : asset.source;
                const bytes = Buffer.from(source);
                const encoded = await Promise.all([
                    // Spend release-build time for the smallest slow-network
                    // payload; requests only serve the prepared representation.
                    compressBrotli(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}),
                    compressGzip(bytes, {level: 9}),
                ]);
                // A tiny file can be smaller without compression. Preserve its
                // original fallback instead of publishing a slower representation.
                for (const [index, extension] of ['br', 'gz'].entries()) {
                    if (encoded[index]!.length < bytes.length) {
                        await writeFile(resolve(output.dir, `${asset.fileName}.${extension}`), encoded[index]!);
                    }
                }
            }
        },
    };
}

/** Client and SSR builds own separate output directories and preserve the server and print assets. */
export default defineConfig(({isSsrBuild}) => ({
    plugins: [frontendBoundary(projectRoot), vue(), ...isSsrBuild ? [] : [frontendAssetLicenses(), precompressedAssets()]],
    publicDir: false,
    base: '/app/',
    // Only reviewed browser entry points may produce publicly served optimized
    // modules. A request cannot discover or prebundle another installed package.
    optimizeDeps: {noDiscovery: true, include: frontendBrowserDependencies},
    server: {
        watch: {
            // API validators and catalog resources are published together by the
            // authored-input watcher, then its ready marker restarts Express/Vite.
            // Do not hydrate against intermediate generator writes; ordinary Vue
            // and stylesheet source edits still use Vite's normal HMR boundary.
            // Test traces and review/coverage reports contain HTML, but they are
            // runtime evidence rather than application inputs. Watching them would
            // replace a live document and discard drafts while a browser test runs.
            ignored: ['**/.generated/**', '**/src/common/localization/generated/**', '**/src/types/**',
                '**/.temp/**', '**/artifacts/**', '**/test-results/**', '**/playwright-report/**', '**/coverage/**', '**/dist/**'],
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
