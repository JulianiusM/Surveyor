#!/usr/bin/env node

/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Read-only engineering checks for agents and maintainers. Policy/configuration owns
 * the boundaries; this tool checks syntax evidence without claiming to judge intent,
 * authorization provenance, comment quality or complete business-layer separation.
 * It is deliberately separate from advisory documentation reports and delivery jobs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {parse as parseComponent} from 'vue/compiler-sfc';

/** Accept only explicit read-only modes. Unknown options fail rather than reduce scope. */
function parseOptions(args) {
    const options = {root: process.cwd(), all: false, json: false, files: []};
    // Scope narrows readability ownership only. It cannot suppress declaration
    // or DBAL boundaries, and there is deliberately no ignore-findings option.
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--root' && args[index + 1]) options.root = path.resolve(args[++index]);
        else if (argument === '--file' && args[index + 1]) {
            const file = toPosix(args[++index]);
            if (!file.startsWith('src/') || file.split('/').includes('..')) throw new Error('Review files must stay inside src/');
            options.files.push(file);
        }
        else if (argument === '--all') options.all = true;
        else if (argument === '--json') options.json = true;
        else throw new Error(`Unknown or incomplete option: ${argument}`);
    }
    return options;
}

/** Repository-relative paths are compared uniformly on Windows and Linux. */
function toPosix(value) {
    return value.replaceAll('\\', '/');
}

/** Missing or empty inventories must fail instead of silently disabling a policy rule. */
function validateConfig(config) {
    if (config.schemaVersion !== 1) throw new Error('Unsupported development policy configuration');
    function isSourcePath(value) {
        return typeof value === 'string' && value.startsWith('src/') && !value.includes('\\')
            && value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
    }
    // Missing/empty inventories would turn enforcement into a silent no-op.
    // Reject them before any source is read or a result can be called clean.
    for (const name of ['declarationDirectory', 'databaseServiceDirectory']) {
        if (!isSourcePath(config[name])) throw new Error(`Invalid policy boundary: ${name}`);
    }
    for (const name of ['requestOwnerDirectories', 'requestErrorModules']) {
        if (!Array.isArray(config[name]) || !config[name].length || !config[name].every(isSourcePath)) {
            throw new Error(`Missing or invalid policy inventory: ${name}`);
        }
    }
    const supported = new Set(['.ts', '.mts', '.cts', '.vue']);
    if (!Array.isArray(config.sourceExtensions) || !config.sourceExtensions.length
        || config.sourceExtensions.some(extension => !supported.has(extension))) throw new Error('Invalid source extension inventory');
    if (!Array.isArray(config.manualReview) || !config.manualReview.length
        || config.manualReview.some(criterion => typeof criterion !== 'string' || !criterion.trim())) {
        throw new Error('Missing required human review criteria');
    }
}

/** Read authored source only; generated/ignored output is excluded by Git's inventory. */
function git(root, args) {
    return execFileSync('git', ['-C', root, '-c', 'core.quotepath=false', ...args], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']});
}

/** Inventory fixtures may have no commit; any other Git failure remains a tool error. */
function hasGitHead(root) {
    try {
        git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
        return true;
    } catch (error) {
        if (error.status === 1) return false;
        throw error;
    }
}

/** Collect the working tree including staged and untracked files, without mutations. */
function sourceInventory(root) {
    return [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        .split('\0').filter(Boolean))].map(toPosix).filter(file => file.startsWith('src/'));
}

/**
 * Changed line ranges include the index and worktree against HEAD. New untracked
 * files have no diff hunk, so their whole source is checked. Deletions have no current
 * methods to inspect. No source or Git baseline is rewritten to obtain a clean result.
 */
function changedRanges(root, staged = false) {
    const ranges = new Map();
    const argumentsList = ['diff', '--no-ext-diff', '--unified=0', '--src-prefix=a/', '--dst-prefix=b/'];
    if (staged) argumentsList.push('--cached');
    argumentsList.push('HEAD', '--', 'src');
    const diff = git(root, argumentsList);
    let file;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++ ')) {
            const raw = line.slice(4).trim();
            file = raw === '/dev/null' ? undefined : toPosix(raw.startsWith('"') ? JSON.parse(raw) : raw).slice(2);
        } else if (file) {
            const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
            if (!hunk) continue;
            const start = Number(hunk[1]);
            const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
            if (!ranges.has(file)) ranges.set(file, []);
            // A removed comment/statement still touches its surviving operation.
            // Zero added lines must not make a documentation deletion invisible.
            ranges.get(file).push({start: Math.max(1, start), end: Math.max(1, start + Math.max(1, count) - 1)});
        }
    }
    if (!staged) {
        const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', 'src']).split('\0').filter(Boolean);
        for (const file of untracked) ranges.set(toPosix(file), [{start: 1, end: Infinity}]);
    }
    return ranges;
}

