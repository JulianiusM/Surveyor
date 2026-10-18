#!/usr/bin/env node

/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

/** Temporary, explicitly invoked migration review tool. It never changes a
 * production file or performs cutover. Git blobs protect both the worktree and
 * index. Readable amendments are reconciled in memory; complete guides exist
 * only in an isolated preview whose inputs and output can be pinned for review. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseMetadata, parseMetadataBlock, parseDocumentationDelta, discoverTaskProfiles,
    walkFiles, pathMatchesRule, computeSourceFingerprint}
    from '../../scripts/check-documentation.mjs';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const transientReference = /frontend-migration\/|canonical-merge-target:|production-reference:|status:\s*migration-pending|\]\([^\n)]*staged\//i;
// Exact reviewed public owners may be copied before a normal commit makes them
// tracked. This does not admit an unlisted test, a directory or ignored private state.
const publicPreviewOwners = new Set([
    'contracts/api/v1/drivers.yaml',
    'src/frontend/components/BasicEntityMetadataFields.vue',
    'src/frontend/components/EntityAssignees.vue',
    'src/frontend/components/EntityAssignmentActions.vue',
    'src/frontend/components/EntityListCreation.vue',
    'src/frontend/composables/listDetail.ts',
    'src/frontend/composables/listReorder.ts',
    'src/frontend/features/drivers/DriversCreatePage.vue',
    'src/frontend/features/drivers/DriversEntry.vue',
    'src/frontend/features/drivers/DriversPage.vue',
    'src/frontend/features/drivers/DriversSettings.vue',
    'src/frontend/features/drivers/api.ts',
    'src/routes/api/v1/drivers.ts',
    'src/routes/frontendPilotDrivers.ts',
    'src/types/FrontendListTypes.d.ts',
    'tests/e2e/frontend-pilot-drivers.spec.ts',
    'tests/keywords/frontendDriversE2EKeywords.ts',
    'tests/frontend/frontend-drivers.spec.ts',
    'tests/integration/drivers-v1-api.spec.ts',
    'contracts/api/v1/events.yaml',
    'scripts/package-documentation.mjs',
    'src/frontend/components/CommandFeedback.vue',
    'src/frontend/components/EntityAccessEditor.vue',
    'src/frontend/components/EntityEntryPage.vue',
    'src/frontend/components/EntityHeader.vue',
    'src/frontend/components/EntityMetadataEditor.vue',
    'src/frontend/components/EntitySettingsDialog.vue',
    'src/frontend/components/TimezoneOptions.vue',
    'src/frontend/components/TimezonePicker.vue',
    'src/frontend/composables/entityLifecycle.ts',
    'src/frontend/composables/metadataEditor.ts',
    'src/frontend/composables/pageNavigation.ts',
    'src/frontend/features/event/EventBypassLinks.vue',
    'src/frontend/features/event/EventCreatePage.vue',
    'src/frontend/features/event/EventEntry.vue',
    'src/frontend/features/event/EventFields.vue',
    'src/frontend/features/event/EventMetadataFields.vue',
    'src/frontend/features/event/EventPage.vue',
    'src/frontend/features/event/EventParticipants.vue',
    'src/frontend/features/event/EventRegistration.vue',
    'src/frontend/features/event/EventSettings.vue',
    'src/frontend/features/event/EventSummary.vue',
    'src/frontend/features/event/EventThingsToDo.vue',
    'src/frontend/features/event/EventTotals.vue',
    'src/frontend/features/event/api.ts',
    'src/frontend/features/event/clipboard.ts',
    'src/frontend/features/event/presentation.ts',
    'src/frontend/features/event/useEventSection.ts',
    'src/frontend/features/identity/GuestEntryPage.vue',
    'src/frontend/styles/accordion.sass',
    'src/frontend/styles/application.sass',
    'src/frontend/styles/help.sass',
    'src/frontend/styles/style.sass',
    'src/frontend/styles/timezone-select.sass',
    'src/modules/localization/generated/',
    'src/routes/api/v1/events.ts',
    'src/routes/frontendPilotEvent.ts',
    'src/types/FrontendEntityAccessTypes.d.ts',
    'src/types/FrontendEntityDialogTypes.d.ts',
    'src/types/FrontendEntityEntryTypes.d.ts',
    'src/types/FrontendEntityMetadataTypes.d.ts',
    'src/types/FrontendEntityDocumentTypes.d.ts',
    'src/types/FrontendFeedbackTypes.d.ts',
    'src/types/FrontendGuestEntryTypes.d.ts',
    'src/types/LocalizationTypes.d.ts',
    'src/types/api/',
    'tests/e2e/frontend-entity-header.spec.ts',
    'tests/e2e/frontend-event-organizer.spec.ts',
    'tests/e2e/frontend-event-workflows.spec.ts',
    'tests/e2e/frontend-events.spec.ts',
    'tests/factories/frontendEventFactory.ts',
    'tests/frontend/frontend-entity-presentation.spec.ts',
    'tests/frontend/frontend-entry-retirement.spec.ts',
    'tests/frontend/frontend-event-foundation.spec.ts',
    'tests/frontend/frontend-event-organizer.spec.ts',
    'tests/frontend/frontend-event-page.spec.ts',
    'tests/frontend/frontend-event-registration.spec.ts',
    'tests/frontend/frontend-page-navigation.spec.ts',
    'tests/integration/event-api.spec.ts',
    'tests/integration/frontend-development-runtime.spec.ts',
    'tests/integration/frontend-session-admission.spec.ts',
    'tests/keywords/frontendEventE2EKeywords.ts',
    'tests/keywords/frontendEventKeywords.ts',
    'tests/unit/event-api-errors.spec.ts',
]);
const publicEnvironmentTemplates = new Set(['.env.e2e.example', 'tests/.env.test.example']);
const loadedEngineFiles = [fileURLToPath(import.meta.url), path.resolve(toolDirectory, '../../scripts/check-documentation.mjs')];
const loadedEngineDigests = loadedEngineFiles.map(function identifyLoadedEngine(filename) {
    return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
});

/** Digests share the repository's CRLF-only text normalization. Other spacing
 * remains significant so an edited paragraph cannot silently match its origin. */
