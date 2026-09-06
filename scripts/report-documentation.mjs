#!/usr/bin/env node

/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Maintainer-only documentation reports. Never propagate a finding, unavailable
 * tool, timeout, or child-process failure into an application delivery gate.
 * The report preserves findings and child exit statuses instead of labelling
 * incomplete or failed checks as passing.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseOptions(args) {
    const options = {mode: 'default', output: path.join(root, 'artifacts', 'documentation')};
    const modes = new Map([
        ['--strict', 'strict'], ['--help-only', 'help'], ['--tool-tests', 'tooling'],
        ['--content', 'content'], ['--browser', 'browser'],
    ]);
    for (let index = 0; index < args.length; index += 1) {
        if (modes.has(args[index]) && options.mode === 'default') {
            options.mode = modes.get(args[index]);
        } else if (args[index] === '--output-dir' && args[index + 1]) {
            options.output = path.resolve(root, args[++index]);
        } else {
            throw new Error(`Unknown or conflicting documentation report argument: ${args[index]}`);
        }
    }
    return options;
}

function specifications(mode) {
    if (mode === 'tooling') {
        return [{name: 'tooling-tests', args: ['--test',
            'scripts/tests/documentation-check.test.mjs', 'scripts/tests/documentation-advisory.test.mjs']}];
    }
    if (mode === 'content') {
        return [{name: 'content-tests', args: ['node_modules/vitest/vitest.mjs', 'run',
            '--config', 'tests/documentation/vitest.config.mts']}];
    }
    if (mode === 'browser') {
        return [{name: 'browser-tests', args: ['node_modules/@playwright/test/cli.js', 'test',
            '--config', 'tests/documentation/playwright.config.ts']}];
    }
    const specs = [];
    if (mode !== 'help') {
        specs.push({name: 'structure', jsonFile: true,
            args: ['scripts/check-documentation.mjs', ...(mode === 'strict' ? ['--strict'] : [])]});
    }
    specs.push({name: 'help-authoring', jsonStdout: true, args: ['scripts/check-help-documentation.mjs']});
    return specs;
}

function runCheck(spec, options) {
    const stem = `${options.mode}-${spec.name}`;
    const jsonPath = path.join(options.output, `${stem}.json`);
    const args = [...spec.args, ...(spec.jsonFile ? ['--json', jsonPath] : [])];
    // Never mistake the output of a previous invocation for a crashed check.
    if (spec.jsonFile && fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    const result = spawnSync(process.execPath, args, {
        cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
    });
    const log = [result.stdout ?? '', result.stderr ?? '', result.error?.message ?? ''].join('\n');
    fs.writeFileSync(path.join(options.output, `${stem}.log`), log);
    process.stdout.write(`\n--- ${spec.name} (advisory) ---\n${log}\n`);
    let diagnostic = null;
    let reportError = null;
    if (spec.jsonFile || spec.jsonStdout) {
        try {
            diagnostic = JSON.parse(spec.jsonFile ? fs.readFileSync(jsonPath, 'utf8') : result.stdout);
            if (!diagnostic || !Array.isArray(diagnostic.errors)
                || (spec.jsonFile && !Number.isInteger(diagnostic.summary?.totalErrors))
                || (spec.jsonStdout && typeof diagnostic.ok !== 'boolean')) {
                throw new Error('Diagnostic output does not match the expected report structure');
            }
            if (spec.jsonStdout) fs.writeFileSync(jsonPath, JSON.stringify(diagnostic, null, 2) + '\n');
        } catch (error) {
            reportError = error.message;
        }
    }
    const errors = diagnostic?.errors ?? [];
    const findingCount = diagnostic?.summary?.totalErrors ?? errors.length;
    const missingRunner = args[0] !== '--test' && !fs.existsSync(path.resolve(root, args[0]));
    const couldNotRun = Boolean(result.error || result.signal || reportError || missingRunner);
    const status = couldNotRun ? 'tool-error'
        : result.status !== 0 ? (diagnostic ? 'tool-error' : 'failed')
        : findingCount > 0 || diagnostic?.ok === false ? 'findings' : 'clean';
    return {
        name: spec.name, command: ['node', ...args], status,
        childExitCode: result.status, signal: result.signal, findingCount,
        errors, toolingError: result.error?.message ?? reportError ?? (missingRunner ? `Local runner is unavailable: ${args[0]}` : null),
        log: `${stem}.log`,
    };
}

function main() {
    const options = parseOptions(process.argv.slice(2));
    fs.mkdirSync(options.output, {recursive: true});
    const checks = specifications(options.mode).map(spec => runCheck(spec, options));
    const report = {
        advisory: true, mode: options.mode,
        reviewNeeded: checks.some(check => check.status !== 'clean'),
        checks,
    };
    fs.writeFileSync(path.join(options.output, `summary-${options.mode}.json`), JSON.stringify(report, null, 2) + '\n');
    const summary = [
        '# Documentation report — advisory only', '',
        'These results never block CI, builds, merges, releases, or deployment.', '',
        '| Check | Result | Child exit | Findings |', '|---|---|---:|---:|',
        ...checks.map(check => `| ${check.name} | ${check.status} | ${check.childExitCode ?? 'unavailable'} | ${check.findingCount} |`),
        '', 'Read the per-check logs and JSON for findings or execution errors. Exit 0 does not mean the documentation is correct.', '',
    ].join('\n');
    fs.writeFileSync(path.join(options.output, `summary-${options.mode}.md`), summary);
    console.log(`\n${summary}\nReports: ${options.output}`);
}

try {
    main();
} catch (error) {
    console.error(`Documentation reporting could not complete (advisory): ${error.message}`);
} finally {
    // Also covers configuration/IO failures and broken diagnostic scripts.
    process.exitCode = 0;
}
