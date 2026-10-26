import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {initializeFrontendRenderer} from '../../src/modules/frontendRenderer';

/** Prepare installed renderer code and the named lazy route graphs as suite
 * infrastructure. Create no app, document, request, actor, query or private state. */
export async function prepareFrontendSsrModules(names: readonly string[]): Promise<void> {
    // Follow production's entry-before-route readiness through its actual owner.
    // HTTP tests still construct fresh applications and perform their real reads.
    await initializeFrontendRenderer();
    const directory = path.resolve(__dirname, '../../dist/frontend-server');
    const files = await readdir(directory);
    for (const name of names) {
        // Callers name only their exercised graphs. Reject missing/ambiguous
        // builds rather than silently loading an unrelated or stale release file.
        const pattern = new RegExp(`^${name}-[\\w-]+\\.mjs$`, 'u');
        const modules = files.filter(file => pattern.test(file));
        if (modules.length !== 1) throw new Error(`Build exactly one ${name} SSR module before this integration suite.`);
        await import(pathToFileURL(path.join(directory, modules[0]!)).href);
    }
}