export function normalizedDocumentationText(text) {
    return text.replaceAll('\r\n', '\n');
}

/** One exported digest owner is shared by authoring and reconciliation. */
export function documentationDigest(text) {
    return createHash('sha256').update(normalizedDocumentationText(text), 'utf8').digest('hex');
}

/** Return heading spans in normalized text, excluding the document title and
 * code-fence contents. Each span includes its heading and ends immediately
 * before the next heading of the same or a higher level. */
export function documentationSections(text) {
    const normalized = normalizedDocumentationText(text);
    const sections = [];
    const ancestors = [];
    let offset = 0;
    let fence = null;
    for (const line of normalized.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
        // Shell comments and sample Markdown inside fences cannot become apply
        // locations. Retain offsets even while those lines are being ignored.
        const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
        if (fenceMatch) {
            const marker = fenceMatch[1];
            if (!fence) fence = marker;
            else if (marker[0] === fence[0] && marker.length >= fence.length
                && line.slice(fenceMatch[0].length).trim() === '') fence = null;
            offset += line.length;
            continue;
        }
        if (!fence) {
            const heading = line.trimEnd().match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
            if (heading) {
                const level = heading[1].length;
                // Closing an ancestor also closes its deeper spans. Omitting
                // h1 keeps heading paths stable when a document title changes.
                while (ancestors.length && ancestors.at(-1).level >= level) ancestors.pop().end = offset;
                if (level > 1) {
                    const label = `${heading[1]} ${heading[2]}`;
                    const section = {headingPath: [...ancestors.map(function ancestorLabel(ancestor) {
                        return ancestor.label;
                    }), label], label, level, start: offset, end: normalized.length};
                    sections.push(section);
                    ancestors.push(section);
                }
            }
        }
        offset += line.length;
    }
    for (const section of sections) section.content = normalized.slice(section.start, section.end);
    return sections;
}

/** Fail closed when a named location is absent or ambiguous; guessing a
 * paragraph destination would discard or overwrite unrelated live guidance. */
export function documentationSection(text, headingPath) {
    if (!Array.isArray(headingPath) || !headingPath.length
        || headingPath.some(function invalidHeading(heading) { return typeof heading !== 'string'; })) {
        throw new Error('A section requires its exact h2+ heading path');
    }
    const key = headingPath.join('\0');
    const matches = documentationSections(text).filter(function matchesHeading(section) {
        return section.headingPath.join('\0') === key;
    });
    if (matches.length !== 1) throw new Error(`Missing or ambiguous documentation section: ${headingPath.join(' > ')}`);
    return matches[0];
}

/** Metadata span ownership stays in the generic documentation parser. */
export function documentationMetadataDigest(text) {
    const block = parseMetadataBlock(normalizedDocumentationText(text));
    if (!block) throw new Error('Documentation metadata is missing');
    return documentationDigest(block.content);
}

/** Marker lines contribute one framing newline at each edge. Remove exactly
 * those two newlines, preserving every authored content newline and space. The
 * generic parser retains raw ranges for diagnostics and final-link ownership. */
export function documentationPayloadContent(block) {
    const content = normalizedDocumentationText(block.content);
    if (!content.startsWith('\n') || !content.endsWith('\n')) throw new Error(`Delta payload requires framing newlines: ${block.id}`);
    return content.slice(1, -1);
}

/** Locate an exact, unique fragment inside its admitted heading scope. A small
 * paragraph edit must never replace the surrounding stable domain chapter. */
function uniqueDocumentationFragment(text, fragment, scope) {
    if (typeof fragment !== 'string' || !fragment) throw new Error('A text operation requires its exact original fragment');
    const scoped = text.slice(scope.start, scope.end);
    const position = scoped.indexOf(fragment);
    if (position < 0 || scoped.indexOf(fragment, position + 1) >= 0) throw new Error('Missing or ambiguous documentation fragment');
    return {start: scope.start + position, end: scope.start + position + fragment.length, content: fragment};
}

/** A changed apply base needs an explicit reviewed digest and provenance. The
 * immutable original remains available; current bytes never approve themselves. */
function verifyDocumentationOrigin(original, current, operation) {
    if (documentationDigest(original) !== operation.originSha256) throw new Error('Documentation origin digest differs');
    if (current === original) return;
    if (!operation.reconciliation?.trim() || documentationDigest(current) !== operation.reviewedCurrentSha256) {
        throw new Error('Documentation reconciliation needed: touched current content changed');
    }
}

/** Resolve all edits against one current snapshot before applying any of them.
 * Original digests and reviewed overlap receipts protect unrelated live changes;
 * payload framing and named-block syntax have one shared parser owner. */
