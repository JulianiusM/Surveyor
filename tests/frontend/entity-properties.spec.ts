import {describe, expect, it} from 'vitest';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {EntityPropertyPresentation} from '../../src/types/EntityPropertyTypes';

const require = createRequire(path.resolve('package.json'));
const pug = require('pug');
// Synthetic renderer data protects the actual Pug omission boundary. Maintained documentation and
// browser permission reconstructions are deliberately not inputs to these application tests.
const render = pug.compile(`
include module_entity_select
include module_timezone_select
include module_admin_options
include module_entity_archive
include module_entity_properties
+entitySettingsButton(state, archive)
+entityArchiveNotice(entity, state.entityType, archive)
+entityPropertiesModal(entity, state, archive, permissionOptions)
`, {filename: path.resolve('src/views/modules/entity-property-fixture.pug')});

function presentation(changes: Partial<EntityPropertyPresentation> = {}): EntityPropertyPresentation {
    return {
        entityType: 'packing', id: 'root', updateUrl: '/api/packing/root/update', values: {}, editableFields: [],
        canEditProperties: false, canLinkEvent: false, canEditHeader: false, canDuplicate: false,
        canDelete: false, canManagePermissions: false, currentEvent: null, ...changes,
    };
}

function html(state: EntityPropertyPresentation, archive: Record<string, unknown> | null = null): string {
    return render({
        entity: {id: 'root', title: '<Example>', headerImg: 'stored-image.png'}, state, archive,
        permissionOptions: {admins: [], perms: {permMeta: [], defaultPerms: {}, presets: []}},
    });
}

describe('entity property dialog rendering', () => {
    it('omits the entire dialog for a participant and exposes only the archived condition', () => {
        const result = html(presentation(), {archived: true, canManage: false, inheritedFromEventId: 'private-event'});
        expect(result).toContain('This entity is archived.');
        expect(result).not.toContain('entityPropertiesModal');
        expect(result).not.toContain('private-event');
        expect(result).not.toContain('Restore the event');
        expect(result).not.toContain('Automatic archival');
        expect(html(presentation(), {archived: false, canManage: false})).toBe('');
    });

    it('renders only Title for a title-only editor, with no forbidden hidden inputs', () => {
        const result = html(presentation({canEditProperties: true, editableFields: ['title'], values: {title: '<draft>'}}));
        expect(result).toContain('name="title"');
        expect(result).toContain('&lt;draft&gt;');
        for (const forbidden of ['name="description"', 'name="event_id"', 'entityImageInput', 'Delete permanently', 'Archive for everyone']) {
            expect(result).not.toContain(forbidden);
        }
    });

    it('exposes dietary settings independently of general event editing', () => {
        const result = html(presentation({entityType: 'event', canEditProperties: true,
            editableFields: ['requireDietaryInfo', 'allowDietComment', 'allowRegDietUpdateAfterDeadline'],
            values: {requireDietaryInfo: true, allowDietComment: false, allowRegDietUpdateAfterDeadline: false}}));
        expect(result).toContain('name="requireDietaryInfo"');
        expect(result).toContain('name="allowRegDietUpdateAfterDeadline"');
        expect(result).not.toContain('name="title"');
        expect(result).not.toContain('name="bindingDeadline"');
    });

    it('hosts event selection, timezone and administrator creation without nested modals', () => {
        const result = html(presentation({entityType: 'event', canEditProperties: true, canManagePermissions: true,
            canLinkEvent: true, canEditHeader: true, eventUrl: '/api/packing/root/event',
            editableFields: ['title', 'deadlineTz'], values: {title: 'Example', deadlineTz: 'UTC'}}));
        expect((result.match(/class="modal fade"/g) || []).length).toBe(1);
        expect(result).toContain('collapse admin-inline');
        expect(result).not.toContain('modal admin-modal');
        expect(result).not.toContain('entity-properties-event-modal');
        expect(result).not.toContain('entity-property-timezone-modal');
        expect(result).toContain('data-command-feedback');
    });

    it('compartments settings into only the permitted panels and opens one initial panel', () => {
        const result = html(presentation({canEditProperties: true, canLinkEvent: true, canEditHeader: true,
            canManagePermissions: true, canDelete: true, editableFields: ['title', 'startDate'],
            values: {title: 'Example', startDate: '2027-01-01'}}));
        for (const panel of ['general', 'event', 'access', 'actions']) {
            expect(result).toContain(`data-entity-settings-panel="${panel}"`);
            expect(result).toContain(`aria-controls="entity-settings-${panel}"`);
        }
        expect((result.match(/class="tab-pane entity-settings-panel show active"/g) || []).length).toBe(1);
        expect(result).toContain('Dates and time');
        expect(result).not.toContain('>Dietary requirements</summary>');
        const restricted = html(presentation({canDuplicate: true}));
        expect(restricted).toContain('data-entity-settings-panel="actions"');
        expect(restricted).not.toContain('role="tablist"');
        expect(restricted).not.toContain('data-entity-settings-panel="general"');
    });

    it('keeps inherited archive instructions inside an authorized settings dialog', () => {
        const result = html(presentation({canEditHeader: true}), {archived: true, canManage: true,
            inheritedFromEventId: 'parent', canArchive: true, canRestore: false, eventUrl: '/event/parent'});
        expect(result).toContain('Restore the event before restoring this entity.');
        expect(result).toContain('Archive for everyone');
        expect(result).not.toContain('Restore for everyone');
        expect(result).not.toContain('Delete permanently');
        const notice = result.match(/<p[^>]*data-archive-notice[^>]*>(.*?)<\/p>/)?.[1];
        expect(notice).toBe('This entity is archived.');
    });
});
