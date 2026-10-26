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
    const options = {root: process.cwd(), all: false, json: false, files: [], approvalRequest: undefined};
    // Scope narrows readability ownership only. It cannot suppress declaration
    // DBAL or session-ownership boundaries, and there is no ignore-findings option.
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
        else if (argument === '--approval-request' && args[index + 1] && !options.approvalRequest) {
            options.approvalRequest = path.resolve(args[++index]);
        }
        else throw new Error(`Unknown or incomplete option: ${argument}`);
    }
    if (options.approvalRequest && (options.all || options.files.length)) throw new Error('Approval preflight is separate from source review');
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
    const owner = config.sessionStagingOwner;
    if (!owner || Object.keys(owner).sort().join(',') !== 'file,operation' || !isSourcePath(owner.file)
        || !owner.file.endsWith('.ts') || !/^[A-Za-z_$][\w$]*$/u.test(owner.operation)) {
        throw new Error('Invalid exact session staging owner');
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

/** Property names are syntax evidence only; computed runtime names remain a human-review boundary. */
function propertyName(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && node.argumentExpression
        && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
    if (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
        if (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) return node.name.text;
        if (ts.isComputedPropertyName(node.name) && ts.isStringLiteralLike(node.name.expression)) return node.name.expression.text;
    }
    return undefined;
}

/** Recognize the explicit Express session contract without confusing the database Session entity with it. */
function isSessionType(node, sessionImports) {
    if (!node) return false;
    if (ts.isIndexedAccessTypeNode(node) && ts.isLiteralTypeNode(node.indexType)
        && ts.isStringLiteral(node.indexType.literal) && node.indexType.literal.text === 'session'
        && ts.isTypeReferenceNode(node.objectType)) {
        return node.objectType.typeName.getText().split('.').at(-1) === 'Request';
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) return sessionImports.has(node.typeName.text);
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) return node.types.some(type => isSessionType(type, sessionImports));
    if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) return isSessionType(node.type, sessionImports);
    return false;
}

/** Collect obvious typed/assigned Session aliases, without claiming interprocedural or arbitrary alias analysis. */
function sessionBindings(source) {
    const imports = new Set();
    const bindings = new Set();
    const factories = new Set();
    const declarations = [];
    /** Inventory explicit imports and local declaration nodes before following their aliases. */
    function collect(node) {
        // An application entity named Session is unrelated to the Express class.
        // Only the explicit package import supplies an additional Session type name.
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
            && node.moduleSpecifier.text === 'express-session' && node.importClause?.namedBindings
            && ts.isNamedImports(node.importClause.namedBindings)) {
            for (const element of node.importClause.namedBindings.elements) {
                if (['Session', 'SessionData'].includes(element.propertyName?.text ?? element.name.text)) imports.add(element.name.text);
            }
        }
        if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) declarations.push(node);
        if (ts.isFunctionDeclaration(node) && node.name) declarations.push(node);
        ts.forEachChild(node, collect);
    }
    collect(source);
    // Typed parameters and helper results seed the finite local alias inventory.
    for (const node of declarations) {
        if (!isSessionType(node.type, imports)) continue;
        if (ts.isFunctionDeclaration(node)) factories.add(node.name.text);
        else bindings.add(node.name.text);
    }
    /** Follow local aliases until the finite set stops growing; no source is executed. */
    function isSession(node) {
        if (!node) return false;
        if (ts.isIdentifier(node)) return bindings.has(node.text);
        if (propertyName(node) === 'session') return true;
        if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return isSessionType(node.type, imports) || isSession(node.expression);
        if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return isSession(node.expression);
        return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && factories.has(node.expression.text);
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of declarations) {
            if (!ts.isVariableDeclaration(node) || bindings.has(node.name.text) || !isSession(node.initializer)) continue;
            bindings.add(node.name.text);
            changed = true;
        }
    }
    return {imports, isSession};
}

/** Only the named existing top-level identity staging operation owns isolated construction/save deferral. */
function isSessionStagingOwner(file, node, config) {
    if (file !== config.sessionStagingOwner.file) return false;
    // A similarly named nested helper or another file cannot inherit the exception.
    for (let owner = node.parent; owner; owner = owner.parent) {
        if (ts.isFunctionDeclaration(owner) && owner.name?.text === config.sessionStagingOwner.operation
            && ts.isSourceFile(owner.parent)) return true;
    }
    return false;
}

/** A mutable Session on another Express request member introduces a second request lifecycle. */
function isExpressRequestMember(node) {
    if (!ts.isPropertySignature(node) || !ts.isInterfaceDeclaration(node.parent) || node.parent.name.text !== 'Request') return false;
    // Limit declaration evidence to the established Express augmentation namespaces.
    for (let owner = node.parent.parent; owner; owner = owner.parent) {
        if (ts.isModuleDeclaration(owner) && ['express', 'express-serve-static-core', 'Express'].includes(owner.name.text)) return true;
    }
    return false;
}