export function assembleDocumentationDelta(originText, currentText, deltaText, record) {
    const origin = normalizedDocumentationText(originText);
    const current = normalizedDocumentationText(currentText);
    const parsed = parseDocumentationDelta(deltaText);
    if (parsed.errors.length) throw new Error(parsed.errors.map(function describeDeltaError(error) {
        return error.message;
    }).join('\n'));
    const blocks = new Map(parsed.blocks.map(function identifyPayload(block) { return [block.id, block]; }));
    const used = new Set();
    const edits = [];
    if (!Array.isArray(record.operations) || !record.operations.length) throw new Error('A delta requires explicit operations');

    // Resolve payload ownership and exact current locations first. No operation
    // sees text modified by a previous operation in the same manifest record.
    for (const operation of record.operations) {
        const block = blocks.get(operation.payload);
        if (!block || used.has(operation.payload)) throw new Error(`Missing or repeated delta payload: ${operation.payload}`);
        used.add(operation.payload);
        const replacement = documentationPayloadContent(block);
        const originalScope = operation.headingPath ? documentationSection(origin, operation.headingPath)
            : {start: 0, end: origin.length};
        const currentScope = operation.headingPath ? documentationSection(current, operation.headingPath)
            : {start: 0, end: current.length};
        let range;

        if (operation.kind === 'replace-section') {
            if (!operation.headingPath) throw new Error('A section replacement requires its heading path');
            verifyDocumentationOrigin(originalScope.content, currentScope.content, operation);
            range = currentScope;
        } else if (operation.kind === 'replace-text') {
            const originalFragment = normalizedDocumentationText(operation.original ?? '');
            const originalRange = uniqueDocumentationFragment(origin, originalFragment, originalScope);
            const currentFragment = normalizedDocumentationText(operation.reviewedCurrentText ?? originalFragment);
            const currentRange = uniqueDocumentationFragment(current, currentFragment, currentScope);
            verifyDocumentationOrigin(originalRange.content, currentRange.content, operation);
            range = currentRange;
        } else if (operation.kind === 'insert-before-section' || operation.kind === 'insert-after-section') {
            if (!operation.headingPath) throw new Error('An insertion requires its heading path');
            const position = operation.kind === 'insert-before-section' ? currentScope.start : currentScope.end;
            range = {start: position, end: position};
        } else throw new Error(`Unknown documentation delta operation: ${operation.kind}`);
        edits.push({start: range.start, end: range.end, replacement});
    }
    if (used.size !== blocks.size) throw new Error('Delta has an unmapped payload');

    // Patch canonical metadata in place. The delta's pending authoring header is
    // never published, and untouched key order/comments remain canonical.
    if (record.metadata) {
        const originalBlock = parseMetadataBlock(origin);
        const currentBlock = parseMetadataBlock(current);
        if (!originalBlock || !currentBlock) throw new Error('Canonical metadata is missing');
        verifyDocumentationOrigin(originalBlock.content, currentBlock.content,
            {originSha256: record.metadataOriginSha256, reviewedCurrentSha256: record.metadataReviewedCurrentSha256,
                reconciliation: record.metadataReconciliation});
        const lines = currentBlock.content.split('\n');
        for (const [key, value] of Object.entries(record.metadata)) {
            if (!/^[a-z][a-z0-9-]*$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value)) {
                throw new Error('Invalid scalar metadata patch');
            }
            const position = lines.findIndex(function existingMetadata(line) { return line.startsWith(key + ':'); });
            if (position >= 0) lines[position] = `${key}: ${value}`;
            else lines.splice(lines.length - 1, 0, `${key}: ${value}`);
        }
        edits.push({start: currentBlock.start, end: currentBlock.end, replacement: lines.join('\n')});
    }

    // Reject overlaps and duplicate insert points rather than let operation order
    // silently decide which human-authored instruction survives.
    edits.sort(function orderEdits(left, right) { return left.start - right.start || left.end - right.end; });
    let previous = null;
    let cursor = 0;
    let result = '';
    for (const edit of edits) {
        if (previous && (edit.start < previous.end || edit.start === previous.start)) throw new Error('Overlapping documentation operations');
        result += current.slice(cursor, edit.start) + edit.replacement;
        cursor = edit.end;
        previous = edit;
    }
    result += current.slice(cursor);
    if (transientReference.test(result) || !result.startsWith('# ') || !parseMetadata(result)) {
        throw new Error('Prepared guide retains temporary references or invalid production metadata');
    }
    return result;
}

/** Keep explicit root/manifest selection available for disposable CLI fixtures.
 * Production review uses the checked-in immutable commit and destination map. */
function readOptions(argumentsList) {
    const options = {root: path.resolve(toolDirectory, '../..'),
        manifest: path.join(toolDirectory, 'documentation-boundary.json'), preview: false, ready: null};
    for (let index = 0; index < argumentsList.length; index++) {
        const argument = argumentsList[index];
        if (argument === '--preview') options.preview = true;
        else if (argument === '--root' || argument === '--manifest' || argument === '--check-ready') {
            const value = argumentsList[++index];
            if (!value) throw new Error(`${argument} requires a path`);
            options[argument === '--check-ready' ? 'ready' : argument.slice(2)] = path.resolve(value);
        } else throw new Error(`Unknown argument: ${argument}`);
    }
    if (options.preview && options.ready) throw new Error('Preview and readiness are separate operations');
    return options;
}

/** Run Git without a shell; never interpolate a path into shell command text. */
function git(root, argumentsList) {
    const result = spawnSync('git', argumentsList, {cwd: root, encoding: 'utf8', windowsHide: true});
    if (result.error || result.status !== 0) {
        throw new Error(result.error?.message || result.stderr.trim() || 'Git inspection failed');
    }
    return result.stdout;
}

/** Every writable preview path must remain in its newly created owned tree. */
function resolveContained(root, relative) {
    const result = path.resolve(root, relative);
    if (result === root || !result.startsWith(root + path.sep)) {
        throw new Error(`Path escapes its owning tree: ${relative}`);
    }
    assertPlainPath(result);
    return result;
}

/** Reject redirected ancestors before any read or mkdir. Checking only a leaf
 * cannot detect a junction/symlink which redirects its containing directory. */
