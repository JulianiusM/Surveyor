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

const entryPoints = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => path.join(srcDir, f));

const importPathRewritePlugin = {
    name: 'rewrite-imports-to-gen',
    setup(build) {
        build.onResolve({filter: /^[./]/}, args => {
            // Skip node_modules and absolute paths
            if (args.path.startsWith('.') || args.path.startsWith('/')) {
                const parsed = path.parse(args.path);

                // Ignore imports that already end in .ts, .js, or .gen.js
                if (parsed.ext) return;

                // Rewrite to *.gen.js
                return {
                    path: `${args.path}.gen.js`,
                    external: true // Treat as external to avoid bundling
                };
            }
        });
    }
};


async function build() {
    const ctx = await esbuild.context({
        entryPoints,
        bundle: false,
        outdir: outDir,
        sourcemap: true,
        target: ['es2020'],
        format: 'esm',
        platform: 'browser',
        globalName: 'Surveyor', // exposes your functions for pug
        logLevel: 'info',
        entryNames: '[name].gen',
        plugins: [importPathRewritePlugin]
    });

    if (enableWatch) {
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

build().catch(() => process.exit(1));
