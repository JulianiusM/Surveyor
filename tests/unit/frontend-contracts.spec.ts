import {describe, expect, it} from 'vitest';
import * as server from '../../.generated/api/v1/server.cjs';
import * as browser from '../../.generated/api/v1/browser.mjs';
import type {components} from '../../src/types/api/v1';
import {isRegistrationPasswordValid} from '../../src/modules/lib/frontendIdentity';
import type {Request} from 'express';
import {normalizePackingMetadataPatch} from '../../src/controller/packingController';
import {validateOperationRequest} from '../../src/modules/api/transport';

const listId = 'd506d78a-e2d7-4be9-bc95-04d83bbd22ec';
const itemId = 'f092070d-07e3-461e-94bb-84b1d828dc38';

/** An ordinary authorized read includes names, not persistence or account objects. */
function packingView(): components['schemas']['PackingListView'] {
    return {entityType: 'packing', id: listId, title: 'Camp', description: null, headerUrl: null, headerVersion: null, orderToken: '"order"',
        currentEventId: null, currentEventUrl: null, archived: false, inheritedArchived: false,
        capabilities: {editTitle: true, editDescription: false, selfAssign: true, addItem: false, reorder: false, manageSettings: true},
        counters: {participants: 1, open: 0, empty: 0},
        items: [{id: itemId, title: 'Tent', description: null, position: 0, requiredByAll: false,
            maxAssignees: 1, assignedCount: 1, selfAssigned: true, assignees: [{name: 'A participant', assignmentId: null}], editToken: '"edit-aXRlbQ"',
            capabilities: {editTitle: false, editDescription: false, editCapacity: false, showTitleEdit: false,
                showCapacityEdit: false, editRequired: false, removeItem: false, removeAssignments: false}}]};
}

/** Supply only the real transport boundary's request data; no HTTP application or database is needed. */
function packingMetadataRequest(body: unknown): Request {
    return {
        params: {listId}, query: {}, body,
        get() { return undefined; },
        is(mediaType: string) { return mediaType === 'application/json' ? 'application/json' : false; },
    } as unknown as Request;
}