function assertPlainPath(absolute) {
    const filesystemRoot = path.parse(absolute).root;
    let current = filesystemRoot;
    for (const component of path.relative(filesystemRoot, absolute).split(path.sep)) {
        current = path.join(current, component);
        if (!fs.existsSync(current)) break;
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Redirected path: ${current}`);
    }
}

/** Match only the profile's production reference owners. Flat guide selectors
 * exclude locale corpora and other optional profile directories automatically;
 * active policies, ADRs and AI instructions are outside this inventory. */
function isProtected(relative, manifest) {
    if (relative.startsWith(manifest.controlRoot) || manifest.exemptFiles.includes(relative)) return false;
    return manifest.protectedFiles.includes(relative)
        || manifest.protectedRoots.some(function containsProtectedRoot(root) { return relative.startsWith(root); })
        || manifest.flatGuideRoots.some(function containsFlatGuide(root) {
            const filename = relative.startsWith(root) ? relative.slice(root.length) : '';
            return filename.endsWith('.md') && !filename.includes('/');
        });
}

/** Reject a missing/vacuous scope instead of treating it as proof of a freeze.
 * The recorded commit is immutable; this tool never accepts a moving HEAD name. */
function validateManifest(manifest, root) {
    // Required production/native selectors cannot disappear into an empty or
    // moving configuration and then be presented as a clean freeze report.
    if (!/^[0-9a-f]{40}$/.test(manifest.baselineCommit) || manifest.controlRoot !== 'docs/frontend-migration/') {
        throw new Error('Boundary requires an immutable commit and the established control root');
    }
    if (manifest.stagingMode !== 'deltas') throw new Error('This profile maintains deltas, not complete staged guides');
    for (const name of ['protectedRoots', 'flatGuideRoots', 'protectedFiles', 'exemptFiles', 'replacements']) {
        if (!Array.isArray(manifest[name]) || manifest[name].length === 0) throw new Error(`Empty boundary inventory: ${name}`);
    }
    if (!manifest.flatGuideRoots.includes('docs/') || !manifest.flatGuideRoots.includes('docs/user-guide/')
        || !manifest.protectedRoots.includes('docs/features/') || !manifest.protectedRoots.includes('docs/user-guide/assets/')
        || !manifest.protectedFiles.includes('README.md')
        || !manifest.exemptFiles.includes('docs/features/help/HELP_VISUALS.md')) {
        throw new Error('Production guide/native Help classification is incomplete');
    }
    for (const relative of [...manifest.protectedRoots, ...manifest.flatGuideRoots,
        ...manifest.protectedFiles, ...manifest.exemptFiles]) validateRelativePath(relative);
    for (const root of [...manifest.protectedRoots, ...manifest.flatGuideRoots]) {
        if (!root.endsWith('/')) throw new Error('Boundary roots require a directory separator');
    }
    for (const replacement of manifest.replacements) {
        validateRelativePath(replacement.source);
        validateRelativePath(replacement.target);
    }
    // Public inputs and approved cleanup results are explicit declarations.
    // Validation here never infers approval from current on-disk contents.
    if (!Array.isArray(manifest.reviewInputs)) throw new Error('Review input inventory is missing');
    for (const relative of manifest.reviewInputs) validateRelativePath(relative);
    if (manifest.previewInputs !== undefined && !Array.isArray(manifest.previewInputs)) throw new Error('Invalid preview input inventory');
    for (const relative of manifest.previewInputs ?? []) {
        validateRelativePath(relative);
        if (!publicPreviewOwners.has(relative)) throw new Error('Preview input is not an admitted public owner');
        // An exact public file name cannot be substituted with a directory and
        // recursively copy unrelated children into an otherwise valid preview.
        validatePreviewInput(root, relative);
    }
    if (manifest.approvedCleanups !== undefined && !Array.isArray(manifest.approvedCleanups)) throw new Error('Invalid cleanup inventory');
    for (const cleanup of manifest.approvedCleanups ?? []) {
        validateRelativePath(cleanup.path);
        if (!/^[0-9a-f]{40}$/.test(cleanup.blob) || !/^\d{4}-\d{2}-\d{2}$/.test(cleanup.approvedOn)
            || typeof cleanup.reference !== 'string' || !cleanup.reference.trim()) throw new Error('Invalid reviewed cleanup receipt');
    }
}

/** Resolve one declared public source with its file/directory kind intact.
 * Missing generated inputs remain visible advisory evidence; existing sources
 * must match their exact owner's kind before preparation can create output. */
function validatePreviewInput(root, relative) {
    const source = resolveContained(root, relative);
    if (!fs.existsSync(source)) return source;

    // Directory owners have an explicit trailing separator; all other admitted
    // owners are ordinary files. Containment already rejects redirected ancestors.
    const information = fs.lstatSync(source);
    if (relative.endsWith('/')) {
        if (!information.isDirectory()) throw new Error(`Public preview input must be a directory: ${relative}`);
    } else if (!information.isFile()) throw new Error(`Public preview input must be a regular file: ${relative}`);
    return source;
}

/** A raw prefix is insufficient: reject traversal and alternative separators
 * before a source, target or generated input can influence preview creation. */
function validateRelativePath(relative) {
    if (typeof relative !== 'string' || !relative || path.posix.normalize(relative) !== relative
        || relative.startsWith('/') || relative.includes('\\') || relative.includes(':')
        || relative.split('/').includes('..')) throw new Error('Invalid boundary-relative path');
}

/** Read the immutable tree's file identities, retaining Git's path encoding. */
function baselineFiles(root, commit) {
    const files = new Map();
    for (const entry of git(root, ['ls-tree', '-r', '-z', commit]).split('\0')) {
        if (!entry) continue;
        const separator = entry.indexOf('\t');
        const identity = entry.slice(0, separator).split(' ');
        if (identity[1] === 'blob') files.set(entry.slice(separator + 1), identity[2]);
    }
    return files;
}

/** Stage-zero identity is independent of the worktree. Unmerged entries must
 * also be visible rather than concealed by a subsequently restored file. */
function indexFiles(root) {
    const files = new Map();
    for (const entry of git(root, ['ls-files', '--stage', '-z']).split('\0')) {
        if (!entry) continue;
        const separator = entry.indexOf('\t');
        const identity = entry.slice(0, separator).split(' ');
        files.set(entry.slice(separator + 1), identity[2] === '0' ? identity[1] : 'unmerged');
    }
    return files;
}

/** Exact approved results are supplied after independent human review. This
 * tool neither approves current content nor calculates/writes new exceptions. */
function reviewedCleanups(manifest, baseline) {
    const cleanups = new Map();
    for (const cleanup of manifest.approvedCleanups ?? []) {
        if (!isProtected(cleanup.path, manifest) || !baseline.has(cleanup.path) || cleanups.has(cleanup.path)
            || cleanup.blob === baseline.get(cleanup.path)) throw new Error(`Invalid cleanup owner: ${cleanup.path}`);
        cleanups.set(cleanup.path, cleanup.blob);
    }
    return cleanups;
}

/** Compare actual files and separately staged blobs. Git applies the existing
 * attributes when hashing text, so ordinary CRLF checkout conversion is safe.
 * A reviewed cleanup is required in the worktree; the index may retain its old
 * immutable blob until staging, or contain the exact reviewed result. */
function inspectFreeze(root, manifest, baseline, index, cleanups) {
    const findings = [];
    // Enumerate only the declared protected trees. Repository-wide ignored
    // dependency/preview output is unrelated and can exceed Git's output buffer.
    const protectedPaths = [...manifest.protectedRoots, ...manifest.protectedFiles];
    for (const root of manifest.flatGuideRoots) protectedPaths.push(`:(top,glob)${root}*.md`);
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...protectedPaths]).split('\0');
    // Ignore rules do not authorize shipping an additional production guide or
    // asset. Include ignored additions so they cannot conceal a freeze breach.
    const ignored = git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...protectedPaths]).split('\0');
    const paths = new Set([...baseline.keys(), ...index.keys(), ...untracked, ...ignored]);
    for (const relative of paths) {
        if (!relative || !isProtected(relative, manifest)) continue;
        const original = baseline.get(relative);
        if (!original) { findings.push(`New production file: ${relative}`); continue; }
        const expected = cleanups.get(relative) ?? original;
        if (index.get(relative) !== original && index.get(relative) !== expected) findings.push(`Production index changed: ${relative}`);
        const absolute = resolveContained(root, relative);
        if (!fs.existsSync(absolute)) { findings.push(`Production file missing: ${relative}`); continue; }
        if (!fs.lstatSync(absolute).isFile()) { findings.push(`Production path redirected: ${relative}`); continue; }
        const actual = git(root, ['hash-object', `--path=${relative}`, '--', relative]).trim();
        if (actual !== expected) findings.push(`Production worktree changed: ${relative}`);
    }
    return findings;
}

/** Reconcile the sole declared amendment inventory against immutable origins
 * and current guides. The shared profile owner detects cross-profile collisions;
 * no other profile's task rules are activated by inspecting its map. */
function inspectReplacements(root, manifest, baseline) {
    const findings = [];
    const targets = new Set();
    const sources = new Set();
    const documents = new Map();
    const config = JSON.parse(fs.readFileSync(resolveContained(root, 'docs/policies/documentation-check.json'), 'utf8'));
    const profiles = discoverTaskProfiles(root, config);
    for (const error of profiles.errors) findings.push(error.message);
    const staging = resolveContained(root, `${manifest.controlRoot}staged/`);
    // This profile has a flat eight-guide inventory. A new directory, redirected
    // entry or unmapped file must be classified explicitly before preparation.
    for (const entry of fs.readdirSync(staging, {withFileTypes: true})) {
        const relative = `${manifest.controlRoot}staged/${entry.name}`;
        assertPlainPath(resolveContained(root, relative));
        if (!entry.isFile() || !manifest.replacements.some(function ownsDelta(record) { return record.source === relative; })) {
            findings.push(`Unmapped staged amendment: ${relative}`);
        }
    }
    for (const replacement of manifest.replacements) {
        const {source, target} = replacement;
        // Ordinary guide classification has one permanent owner. This profile's
        // manifest selects its actual eight amendments; native Help and active
        // governance cannot become future guide targets through that selection.
        const filename = target.startsWith('docs/') ? target.slice('docs/'.length) : '';
        const ordinaryGuide = target === 'README.md' || (filename && !filename.includes('/')
            && (config.documentClassification?.rootAllowlist ?? []).includes(filename));
        if (!source.startsWith(`${manifest.controlRoot}staged/`) || !isProtected(target, manifest)
            || !ordinaryGuide || !baseline.has(target) || targets.has(target) || sources.has(source)) {
            throw new Error(`Invalid or repeated replacement destination: ${target}`);
        }
        targets.add(target);
        sources.add(source);
        const absolute = resolveContained(root, source);
        if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
            findings.push(`Amendment missing or redirected: ${source}`); continue;
        }
        const text = fs.readFileSync(absolute, 'utf8');
        if (!text.startsWith('# ') || parseMetadata(text)?.status !== 'migration-pending') {
            findings.push(`Amendment lacks its pending authoring metadata: ${source}`);
        }
        try {
            const origin = git(root, ['show', `${manifest.baselineCommit}:${target}`]);
            const current = fs.readFileSync(resolveContained(root, target), 'utf8');
            documents.set(target, assembleDocumentationDelta(origin, current, text, replacement));
        } catch (error) { findings.push(`${source}: ${error.message}`); }
    }
    return {findings, documents, config, profiles};
}

/** Hash raw bytes for pinning. Assembly's normalized text digests remain a
 * separate concern: prepared publication bytes must match exactly. */
function byteDigest(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Public input admission never overrides the configured private exclusions.
 * Even an accidental source-anchor declaration cannot include credentials. */
function isPrivateInput(relative, config) {
    const filename = path.posix.basename(relative);
    return filename === 'settings.csv' || (/^\.env(?:\.|$)/.test(filename) && !publicEnvironmentTemplates.has(relative))
        || filename === '.secret'
        || /^(?:uploads|logs|\.aws|\.codex|\.agents|\.idea|\.vscode)\//.test(relative)
        || (config.excludedDirectories ?? []).some(function privateDirectory(directory) {
            return relative.split('/').includes(directory);
        });
}

/** Derive public semantic dependencies from existing source-anchor metadata.
 * Directory rules retain membership, so additions/deletions invalidate review.
 * Implementation eligibility and traversal have the generic checker as owner. */
function reviewInputRules(root, manifest, inspection) {
    const rules = new Set([...manifest.reviewInputs, manifest.controlRoot,
        'scripts/check-documentation.mjs', 'docs/policies/documentation-check.json']);
    for (const replacement of manifest.replacements) {
        rules.add(replacement.target);
        const metadata = parseMetadata(fs.readFileSync(resolveContained(root, replacement.source), 'utf8'));
        const anchors = [metadata?.['source-anchors'], replacement.metadata?.['source-anchors']];
        for (const declaration of anchors) {
            for (const anchor of (declaration ?? '').split(';')) {
                const relative = anchor.trim().replaceAll('`', '').split('#')[0];
                if (!relative || relative === 'repository-tree') continue;
                validateRelativePath(relative);
                if (isPrivateInput(relative, inspection.config)) continue;
                const absolute = resolveContained(root, relative);
                rules.add(fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()
                    ? relative.replace(/\/$/, '') + '/' : relative);
            }
        }
    }
    // Other optional profiles contribute identities and destination declarations
    // only. Their instructions are not imported into this profile's review.
    for (const profile of inspection.profiles.profiles) {
        rules.add(profile.path);
        const declared = profile.metadata['replacement-manifest'];
        if (declared) rules.add(path.posix.join(profile.directory, declared));
    }
    for (const relative of manifest.previewInputs ?? []) rules.add(relative);
    return [...rules].sort();
}

