import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {components} from '../../types/api/v1';
import {apiContract} from './contracts';

/** Change this family only for incompatible wire semantics, independently of asset fingerprints. */
export const apiCompatibility = apiContract.apiCompatibility;

let installed: components['schemas']['DeploymentView'] | undefined;
export function deploymentView(): components['schemas']['DeploymentView'] {
    if (installed) return installed;
    if (process.env.SURVEYOR_FRONTEND_DEV === '1' && process.env.NODE_ENV !== 'production') {
        return {buildId: 'development', apiCompatibility};
    }
    const packaged = path.resolve(__dirname, '../../public/app/.vite/manifest.json');
    const manifest = fs.existsSync(packaged) ? packaged : path.resolve(__dirname, '../../../dist/public/app/.vite/manifest.json');
    // Only the installed release is read. No old asset directory or operator-managed retention is needed.
    installed = {buildId: createHash('sha256').update(fs.readFileSync(manifest)).digest('hex').slice(0, 24), apiCompatibility};
    return installed;
}

/** Validate a supplied compatibility family; callers decide whether the header is required. */
export function compatibleApiClient(value: string | undefined): boolean {
    return value === undefined || value === apiCompatibility;
}