describe('generated v1 contract boundaries', () => {
    it('normalizes metadata at its HTTP boundary and rejects malformed patches before a typed command can run', () => {
        const submitted = {title: '  Trimmed title  ', description: ''};
        const req = packingMetadataRequest(submitted);
        validateOperationRequest(req, 'updatePackingMetadata', normalizePackingMetadataPatch);
        expect(req.body).toEqual({title: 'Trimmed title', description: null});
        expect(submitted).toEqual({title: '  Trimmed title  ', description: ''});

        // This structural matrix previously occupied a database suite even though
        // its actual owner is the HTTP decoder plus generated request schema.
        const invalidBodies = [{}, {description: undefined}, {title: null}, {title: false}, {title: '   '},
            {description: false}, {ownerId: itemId}, {title: 'Must not save', description: 'x'.repeat(16001)}];
        for (const body of invalidBodies) {
            expect(() => validateOperationRequest(packingMetadataRequest(body), 'updatePackingMetadata', normalizePackingMetadataPatch))
                .toThrow(expect.objectContaining({code: 'VALIDATION_FAILED', status: 400}));
        }
    });

    it('preserves native password length acceptance without weakening other credential constraints', () => {
        const password = 'A1'.repeat(501);
        const registration = {username: 'Account', displayname: 'Account name', email: 'account@example.invalid',
            password, password_repeat: password};
        const reset = {token: 'Current-token', password, confirmPassword: password};

        // Native forms have no password maximum. These independent long inputs catch
        // an invented transport/DOM bound without changing bcrypt or registration policy.
        for (const validators of [server, browser]) {
            expect(validators.validateLoginInput({username: 'Account', password})).toBe(true);
            expect(validators.validateRegistrationInput(registration)).toBe(true);
            expect(validators.validateResetInput(reset)).toBe(true);
            expect(validators.validateLoginInput({username: 'Account', password: ''})).toBe(false);
            expect(validators.validateLoginInput({username: 'Account', password: 12345678})).toBe(false);
            expect(validators.validateRegistrationInput({...registration, password: 'Abc1234'})).toBe(false);
            expect(validators.validateResetInput({...reset, confirmPassword: 'Abc1234'})).toBe(false);
            expect(validators.validateRegistrationInput({...registration, username: 'x'.repeat(101)})).toBe(false);
            expect(validators.validateRegistrationInput({...registration, privileged: true})).toBe(false);
        }
    });

    it('keeps standalone recovery unbounded while retaining native account and guest form field bounds', () => {
        const username = `no-existing-account-${'x'.repeat(100)}`;
        const email = `no-existing-guest@${'subdomain.'.repeat(9)}example.invalid`;

        // Both standalone native recovery forms permit these values and intentionally
        // complete normally when no account matches. Registration inputs remain bounded.
        for (const validators of [server, browser]) {
            expect(validators.validateUsernameInput({username})).toBe(true);
            expect(validators.validateEmailInput({email})).toBe(true);
            expect(validators.validateUsernameInput({username: ''})).toBe(false);
            expect(validators.validateEmailInput({email: 'invalid-email'})).toBe(false);
            expect(validators.validateGuestEmailLookupInput({email})).toBe(false);
            expect(validators.validateGuestEmailLookupInput({email: 'guest@example.invalid'})).toBe(true);
            expect(validators.validateGuestRegistrationInput({username: 'Guest', email})).toBe(false);
            expect(validators.validateRegistrationInput({username: 'Account', displayname: 'Account',
                email, password: 'Password1234', password_repeat: 'Password1234'})).toBe(false);
            expect(validators.validateEmailInput({email, privateData: 'unrequested'})).toBe(false);
        }
    });

    it('counts explicitly authored password minima in native UTF-16 units without changing standard string lengths', () => {
        const valid = ['Abcd1234', 'A1😀😀😀', 'A😀1😀😀', '😀A1😀😀', 'Abc😀😀1'];
        const invalid = ['', 'Abc1234', 'A1😀😀x', 'A😀1😀x', 'A1😀😀'];
        const registration = {username: 'Account', displayname: 'Account', email: 'account@example.invalid',
            password: 'Password1234', password_repeat: 'Password1234'};
        const reset = {token: 'Current-token', password: 'Password1234', confirmPassword: 'Password1234'};

        for (const password of valid) {
            expect(password.length).toBe(8);
            expect(isRegistrationPasswordValid(password)).toBe(true);
            for (const validators of [server, browser]) {
                expect(validators.validateRegistrationInput({...registration, password, password_repeat: password})).toBe(true);
                expect(validators.validateResetInput({...reset, password, confirmPassword: password})).toBe(true);
            }
        }

        // Test each repetition separately: a valid primary password must not hide an
        // invalid confirmation. Non-string values still fail the ordinary type rule.
        for (const password of [...invalid, 12345678, null, {}, []]) {
            for (const validators of [server, browser]) {
                expect(validators.validateRegistrationInput({...registration, password})).toBe(false);
                expect(validators.validateRegistrationInput({...registration, password_repeat: password})).toBe(false);
                expect(validators.validateResetInput({...reset, password})).toBe(false);
                expect(validators.validateResetInput({...reset, confirmPassword: password})).toBe(false);
            }
        }
        for (const validators of [server, browser]) {
            expect(validators.validatePackingMetadataPatch({title: '😀'.repeat(255)})).toBe(true);
            expect(validators.validatePackingMetadataPatch({title: '😀'.repeat(256)})).toBe(false);
            expect(validators.validateRegistrationInput({...registration, password: 'A1😀😀x'})).toBe(false);
            expect(validators.validateRegistrationInput.errors).toEqual(expect.arrayContaining([
                expect.objectContaining({keyword: 'x-surveyor-min-length-utf16', instancePath: '/password', params: {limit: 8}}),
            ]));
        }
    });

    it('validates nullable new-item descriptions and closed page-entry outcomes', () => {
        const item = {title: 'Tent', maxAssignees: 1, requiredByAll: false, description: null};
        expect(server.validatePackingNewItem(item)).toBe(true);
        expect(server.validatePageEntryOutcome({kind: 'denied', status: 400, messageKey: 'packing.eventRegistrationRequired'})).toBe(true);
        expect(server.validatePageEntryOutcome({kind: 'redirect', url: '/frontend-pilot/users/login', notice: null})).toBe(true);
        expect(server.validatePageEntryOutcome({kind: 'render', url: '/unrequested'})).toBe(false);
    });

    it('rejects unknown server output while accepting additive response fields in the browser', () => {
        const view = packingView();
        expect(server.validatePackingListView(view)).toBe(true);
        expect(browser.validatePackingListView(view)).toBe(true);
        const laterVersion = {...view, futureReadField: true,
            items: view.items.map(item => ({...item, futureItemField: 'new'}))};
        expect(server.validatePackingListView(laterVersion)).toBe(false);
        expect(browser.validatePackingListView(laterVersion)).toBe(true);
        expect(laterVersion.items[0]).toHaveProperty('futureItemField', 'new');
    });

    it('does not coerce values, insert defaults, or remove malformed mutation fields', () => {
        for (const validate of [server.validatePackingMetadataPatch, browser.validatePackingMetadataPatch]) {
            expect(validate({title: 'A new title'})).toBe(true);
            expect(validate({description: null})).toBe(true);
            expect(validate({description: ''})).toBe(true);
            expect(validate({})).toBe(false);
            expect(validate({title: '   '})).toBe(false);
            expect(validate({title: 7})).toBe(false);
            expect(validate({title: 'x'.repeat(256)})).toBe(false);
            const forged = {title: 'Allowed', archived: false};
            expect(validate(forged)).toBe(false);
            expect(forged).toEqual({title: 'Allowed', archived: false});
        }
    });

    it('keeps reused nested multipart inputs strict while accepting nested additive response fields', () => {
        const defaults = {public: 0, guest: 0, authenticated: 0, participant: 0};
        const data = {title: 'Packing', description: null, eventId: null, defaultPermissions: defaults,
            items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}]};
        expect(browser.validatePackingCreateForm({data, image: 'tent.png'})).toBe(true);
        const longText = 'x'.repeat(20000);
        expect(server.validatePackingCreateForm({data: {...data, description: longText, items: [{...data.items[0], description: longText}]}})).toBe(true);
        expect(server.validatePackingItemPatch({description: longText})).toBe(true);
        expect(server.validatePackingMetadataPatch({description: longText})).toBe(false);
        expect(browser.validatePackingCreateForm({data: {...data, ownerId: listId}})).toBe(false);
        expect(browser.validatePackingCreateForm({data: {...data, defaultPermissions: {...defaults, future: 1}}})).toBe(false);
        // PermissionDefaults is also a mutation body, but its read occurrence remains additive.
        const context = {defaults: {...defaults, future: 1}, permissions: [], presets: []};
        expect(browser.validatePackingCreateContext(context)).toBe(true);
        expect(server.validatePackingCreateContext(context)).toBe(false);
    });

    it('preserves false, null and legacy read capacities while rejecting bad identifiers and missing fields', () => {
        const view = packingView();
        view.items[0].maxAssignees = -1;
        expect(server.validatePackingListView(view)).toBe(true);
        view.items[0].maxAssignees = null;
        expect(server.validatePackingListView(view)).toBe(true);
        expect(server.validatePackingListView({...view, id: 'not-a-uuid'})).toBe(false);
        const missing: Record<string, unknown> = {...view};
        delete missing.capabilities;
        expect(browser.validatePackingListView(missing)).toBe(false);
        expect(browser.validatePackingListView({...view, archived: 'false'})).toBe(false);
    });

    it('preserves existing capacity edit transport without weakening the separate positive new-item policy', () => {
        // These are native number-control drafts, not claimed persisted values. The
        // actual signed integer column owns rounding and invalid/overflow failures;
        // this isolated test protects the authored request distinction in both runtimes.
        const drafts = [0, -1, 1.5, -1.5, null, '0', '-1', '', 'not-a-number', '1.5', '-1.5', '2.499', '2.5',
            '-2147483648', '2147483647', '-2147483648.4', '2147483647.4', '-2147483649', '2147483648'];
        const newItem = {title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false};
        for (const validators of [server, browser]) {
            for (const maxAssignees of drafts) {
                expect(validators.validatePackingItemPatch({maxAssignees})).toBe(true);
            }
            for (const maxAssignees of [true, false, {}, []]) {
                expect(validators.validatePackingItemPatch({maxAssignees})).toBe(false);
            }
            expect(validators.validatePackingItemPatch({})).toBe(false);
            expect(validators.validatePackingItemPatch({maxAssignees: '1.5', ownerId: listId})).toBe(false);
            expect(validators.validatePackingNewItem(newItem)).toBe(true);
            for (const maxAssignees of [0, -1, 1.5, null, '1', '']) {
                expect(validators.validatePackingNewItem({...newItem, maxAssignees})).toBe(false);
            }
        }
    });

    it('retains native cleared item titles in edits and duplicate reads while creation and root metadata stay required', () => {
        const item = {title: '', description: null, maxAssignees: 1, requiredByAll: false};
        const duplicate = {title: '', description: null, eventId: null, items: [item],
            defaultPermissions: {public: 0, guest: 0, authenticated: 0, participant: 0},
            formContext: {defaults: {public: 0, guest: 0, authenticated: 0, participant: 0}, permissions: [], presets: []}, selectedEvent: null};
        for (const validators of [server, browser]) {
            expect(validators.validatePackingItemPatch({title: ''})).toBe(true);
            expect(validators.validatePackingItemPatch({title: null})).toBe(false);
            expect(validators.validatePackingItemPatch({title: 'x'.repeat(256)})).toBe(false);
            expect(validators.validatePackingDuplicate(duplicate)).toBe(true);
            expect(validators.validatePackingDuplicate({...duplicate, formContext: undefined})).toBe(false);
            // Context is additive and only requested by a new caller. Existing
            // duplicate responses remain valid during a compatible release change.
            expect(validators.validatePackingDuplicate({...duplicate, selectedEvent: undefined})).toBe(true);
            expect(validators.validatePackingNewItem(item)).toBe(false);
            expect(validators.validatePackingCreateInput({title: 'New list', description: null, eventId: null,
                items: [item], defaultPermissions: duplicate.defaultPermissions})).toBe(false);
            expect(validators.validatePackingMetadataPatch({title: ''})).toBe(false);
        }
    });

    it('correlates problem code, status, key and parameters and permits safe display of a newer error', () => {
        const problem = {type: 'about:blank', title: 'Conflict', detail: 'The item is full.', requestId: 'request-1',
            code: 'PACKING_ITEM_FULL', messageKey: 'api:errors.PACKING_ITEM_FULL', status: 409, params: {itemId}};
        expect(server.validateProblem(problem)).toBe(true);
        expect(browser.validateProblem(problem)).toBe(true);
        expect(server.validateProblem({...problem, status: 400})).toBe(false);
        expect(server.validateProblem({...problem, params: {}})).toBe(false);
        expect(browser.validateProblem({...problem, params: {itemId, malicious: 'extra'}})).toBe(false);
        expect(server.validateProblem({...problem, messageKey: 'api:errors.FORBIDDEN'})).toBe(false);
        const newer = {...problem, code: 'FUTURE_ERROR', messageKey: 'api:errors.FUTURE_ERROR', future: true};
        expect(browser.validateProblem(newer)).toBe(false);
        expect(browser.validateSafeProblemDetails(newer)).toBe(true);
        expect(browser.validateSafeProblemDetails({...newer, status: 200})).toBe(false);
    });

    it('enforces anonymous session privacy without requiring an active profile for an existing account', () => {
        const session = {kind: 'anonymous', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, context: 'opaque-context', csrfToken: 'opaque-csrf', locale: 'en',
            activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
            shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true,
                oidcEnabled: false, oidcName: 'Single sign-on'}};
        expect(server.validateSessionView(session)).toBe(true);
        expect(server.validateSessionView({...session, activeProfile: {id: listId, name: 'Unexpected'}})).toBe(false);
        expect(server.validateSessionView({...session, kind: 'account', logoutUrl: '/users/logout'})).toBe(true);
        expect(server.validateSessionView({...session, token: 'must-not-be-projected'})).toBe(false);
        expect(server.validateSessionView({...session, shell: {...session.shell, oidcClientSecret: 'must-not-be-projected'}})).toBe(false);
        expect(server.validateSessionView({...session, shell: {...session.shell, localLoginEnabled: 'true'}})).toBe(false);
    });

    it('derives business parameter validation while leaving precondition and session policy to transport', () => {
        expect(server.validateGetPackingMetadataParameters({path: {listId}, query: {}, header: {}})).toBe(true);
        expect(server.validateUpdatePackingMetadataParameters({path: {listId}, query: {}, header: {}})).toBe(true);
        expect(server.validateGetPackingListParameters({path: {listId: 'invalid'}, query: {}, header: {}})).toBe(false);
        expect(server.validateGetHelpPageParameters({path: {}, query: {doc: '../private'}, header: {}})).toBe(false);
        expect(server.validateGetHelpPageParameters({path: {}, query: {q: 'x'.repeat(101)}, header: {}})).toBe(false);
        expect(server.validateGetHelpPageParameters({path: {}, query: {q: ['a', 'b']}, header: {}})).toBe(false);
    });

    it('accepts bounded field-comparison tags for conditional metadata reads', () => {
        // Metadata has several independent field hashes, so its ordinary edit tag is longer
        // than a single resource digest. The read boundary must accept the tags it returns.
        const parameters = {path: {listId}, query: {}, header: {'If-None-Match': `"edit-${'a'.repeat(700)}"`}};
        expect(server.validateGetPackingMetadataParameters(parameters)).toBe(true);
        expect(server.validateGetPackingMetadataParameters({...parameters,
            header: {'If-None-Match': 'a'.repeat(4096)}})).toBe(true);
        expect(server.validateGetPackingMetadataParameters({...parameters,
            header: {'If-None-Match': 'a'.repeat(4097)}})).toBe(false);
    });

    it('accepts every native overview entity type and only explicit allowed filters', () => {
        const card = {id: listId, type: 'survey', title: 'Trip dates', description: null, url: `/survey/${listId}`,
            headerUrl: null, headerVersion: null, eventContext: null, visibility: 'default', overviewHidden: false,
            archived: false, inheritedArchived: false, capabilities: {archive: false, restore: false, duplicate: false, remove: false},
            children: null};
        const query = {collection: 'owner', region: 'main'};
        expect(server.validateGetOverviewParameters({path: {}, query, header: {}})).toBe(true);
        for (const type of ['activity', 'drivers', 'event', 'packing', 'survey'] as const) {
            for (const validators of [server, browser]) expect(validators.validateOverviewCard({...card, type})).toBe(true);
            expect(server.validateGetOverviewParameters({path: {}, query: {...query, type}, header: {}})).toBe(true);
            expect(server.validateSetOverviewVisibilityParameters({path: {entityType: type, entityId: listId}, query: {}, header: {}})).toBe(true);
        }
        expect(server.validateGetOverviewParameters({path: {}, query: {...query, type: 'all'}, header: {}})).toBe(true);
        expect(server.validateGetOverviewParameters({path: {}, query: {...query, type: 'private'}, header: {}})).toBe(false);
        expect(server.validateGetOverviewParameters({path: {}, query: {...query, profileId: listId}, header: {}})).toBe(false);
        expect(browser.validateOverviewCard({...card, type: 'private'})).toBe(false);
    });
});
