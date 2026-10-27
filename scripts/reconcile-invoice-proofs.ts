/* Copyright 2026 Julian Malovanij. Licensed under the Apache License, Version 2.0. */
import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import settings from '../src/backend/modules/settings';
import {AppDataSource, initDataSource} from '../src/backend/modules/database/dataSource';
import {createInvoiceProofManifest, invoiceProofDatabaseTarget, reconcileInvoiceProofs} from '../src/backend/modules/invoice/proofs';
import type {InvoiceProofReconciliationAction} from '../src/types/InvoiceProofTypes';
import {invoiceProofReconciliationActions} from '../src/backend/modules/invoice/requests';

const usage = 'Use --offline --expected-database NAME --mode inventory --recovery-days DAYS --output FILE, '
    + 'or --offline --expected-database NAME --mode quarantine|restore|purge --manifest FILE. Stop the application first.';

/** Parse only explicit operator inputs. Duplicate/unknown flags cannot widen a selected manifest. */
function options(arguments_: string[]): Map<string, string> {
    const result = new Map<string, string>();
    const values = new Set(['--expected-database', '--mode', '--recovery-days', '--output', '--manifest']);
    for (let index = 0; index < arguments_.length; index++) {
        const name = arguments_[index];
        if (result.has(name)) throw new Error(`Repeated option: ${name}`);
        if (name === '--offline') result.set(name, 'true');
        else if (values.has(name) && arguments_[index + 1] && !arguments_[index + 1].startsWith('--')) result.set(name, arguments_[++index]);
        else throw new Error(usage);
    }
    return result;
}

/** Run one settings-aware offline workflow, without loading the HTTP app or its jobs.
 * The manifest owns the exact file selection; this entry point owns explicit target admission. */
async function main(): Promise<void> {
    const arguments_ = process.argv.slice(2);
    if (arguments_.length === 1 && arguments_[0] === '--help') { process.stdout.write(usage + '\n'); return; }
    const selected = options(arguments_);
    const mode = selected.get('--mode');
    const modes: readonly string[] = ['inventory', ...invoiceProofReconciliationActions];
    if (!selected.has('--offline') || !selected.get('--expected-database') || !modes.includes(mode ?? '')) throw new Error(usage);

    // Load the same effective configuration used by the application. Neither a
    // schema name containing "test" nor a filename alone proves the intended target.
    await settings.read();
    if (settings.value.dbName !== selected.get('--expected-database')) throw new Error('Effective database does not match the explicit maintenance target');
    if (mode === 'inventory') {
        if (!selected.has('--output') || !selected.has('--recovery-days') || selected.has('--manifest')) throw new Error(usage);
    } else if (!selected.has('--manifest') || selected.has('--output') || selected.has('--recovery-days')) throw new Error(usage);
    process.stdout.write(`Offline proof maintenance target: ${invoiceProofDatabaseTarget()}\n`);
    await initDataSource();
    try {
        if (mode === 'inventory') {
            // Refuse overwrite: an earlier reviewed manifest remains immutable evidence.
            const manifest = await createInvoiceProofManifest(Number(selected.get('--recovery-days')));
            await fs.writeFile(path.resolve(selected.get('--output')!), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
            process.stdout.write(`Inventory ${manifest.id}: ${manifest.files.length} candidates, ${manifest.ignored.length} entries requiring inspection.\n`);
        } else {
            const manifest: unknown = JSON.parse(await fs.readFile(path.resolve(selected.get('--manifest')!), 'utf8'));
            const result = await reconcileInvoiceProofs(manifest, mode as InvoiceProofReconciliationAction);
            process.stdout.write(`${mode}: ${result.processed} processed, ${result.skipped} already completed.\n`);
        }
    } finally {
        // Close only the connection created by this maintenance process; never
        // leave a pool running after failure or interpret partial work as rollback.
        if (AppDataSource?.isInitialized) await AppDataSource.destroy();
    }
}

void main().catch(function reportFailure(error: unknown) {
    console.error(error instanceof Error ? error.message : 'Proof reconciliation failed');
    console.error('Completed entries remain durable. Resume only the same selected manifest after resolving this failure.');
    process.exitCode = 1;
});
