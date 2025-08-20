import fs from 'fs';
import path from 'path';

const domainsDir = path.join(__dirname, 'domains');

// Type for any dynamically loaded module
type ModuleExports = Record<string, (...args: any[]) => any>;

// All loaded modules, keyed by filename (without .ts/.js)
const modules: Record<string, ModuleExports> = fs
    .readdirSync(domainsDir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .filter((f) => f !== 'db.ts' && f !== 'db.js')
    .reduce((acc, file) => {
        const name = path.basename(file, path.extname(file));
        acc[name] = require(path.join(domainsDir, file)) as ModuleExports;
        return acc;
    }, {} as Record<string, ModuleExports>);

// The dynamic proxy
const db = new Proxy({}, {
    get(_, fnName: string) {
        // Direct match
        for (const mod of Object.values(modules)) {
            if (fnName in mod) return mod[fnName];
        }

        // Nested match: "users.registerUser"
        const [domain, method] = fnName.split('.');
        if (modules[domain] && method in modules[domain]) {
            return modules[domain][method];
        }

        // Not found
        throw new Error(`Method '${fnName}' not found in any DB domain module.`);
    }
}) as Record<string, (...args: any[]) => any>;

export default db;