/** Capture actual scoped public bytes and membership, including missing exact
 * anchors. This is an identity check, not evidence that the words are correct. */
function captureReviewInputs(root, manifest, inspection) {
    const rules = reviewInputRules(root, manifest, inspection);
    const files = [];
    const authored = walkFiles(root, inspection.config.excludedDirectories ?? [], function validateSelectedEntry(entry) {
        const selected = rules.some(function ownsSelectedEntry(rule) {
            return pathMatchesRule(entry.relative, rule) || rule.startsWith(entry.relative + '/');
        });
        if (selected && entry.entry.isSymbolicLink()) throw new Error(`Redirected review input: ${entry.relative}`);
    });
    // Reuse fingerprint eligibility, adding all discovered private paths before
    // that owner reads any content. Unknown local .env variants must not be read
    // merely because the historical fingerprint configuration omits their name.
    const privatePaths = authored.filter(function privateAuthoredInput(relative) {
        return isPrivateInput(relative, inspection.config);
    });
    const safeConfig = {...inspection.config, fingerprint: {...inspection.config.fingerprint,
        excludedPaths: [...(inspection.config.fingerprint?.excludedPaths ?? []), ...privatePaths]}};
    const eligible = new Set(computeSourceFingerprint(root, safeConfig).files);
    for (const relative of authored) {
        if (!rules.some(function selectedInput(rule) { return pathMatchesRule(relative, rule); })
            || isPrivateInput(relative, inspection.config)) continue;
        const publicDocument = relative.startsWith('docs/') || relative === 'README.md'
            || relative === 'AGENTS.md' || relative.startsWith('.github/copilot/');
        const generated = (manifest.previewInputs ?? []).some(function publicGenerated(rule) {
            return pathMatchesRule(relative, rule);
        });
        if (!eligible.has(relative) && !publicDocument && !generated
            && relative !== '.github/copilot-instructions.md') continue;
        const absolute = resolveContained(root, relative);
        files.push({path: relative, sha256: byteDigest(fs.readFileSync(absolute))});
    }
    // Missing files are an explicit state, not silently dropped from a receipt.
    for (const rule of rules) {
        assertPlainPath(resolveContained(root, rule));
        if (!rule.endsWith('/') && !files.some(function capturedInput(file) { return file.path === rule; })) {
            files.push({path: rule, sha256: null});
        }
    }
    files.sort(function orderInputs(left, right) { return left.path.localeCompare(right.path); });
    const engine = loadedEngineFiles.map(function identifyEngine(filename, index) {
        return {path: path.basename(filename), sha256: loadedEngineDigests[index]};
    });
    const owners = rules.map(function identifyInputOwner(rule) {
        const absolute = resolveContained(root, rule);
        const state = !fs.existsSync(absolute) ? 'missing' : fs.statSync(absolute).isDirectory() ? 'directory' : 'file';
        return {path: rule, state};
    });
    return {digest: byteDigest(Buffer.from(JSON.stringify({rules, files, owners, engine}))), rules, files, owners, engine};
}