/** Recognize a literal save descriptor without treating unrelated model properties as Session hooks. */
function hasSaveProperty(node) {
    if (!ts.isObjectLiteralExpression(node)) return false;
    // Literal descriptors are inspectable without executing computed property names.
    for (const property of node.properties) {
        if (propertyName(property) === 'save') return true;
    }
    return false;
}

/**
 * Check recognizable session ownership globally, including separately changed index blobs.
 * The exact existing transaction exception records ownership, never approval for new callers.
 * Ordinary saves, immutable actors and unrelated model methods remain outside this rule.
 */
function checkSessionOwnership(file, source, lineOffset, config, errors) {
    const bindings = sessionBindings(source);
    /** Inspect construction/interception syntax separately from ordinary Session method calls. */
    function visit(node) {
        // Declaration ownership is global, even if no executable line was edited.
        if (isExpressRequestMember(node) && propertyName(node) !== 'session' && isSessionType(node.type, bindings.imports)) {
            errors.push(finding(file, source, node, lineOffset, 'request-session-owner',
                'Keep one middleware-managed request Session; an extra writable Session requires an explicit ownership decision.'));
        }
        if (!isSessionStagingOwner(file, node, config)) {
            let construction = false;
            let saveOverride = false;
            if (ts.isCallExpression(node)) {
                // This conservative name match requires human receiver-type review.
                construction = propertyName(node.expression) === 'createSession';
                const method = propertyName(node.expression);
                const receiver = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)
                    ? node.expression.expression : undefined;
                if (receiver && ts.isIdentifier(receiver) && ['Object', 'Reflect'].includes(receiver.text)
                    && bindings.isSession(node.arguments[0])) {
                    // Descriptor replacement and direct assignment share the same save-lifecycle risk.
                    if (method === 'defineProperty') saveOverride = Boolean(node.arguments[1]
                        && ts.isStringLiteralLike(node.arguments[1]) && node.arguments[1].text === 'save');
                    else if (['defineProperties', 'assign'].includes(method)) {
                        saveOverride = node.arguments.slice(1).some(hasSaveProperty);
                    }
                }
            } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
                && propertyName(node.left) === 'save') {
                saveOverride = bindings.isSession(node.left.expression);
            }
            if (construction || saveOverride) errors.push(finding(file, source, node, lineOffset, 'session-lifecycle-owner',
                'Session construction/save interception belongs only to the exact approved identity staging operation; review changed ownership before implementation.'));
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
}

/** Read the six labels from their authoritative policy instead of maintaining a second wording inventory. */
function approvalLabels(root) {
    const policy = readSource(root, 'docs/policies/DEVELOPMENT_POLICY.md');
    const section = policy.slice(policy.indexOf('### Required change explanation'), policy.indexOf('## Implementation principles'));
    const labels = [...section.matchAll(/^- \*\*([^*\r\n]+):\*\*/gmu)].map(match => match[1]);
    if (labels.length !== 6 || labels[0] !== 'Reason' || labels.at(-1) !== 'History') {
        throw new Error('Cannot identify the six authoritative approval labels');
    }
    return labels;
}