/** Validate configured paths before reading; symlinks cannot extend the source scope. */
function readSource(root, relative) {
    const absolute = path.resolve(root, relative);
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(absolute);
    if (!realFile.startsWith(realRoot + path.sep)) throw new Error(`Source escapes repository: ${relative}`);
    return fs.readFileSync(realFile, 'utf8');
}

/** Report locations, not complete source text or potentially private runtime values. */
function finding(file, source, node, lineOffset, rule, message) {
    return {file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 + lineOffset, rule, message};
}

/**
 * DBAL cannot import request-owned modules or contextual errors, including aliases,
 * namespace imports, re-exports, type imports and literal require/import calls.
 * Type-only DBAL contracts belong in src/types; aliases do not hide the module owner.
 */
function checkServiceDependency(root, file, source, node, specifier, config, errors) {
    if (!specifier.startsWith('.')) return;
    const resolved = toPosix(path.relative(root, path.resolve(root, path.dirname(file), specifier)));
    const module = (resolved.endsWith('.js') ? resolved.slice(0, -3) + '.ts' : resolved).toLowerCase();
    const requestOwner = config.requestOwnerDirectories.some(directory => module === directory || module.startsWith(directory + '/'));
    const requestError = config.requestErrorModules.some(owner => module === owner || module + '.ts' === owner);
    if (requestOwner || requestError) errors.push(finding(file, source, node, 0, 'pure-dbal',
        `Database service imports request-owned module ${specifier}; use a declaration contract or controller callback.`));
}

/** Inspect dependency syntax without evaluating or importing application code. */
function checkService(root, file, source, config, errors) {
    // Inspect the import node's module, not the local identifier: named aliases,
    // namespaces and import-equals bindings all retain the same request owner.
    function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            checkServiceDependency(root, file, source, node, node.moduleSpecifier.text, config, errors);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            checkServiceDependency(root, file, source, node, node.argument.literal.text, config, errors);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
            && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
            checkServiceDependency(root, file, source, node, node.moduleReference.expression.text, config, errors);
        } else if (ts.isCallExpression(node) && node.arguments.length
            && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
            && ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
            checkServiceDependency(root, file, source, node, node.arguments[0].text, config, errors);
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
}

/** Only executable functions have bodies; function types are not anonymous operations. */
function isOperation(node) {
    return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
        || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body !== undefined;
}

/** Assigned callbacks retain descriptive names; ordinary expression selectors stay simple. */
function operationName(node, source) {
    if (node.name) return node.name.getText(source);
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)
        || ts.isPropertyDeclaration(node.parent)) return node.parent.name.getText(source);
    return null;
}

/**
 * This is a coverage heuristic for the existing nontrivial-code comment requirement,
 * not a complexity score or a new formatting limit. Control-flow blocks, iteration,
 * exception handling and nested operations need an explicit maintainer explanation.
 * Nested functions are reviewed separately instead of inflating their parent's flow.
 */
function isNontrivial(node) {
    if (!ts.isBlock(node.body)) return false;
    let nontrivial = false;
    function visit(child) {
        // Nested operations get their own coverage; their body must not be
        // mistaken for an otherwise simple enclosing operation's control flow.
        if (isOperation(child)) {
            nontrivial = true;
            return;
        }
        if (ts.isTryStatement(child) || ts.isSwitchStatement(child) || ts.isForStatement(child)
            || ts.isForOfStatement(child) || ts.isForInStatement(child) || ts.isWhileStatement(child)
            || ts.isDoStatement(child) || (ts.isIfStatement(child)
                && (ts.isBlock(child.thenStatement) || (child.elseStatement && ts.isBlock(child.elseStatement))))) {
            nontrivial = true;
        }
        ts.forEachChild(child, visit);
    }
    ts.forEachChild(node.body, visit);
    return nontrivial;
}

/** Recognize actual comments, not comment-like text inside a string or template. */
function hasBodyComment(body, source) {
    let commented = false;
    const start = body.getStart(source);
    function visit(node) {
        // Parser-owned token boundaries correctly handle template substitutions.
        // A context-free scanner could mistake template text for a code comment.
        const comments = [...ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [],
            ...ts.getTrailingCommentRanges(source.text, node.end) ?? []];
        for (const comment of comments) {
            if (comment.pos >= start && comment.end <= body.end) commented = true;
        }
        // Include parser-owned punctuation boundaries: a comment immediately
        // after an opening brace is trailing trivia on that token, not a statement.
        for (const child of node.getChildren(source)) visit(child);
    }
    visit(body);
    return commented;
}