/** Copy public tracked inputs into fresh ignored output and write assembled
 * guides only there. No production path or root Git index is ever written. */
function createPreview(root, manifest, inspection) {
    const temporaryRoot = resolveContained(root, '.temp');
    fs.mkdirSync(temporaryRoot, {recursive: true});
    if (fs.realpathSync(temporaryRoot) !== temporaryRoot) throw new Error('Temporary root is redirected');
    const preview = fs.mkdtempSync(path.join(temporaryRoot, 'frontend-documentation-preview-'));
    for (const relative of git(root, ['ls-files', '-z']).split('\0')) {
        if (!relative || relative.startsWith(manifest.controlRoot) || isPrivateInput(relative, inspection.config)) continue;
        const source = resolveContained(root, relative);
        if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
        const destination = resolveContained(preview, relative);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(source, destination);
    }
    // Only declared, exactly reviewed public owners are admitted. Generated
    // contracts/catalogs and newly authored helpers/fixtures resolve documented
    // paths without copying credentials or pretending to be tracked baseline inputs.
    for (const relative of manifest.previewInputs ?? []) {
        const source = validatePreviewInput(root, relative);
        if (!fs.existsSync(source)) continue;
        const destination = resolveContained(preview, relative);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        // Exact file owners use a nonrecursive copy even if an input changes
        // after validation. Recursive copying is confined to admitted directories.
        if (!relative.endsWith('/')) {
            fs.copyFileSync(source, destination);
            continue;
        }
        fs.cpSync(source, destination, {recursive: true, dereference: false,
            filter: function acceptPlainGeneratedPath(candidate) {
                assertPlainPath(candidate);
                return true;
            }});
    }
    for (const [target, text] of inspection.documents) {
        const destination = resolveContained(preview, target);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.writeFileSync(destination, text, 'utf8');
    }
    return preview;
}

