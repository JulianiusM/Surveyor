import {rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, relative, resolve} from 'node:path';

/** Remove only this checkout's generated build tree before assembling a release.
 * A full rebuild must not ship stale routes, views or browser assets retired from source. */
async function cleanBuild() {
    // Derive the fixed output from this script, never the caller's working directory or input.
    const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const output = resolve(repository, 'dist');
    if (relative(repository, output) !== 'dist') throw new Error('Build output must be the repository dist directory.');

    // Partial build commands retain their distinct outputs; only the full build invokes this cleanup.
    await rm(output, {recursive: true, force: true});
}

await cleanBuild();