/** Function contracts may sit on a declaration or its owning named variable/property. */
function hasContractComment(node, source) {
    const owner = contractOwner(node);
    return (ts.getLeadingCommentRanges(source.text, owner.getFullStart()) ?? []).length > 0;
}

/** A named arrow's contract belongs to its variable/property, before the arrow itself. */
function contractOwner(node) {
    if (ts.isVariableDeclaration(node.parent)) return node.parent.parent.parent;
    if (ts.isPropertyAssignment(node.parent) || ts.isPropertyDeclaration(node.parent)) return node.parent;
    return node;
}

/** A touched operation includes its leading contract, so comment edits get reviewed too. */
function isTouched(node, source, lineOffset, ranges) {
    const start = source.getLineAndCharacterOfPosition(contractOwner(node).getFullStart()).line + 1 + lineOffset;
    const end = source.getLineAndCharacterOfPosition(node.end).line + 1 + lineOffset;
    return ranges.some(range => range.start <= end && range.end >= start);
}

/** Check nontrivial touched methods while preserving established short callback patterns. */
function checkOperations(file, source, lineOffset, ranges, errors) {
    let reviewedOperations = 0;
    // Presence is the measurable minimum. The separately printed human criteria
    // still require accurate contracts and purposeful internal step explanations.
    function visit(node) {
        if (isOperation(node) && isTouched(node, source, lineOffset, ranges) && isNontrivial(node)) {
            reviewedOperations += 1;
            const name = operationName(node, source);
            if (!hasContractComment(node, source) && !hasBodyComment(node.body, source)) {
                errors.push(finding(file, source, node, lineOffset, 'nontrivial-comments',
                    `${name ?? 'Inline operation'} has nontrivial flow without an explanatory contract or in-code comment.`));
            }
            // A complex anonymous operation inside another anonymous operation is
            // precisely the nested maintainability risk; named helpers remain allowed.
            let ancestor = node.parent;
            while (ancestor && !isOperation(ancestor)) ancestor = ancestor.parent;
            if (!name && ancestor && !operationName(ancestor, source)) errors.push(finding(file, source, node, lineOffset,
                'nested-anonymous-operation', 'Name the nested nontrivial operation and explain its responsibility.'));
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return reviewedOperations;
}

/** Parse Vue through its public compiler; both script blocks retain original line numbers. */
function sourceBlocks(file, text) {
    if (!file.endsWith('.vue')) return [{text, lineOffset: 0}];
    const parsed = parseComponent(text, {filename: file});
    if (parsed.errors.length) throw new Error(`Cannot parse Vue component: ${file}`);
    // Preserve the source offsets for diagnostics in either Vue script owner;
    // template/style content is outside this engineering parser's claims.
    const blocks = [];
    for (const block of [parsed.descriptor.script, parsed.descriptor.scriptSetup]) {
        if (!block) continue;
        if (block.src) throw new Error(`External Vue script requires an explicit source review: ${file}`);
        blocks.push({text: block.content, lineOffset: block.loc.start.line - 1});
    }
    return blocks;
}

/**
 * Inspect separately changed index contents. A staged violation must remain visible
 * when a later worktree edit restores HEAD. Unchanged legacy index sources are not
 * another task delta; the complete working-source boundary inventory is checked above.
 */
function checkStagedSources(options, config, errors) {
    const changed = changedRanges(options.root, true);
    const indexed = new Set(git(options.root, ['ls-files', '-z', '--cached', '--', 'src']).split('\0').filter(Boolean).map(toPosix));
    let checked = 0;
    let reviewedOperations = 0;
    const startingError = errors.length;
    for (const [file, ranges] of changed) {
        if (!indexed.has(file)) continue;
        if (file.startsWith(config.declarationDirectory + '/') && !file.endsWith('.d.ts')) {
            errors.push({file, line: 1, rule: 'declaration-files', message: 'Shared files under src/types must use .d.ts.'});
        }
        if (!config.sourceExtensions.includes(path.extname(file)) || file.endsWith('.d.ts')) continue;
        checked += 1;
        // Git reads this blob without checkout, reset, staging or source execution.
        const text = git(options.root, ['show', ':' + file]);
        for (const block of sourceBlocks(file, text)) {
            const source = ts.createSourceFile(file + '.ts', block.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            if (source.parseDiagnostics.length) throw new Error(`Cannot parse staged source: ${file}`);
            if (file.startsWith(config.databaseServiceDirectory + '/')) checkService(options.root, file, source, config, errors);
            if (!options.files.length || options.files.includes(file)) {
                reviewedOperations += checkOperations(file, source, block.lineOffset, ranges, errors);
            }
        }
    }
    for (let index = startingError; index < errors.length; index += 1) errors[index].snapshot = 'index';
    return {checkedSources: checked, reviewedOperations};
}

/**
 * Declaration/DBAL boundaries apply to the entire authored inventory. Readability
 * checks apply to touched operations, avoiding an unrelated legacy formatting sweep.
 */
function buildReport(options) {
    const config = JSON.parse(readSource(options.root, 'docs/policies/development-check.json'));
    validateConfig(config);
    const errors = [];
    const files = sourceInventory(options.root);
    for (const file of options.files) {
        if (!files.includes(file) || !fs.existsSync(path.join(options.root, file))
            || !config.sourceExtensions.includes(path.extname(file)) || file.endsWith('.d.ts')) {
            throw new Error(`Readability scope is not an authored executable source: ${file}`);
        }
    }
    const ranges = options.all ? null : changedRanges(options.root);
    let checkedSources = 0;
    let checkedServiceSources = 0;
    let reviewedOperations = 0;
    const readabilityFiles = [];
    for (const file of files) {
        if (!fs.existsSync(path.join(options.root, file))) continue;
        if (file.startsWith(config.declarationDirectory + '/') && !file.endsWith('.d.ts')) {
            errors.push({file, line: 1, rule: 'declaration-files', message: 'Shared files under src/types must use .d.ts.'});
        }
        if (!config.sourceExtensions.includes(path.extname(file)) || file.endsWith('.d.ts')) continue;
        const service = file.startsWith(config.databaseServiceDirectory + '/');
        const touched = options.all ? [{start: 1, end: Infinity}] : ranges.get(file) ?? [];
        const review = touched.length && (!options.files.length || options.files.includes(file));
        if (!service && !touched.length) continue;
        checkedSources += 1;
        if (service) checkedServiceSources += 1;
        if (review) readabilityFiles.push(file);
        for (const block of sourceBlocks(file, readSource(options.root, file))) {
            const source = ts.createSourceFile(file + '.ts', block.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            if (source.parseDiagnostics.length) throw new Error(`Cannot parse source: ${file}`);
            if (service) checkService(options.root, file, source, config, errors);
            if (review) reviewedOperations += checkOperations(file, source, block.lineOffset, touched, errors);
        }
    }
    // A fixture with no initial commit can use --all for its untracked sources.
    // Normal agent checks require HEAD and also certify the separately staged delta.
    const staged = !hasGitHead(options.root) ? {checkedSources: 0, reviewedOperations: 0, inspected: false}
        : {...checkStagedSources(options, config, errors), inspected: true};
    return {checkedSources, checkedServiceSources, reviewedOperations, readabilityFiles, staged,
        readabilityScope: options.files.length ? options.files : options.all ? 'all authored sources' : 'working tree changes against HEAD',
        errors, manualReview: config.manualReview};
}

/** Fail on observable violations or unavailable prerequisites, without hiding failures. */
function main() {
    try {
        const options = parseOptions(process.argv.slice(2));
        const report = buildReport(options);
        if (options.json) console.log(JSON.stringify(report, null, 2));
        else {
            console.log(`Development policy: ${report.checkedSources} source files checked; ${report.errors.length} findings.`);
            console.log(`DBAL inventory: ${report.checkedServiceSources} files; readability: ${report.readabilityFiles.length} files, `
                + `${report.reviewedOperations} nontrivial operations. Scope: ${JSON.stringify(report.readabilityScope)}`);
            console.log(`Separate staged delta: ${report.staged.inspected ? report.staged.checkedSources + ' source files checked' : 'no HEAD baseline in this inventory fixture'}.`);
            for (const error of report.errors) {
                const snapshot = error.snapshot === 'index' ? ' [index]' : ' [worktree]';
                console.log(`${error.file}:${error.line}${snapshot} [${error.rule}] ${error.message}`);
            }
            console.log('\nRequired human review (a clean syntax report does not certify these):');
            for (const criterion of report.manualReview) console.log(`- ${criterion}`);
        }
        process.exitCode = report.errors.length ? 1 : 0;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 2;
    }
}

main();