/** Literal policy labels and request identifiers cannot become regular-expression instructions. */
function escapePattern(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Recognize ordinary bold/plain Markdown request headings without judging their substantive decision. */
function approvalHeading(lines, reasonLine) {
    // Use only the preceding visible heading, never an identifier borrowed from another question.
    for (let line = reasonLine - 1; line >= 0; line -= 1) {
        if (!lines[line].trim()) continue;
        const heading = /^\s*(?:#{1,6}\s+)?(?:\*\*)?([A-Za-z][A-Za-z0-9_-]{0,31})(?:(?:\*\*)?\s*[—–:-]\s+|(?:\*\*)?\s*$)/u.exec(lines[line]);
        return heading ? {id: heading[1], line} : undefined;
    }
    return undefined;
}

/**
 * Preflight only the observable format of proposed conversation text. No application source is
 * loaded, no receipt is written, and syntax never establishes informed approval.
 * Independent and root reviewers still inspect the exact explanation and decision.
 */
function checkApprovalRequest(options) {
    // The policy owns field wording; the supplied text is read without storing
    // it, inspecting application sources or treating its answer as approval.
    const labels = approvalLabels(options.root);
    const text = new TextDecoder('utf-8', {fatal: true}).decode(fs.readFileSync(options.approvalRequest));
    const lines = text.split(/\r?\n/u);
    const labelPattern = new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?(${labels.map(escapePattern).join('|')})(?:\\*\\*)?:(?:\\*\\*)?[ \\t]*(.*)$`, 'u');
    const fields = [];
    for (let line = 0; line < lines.length; line += 1) {
        const field = labelPattern.exec(lines[line]);
        if (field) fields.push({label: field[1], value: field[2], line});
    }
    const errors = [];
    function reject(line, message) {
        errors.push({line: line + 1, rule: 'approval-request-format', message});
    }
    const starts = fields.flatMap((field, index) => field.label === labels[0] ? [index] : []);
    if (!starts.length) reject(0, 'Supply the six nonempty policy-labelled fields, followed by a direct decision question and policy link.');
    if (fields.length && fields[0].label !== labels[0]) reject(fields[0].line, 'An approval request must begin with Reason.');
    const requests = starts.map((start, index) => ({
        fields: fields.slice(start, starts[index + 1] ?? fields.length),
        heading: approvalHeading(lines, fields[start].line),
    }));
    const identifiers = new Set();
    // Review each request independently so a neighbouring explanation or rule
    // link cannot satisfy a missing decision's required structure.
    for (let index = 0; index < requests.length; index += 1) {
        const request = requests[index];
        const first = request.fields[0].line;
        const next = requests[index + 1];
        const end = next ? next.heading?.line ?? next.fields[0].line : lines.length;
        if (request.fields.map(field => field.label).join('\n') !== labels.join('\n')) {
            reject(first, 'Include each of the six policy fields exactly once in the required order.');
        }
        const history = request.fields.find(field => field.label === labels.at(-1));
        let questionLine = -1;
        if (history) {
            // A question mark in the History label/value is not a following decision question.
            questionLine = lines.findIndex((line, position) => position > history.line && position < end && line.includes('?'));
        }
        if (questionLine < 0) reject(history?.line ?? first, 'Follow History with a direct decision question.');
        for (let field = 0; field < request.fields.length; field += 1) {
            const current = request.fields[field];
            const limit = request.fields[field + 1]?.line ?? (questionLine < 0 ? end : questionLine);
            if (![current.value, ...lines.slice(current.line + 1, limit)].join('\n').trim()) {
                reject(current.line, `${current.label} must contain an explanation.`);
            }
        }
        const question = questionLine < 0 ? '' : lines.slice(questionLine, end).join('\n');
        if (!/\[[^\]\r\n]+\]\([^\)\r\n]*docs\/policies\/DEVELOPMENT_POLICY\.md#required-change-explanation-2026-10-13\)/u.test(question)) {
            reject(questionLine < 0 ? first : questionLine, 'Link the governing required-change-explanation rule after the question.');
        }
        if (requests.length > 1) {
            const id = request.heading?.id;
            if (!id || identifiers.has(id.toLowerCase())) reject(first, 'Give each simultaneous request a distinct visible heading identifier.');
            if (id) {
                identifiers.add(id.toLowerCase());
                if (questionLine < 0 || !new RegExp(`\\b${escapePattern(id)}\\b`, 'u').test(lines[questionLine])) {
                    reject(questionLine < 0 ? first : questionLine, 'Repeat this request identifier in its direct question.');
                }
            }
        }
    }
    return {mode: 'approval-request', checkedRequests: requests.length, errors, limitations: [
        'Structural preflight only: it cannot establish clarity, scope, authorization provenance or approval.',
        'Independent nonauthor and root semantic review of the exact request remain mandatory before presentation.',
        'Present every outstanding question and its complete required explanation in the final answer. This tool cannot verify conversation channels or actual delivery.',
    ]};
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
        if (!config.sourceExtensions.includes(path.extname(file))) continue;
        checked += 1;
        // Git reads this blob without checkout, reset, staging or source execution.
        const text = git(options.root, ['show', ':' + file]);
        for (const block of sourceBlocks(file, text)) {
            const source = ts.createSourceFile(file + '.ts', block.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            if (source.parseDiagnostics.length) throw new Error(`Cannot parse staged source: ${file}`);
            checkSessionOwnership(file, source, block.lineOffset, config, errors);
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
 * Declaration/DBAL/session boundaries apply to the entire authored inventory. Readability
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
        if (!config.sourceExtensions.includes(path.extname(file))) continue;
        const service = file.startsWith(config.databaseServiceDirectory + '/');
        const touched = options.all ? [{start: 1, end: Infinity}] : ranges.get(file) ?? [];
        const review = touched.length && (!options.files.length || options.files.includes(file));
        checkedSources += 1;
        if (service) checkedServiceSources += 1;
        if (review) readabilityFiles.push(file);
        for (const block of sourceBlocks(file, readSource(options.root, file))) {
            const source = ts.createSourceFile(file + '.ts', block.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            if (source.parseDiagnostics.length) throw new Error(`Cannot parse source: ${file}`);
            checkSessionOwnership(file, source, block.lineOffset, config, errors);
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
        const report = options.approvalRequest ? checkApprovalRequest(options) : buildReport(options);
        if (options.json) console.log(JSON.stringify(report, null, 2));
        else if (options.approvalRequest) {
            console.log(`Approval request syntax: ${report.checkedRequests} request(s); ${report.errors.length} findings.`);
            for (const error of report.errors) console.log(`Line ${error.line} [${error.rule}] ${error.message}`);
            for (const limitation of report.limitations) console.log(limitation);
        }
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
