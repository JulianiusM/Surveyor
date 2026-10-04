// esbuild.client.js
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isProd = process.env.NODE_ENV === 'production';
const enableWatch = process.argv.includes('--watch');

const srcDir = path.resolve(__dirname, 'src/public/js');
const outDir = isProd
    ? path.resolve(__dirname, 'dist/public/js')
    : path.resolve(__dirname, 'src/public/js');

function getTsFiles(dir) {
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return getTsFiles(fullPath); // recurse
        }
        return entry.isFile() && fullPath.endsWith(".ts") ? [fullPath] : [];
    });
}

// Emit the shared invoice presentation and coverage owners as ordinary browser modules. Keeping their source
// under the invoice feature folder avoids copied catalogs or forbidden forwarding modules.
// This explicit list includes pure shared policies and presentation only; DBAL-backed operations stay server-side.
const invoiceDir = path.resolve(__dirname, 'src/modules/invoice');
const sharedInvoiceEntries = {
    'shared/invoice/wording': path.join(invoiceDir, 'wording.ts'),
    'shared/invoice/presentation': path.join(invoiceDir, 'presentation.ts'),
    'shared/invoice/coverage': path.join(invoiceDir, 'coverage.ts'),
};
for (const filename of getTsFiles(path.join(invoiceDir, 'locales'))) {
    const relativeName = path.relative(invoiceDir, filename).replace(/\\/g, '/').slice(0, -3);
    sharedInvoiceEntries[`shared/invoice/${relativeName}`] = filename;
}

// Explicit output names preserve the established *.gen.js paths for all existing browser entries.
const entryPoints = {...sharedInvoiceEntries};
for (const filename of getTsFiles(srcDir)) {
    const relativeName = path.relative(srcDir, filename).replace(/\\/g, '/').slice(0, -3);
    entryPoints[relativeName] = filename;
}

const sharedInvoicePaths = new Map();
for (const [outputName, filename] of Object.entries(sharedInvoiceEntries)) {
    sharedInvoicePaths.set(filename.slice(0, -3), `/js/${outputName}.gen.js`);
}

const importPathRewritePlugin = {
    name: 'rewrite-imports-to-gen',
    /** Resolve shared pure owners to emitted assets while retaining existing independent browser modules. */
    setup(build) {
        build.onResolve({filter: /^[./]/}, args => {
            // Skip node_modules and absolute paths
            if (args.path.startsWith('.') || args.path.startsWith('/')) {
                const parsed = path.parse(args.path);

                // Ignore imports that already end in .ts, .js, or .gen.js
                if (parsed.ext) return;

                // Source imports may cross out of public/js only for the explicitly emitted invoice owners.
                // Resolve by source identity so both client entries and the owners' own imports share one asset.
                const sharedPath = sharedInvoicePaths.get(path.resolve(args.resolveDir, args.path));
                if (sharedPath) return {path: sharedPath, external: true};

                // Rewrite to *.gen.js
                return {
                    path: `${args.path}.gen.js`,
                    external: true // Treat as external to avoid bundling
                };
            }
        });
    }
};


/** Build the established browser module graph once, or retain its context for development watch mode. */
async function build() {
    // Each entry is emitted independently; shared owners use stable URLs instead of duplicated bundled catalogs.
    const ctx = await esbuild.context({
        entryPoints,
        bundle: true,
        outdir: outDir,
        sourcemap: true,
        outbase: srcDir,                 // <-- preserve folder structure
        entryNames: '[dir]/[name].gen',  // <-- keep subdirs in output
        target: ['es2020'],
        format: 'esm',
        platform: 'browser',
        globalName: 'Surveyor', // exposes your functions for pug
        logLevel: 'info',
        plugins: [importPathRewritePlugin],
        metafile: true,        // (optional) inspect what’s emitted
    });

    // Watch and one-shot builds use the same entry graph and import rewrites.
    if (enableWatch) {
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

build().catch(() => process.exit(1));