/** Structural diagnostics use final paths; known fingerprint debt remains
 * visible and advisory. A preview never claims deployed or runtime acceptance. */
function reportPreview(root, preview) {
    // Invoke the existing real checker at final paths. Its report remains
    // advisory; the raw report hash below pins exactly what reviewers saw.
    // Project authored-path counts from the live tree: omitted task records and
    // reconciled guides change occurrences without changing policy configuration.
    // Existing live count drift and actual missing target paths remain findings.
    const report = path.join(preview, 'documentation-preview.json');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-documentation.mjs'),
        '--root', preview, '--reference-root', root, '--strict', '--json', report], {encoding: 'utf8', windowsHide: true});
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Preview checker failed');
    const diagnostics = JSON.parse(fs.readFileSync(report, 'utf8'));
    console.log(`Prepared documentation preview: ${preview}`);
    console.log(JSON.stringify(diagnostics.summary));
    for (const finding of diagnostics.errors) console.log(finding.message);
    return {reportPath: 'documentation-preview.json', reportSha256: byteDigest(fs.readFileSync(report)),
        status: 'advisory', summary: diagnostics.summary};
}

/** Pin full output after assembly and advisory diagnostics. Capture inputs a
 * second time so a concurrent guide/source edit cannot yield a review receipt
 * for bytes assembled against an older snapshot. Review is supplied later. */
function prepareDocumentation(root, manifest, inspection, verifyLoadedInputs) {
    verifyLoadedInputs();
    const inputs = captureReviewInputs(root, manifest, inspection);
    // Reassemble inside the captured interval, rather than pin an older result
    // from the initial inspection if a file changed just before preparation.
    inspection = inspectReplacements(root, manifest, baselineFiles(root, manifest.baselineCommit));
    if (inspection.findings.length) throw new Error(inspection.findings.join('\n'));
    const preview = createPreview(root, manifest, inspection);
    const advisory = reportPreview(root, preview);
    const outputs = [];
    for (const target of inspection.documents.keys()) {
        outputs.push({target, path: target, sha256: byteDigest(fs.readFileSync(resolveContained(preview, target)))});
    }
    outputs.sort(function orderOutputs(left, right) { return left.target.localeCompare(right.target); });
    if (captureReviewInputs(root, manifest, inspection).digest !== inputs.digest) {
        throw new Error('Preparation inputs changed during assembly; repeat preparation before review');
    }
    verifyLoadedInputs();
    const baseline = baselineFiles(root, manifest.baselineCommit);
    const freeze = inspectFreeze(root, manifest, baseline, indexFiles(root), reviewedCleanups(manifest, baseline));
    if (freeze.length) throw new Error('Production references changed during preparation:\n' + freeze.join('\n'));
    const receipt = {schemaVersion: 1, stagingMode: 'deltas', baselineCommit: manifest.baselineCommit,
        preparedAt: new Date().toISOString(), inputs, outputs,
        outputDigest: byteDigest(Buffer.from(JSON.stringify(outputs))), advisory, semanticReview: null};
    const receiptPath = resolveContained(preview, 'documentation-preparation.json');
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    console.log(`Preparation receipt: ${receiptPath}`);
}

/** Validate independently supplied review provenance without fabricating it.
 * Identity strings are not authenticated signatures; the actual reviewers and
 * root remain responsible for semantic acceptance and publication permission. */
function validateSemanticReview(receipt) {
    const review = receipt.semanticReview;
    // Bind supplied evidence to this exact preparation, not merely to a date
    // or a successful structural report from another snapshot.
    if (!review || !Number.isFinite(Date.parse(review.reviewedAt))
        || review.inputDigest !== receipt.inputs.digest || review.outputDigest !== receipt.outputDigest
        || review.reportSha256 !== receipt.advisory.reportSha256
        || review.disposition !== 'documentation-reviewed; cutover not authorized') {
        throw new Error('Actual independent/root semantic review is missing or stale');
    }
    for (const role of ['independent', 'root']) {
        const evidence = review[role];
        if (!evidence || typeof evidence.reviewer !== 'string' || !evidence.reviewer.trim()
            || ['evidence', 'scope'].some(function missingReviewField(field) {
            return typeof evidence[field] !== 'string' || evidence[field].trim().length < 8;
        }) || !Array.isArray(evidence.limitations) || evidence.limitations.some(function invalidLimitation(value) {
            return typeof value !== 'string' || !value.trim();
        })) throw new Error(`Incomplete actual review provenance: ${role}`);
    }
    // The distinct identities make the review responsibility explicit. Their
    // authenticity and the substance of evidence still require human review.
    if (review.independent.reviewer === review.root.reviewer) throw new Error('Independent and root reviewers must differ');
}

/** Recheck the selected preparation immediately before any separately approved
 * document operation. No receipt field grants cutover, app or release approval. */
function checkReadiness(root, manifest, inspection, receiptPath, verifyLoadedInputs) {
    verifyLoadedInputs();
    // A receipt is accepted only inside one owned ignored preparation tree.
    // Caller-supplied paths cannot redirect reads into another publication.
    const temporaryRoot = resolveContained(root, '.temp');
    assertPlainPath(receiptPath);
    const preview = path.dirname(receiptPath);
    if (path.dirname(preview) !== temporaryRoot || !path.basename(preview).startsWith('frontend-documentation-preview-')
        || path.basename(receiptPath) !== 'documentation-preparation.json') throw new Error('Receipt is outside owned preparation output');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.schemaVersion !== 1 || receipt.stagingMode !== 'deltas' || receipt.baselineCommit !== manifest.baselineCommit
        || !Array.isArray(receipt.outputs) || receipt.inputs?.digest !== captureReviewInputs(root, manifest, inspection).digest) {
        throw new Error('Preparation inputs changed; reconciliation and review are required');
    }
    const expected = [];
    // Reassembly from today's declared inputs must produce the same ordered
    // destination inventory and raw bytes as the independently reviewed output.
    for (const [target, text] of inspection.documents) expected.push({target, path: target, sha256: byteDigest(Buffer.from(text))});
    expected.sort(function orderOutputs(left, right) { return left.target.localeCompare(right.target); });
    if (JSON.stringify(expected) !== JSON.stringify(receipt.outputs)
        || byteDigest(Buffer.from(JSON.stringify(expected))) !== receipt.outputDigest) throw new Error('Prepared output identity differs');
    for (const output of expected) {
        if (byteDigest(fs.readFileSync(resolveContained(preview, output.path))) !== output.sha256) throw new Error('Prepared output bytes changed');
    }
    if (receipt.advisory?.reportPath !== 'documentation-preview.json'
        || byteDigest(fs.readFileSync(resolveContained(preview, receipt.advisory.reportPath))) !== receipt.advisory.reportSha256) {
        throw new Error('Prepared advisory report changed');
    }
    validateSemanticReview(receipt);
    // A second input capture detects concurrent membership/content changes
    // while output and review evidence were being inspected.
    verifyLoadedInputs();
    if (captureReviewInputs(root, manifest, inspection).digest !== receipt.inputs.digest) {
        throw new Error('Review inputs changed during readiness inspection');
    }
    console.log('Document preparation is current and reviewed; cutover is not authorized. Advisory findings remain separate.');
}

/** Activate this optional profile explicitly, inspect immutable production and
 * live amendment boundaries, then perform only the selected document operation.
 * General application commands never import or require this entry point. */
function main() {
    const options = readOptions(process.argv.slice(2));
    assertPlainPath(options.root);
    assertPlainPath(options.manifest);
    if (!fs.statSync(options.root).isDirectory()) throw new Error('Repository root must be a directory');
    const manifestBytes = fs.readFileSync(options.manifest);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    validateManifest(manifest, options.root);
    // Direct invocation activates this one profile. General tooling never
    // imports it and remains valid when this entire optional directory is gone.
    const profile = resolveContained(options.root, manifest.controlRoot + 'PROFILE.md');
    if (!fs.existsSync(profile) || !fs.lstatSync(profile).isFile()) throw new Error('Selected profile entry point is unavailable');
    const declaredManifest = parseMetadata(fs.readFileSync(profile, 'utf8'))?.['replacement-manifest'];
    if (!declaredManifest || options.manifest !== resolveContained(options.root, manifest.controlRoot + declaredManifest)) {
        throw new Error('Selected manifest differs from the profile declaration');
    }
    // Parsed declarations and already imported engine code cannot be replaced
    // underneath preparation and then credited to newer on-disk input hashes.
    /** Reject moving declarations/engine bytes rather than label older parsed
     * operations with a newer on-disk preparation identity. */
    function verifyLoadedInputs() {
        // Compare the parsed manifest bytes and both imported engine owners;
        // newer content needs a new process, preparation and semantic review.
        if (!fs.readFileSync(options.manifest).equals(manifestBytes)) throw new Error('Manifest changed during inspection');
        for (let index = 0; index < loadedEngineFiles.length; index++) {
            if (byteDigest(fs.readFileSync(loadedEngineFiles[index])) !== loadedEngineDigests[index]) {
                throw new Error('Documentation engine changed during inspection');
            }
        }
    }
    const baseline = baselineFiles(options.root, manifest.baselineCommit);
    const freeze = inspectFreeze(options.root, manifest, baseline, indexFiles(options.root), reviewedCleanups(manifest, baseline));
    const inspection = inspectReplacements(options.root, manifest, baseline);
    for (const finding of [...freeze, ...inspection.findings]) console.error(finding);
    console.log(`Production freeze: ${freeze.length} finding(s); amendment boundary: ${inspection.findings.length} finding(s).`);
    if (freeze.length || inspection.findings.length) { process.exitCode = 1; return; }
    const currentInputs = captureReviewInputs(options.root, manifest, inspection);
    console.log(`Public review inputs: ${currentInputs.files.length}; identity: ${currentInputs.digest}. Semantic review remains required.`);
    if (options.preview) prepareDocumentation(options.root, manifest, inspection, verifyLoadedInputs);
    if (options.ready) checkReadiness(options.root, manifest, inspection, options.ready, verifyLoadedInputs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
