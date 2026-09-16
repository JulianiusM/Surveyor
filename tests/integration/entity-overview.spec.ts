import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as userController from '../../src/controller/userController';
import {archiveKey, isEffectivelyArchived, isHiddenInOverview} from '../../src/modules/archive/policy';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import {Survey} from '../../src/modules/database/entities/surveys/Survey';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as archiveService from '../../src/modules/database/services/EntityLifecycleService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
import {PERM} from '../../src/modules/lib/permissions';
import type {PersonalVisibility} from '../../src/types/ArchiveTypes';
import type {OverviewQuery} from '../../src/types/UserTypes';
import {createActivitySlotEntity, createDriversItemEntity, createPackingItemEntity, createProfileEntity} from '../factories/integrationEntityFactory';
import {
    assignActivitySlot,
    assignDriversItem,
    assignPackingItem,
    persistIntegrationProfile,
    registerEventAttendance,
} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

/** Every test uses separate profiles, so exact counts cannot depend on another test's fixtures. */
function overviewQuery(overrides: Partial<OverviewQuery> = {}): OverviewQuery {
    return {collection: 'owner', region: 'main', q: '', type: 'all', page: 1, childPage: 1, ...overrides};
}

async function readOverview(profile: Profile, overrides: Partial<OverviewQuery> = {}) {
    const [result] = await userService.getOverviewPages(profile.id, [overviewQuery(overrides)]);
    return result;
}

async function createEvent(owner: Profile, title: string): Promise<string> {
    return eventService.createEventTx(owner.id, {title, startDate: '2027-06-01', endDate: '2027-06-03', timezone: 'UTC'});
}

async function createPacking(owner: Profile, title: string, eventId?: string, participant?: Profile): Promise<string> {
    const item = createPackingItemEntity();
    const id = await packingService.createPackingListTx(owner.id, title, '', [item], eventId);
    if (participant) await assignPackingItem(item.id, participant.id);
    return id;
}

async function registerParticipant(eventId: string, profile: Profile): Promise<void> {
    await registerEventAttendance(eventId, profile, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
}

beforeAll(async () => {
    await initializeIntegrationDatabase();
}, 120_000);

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('bounded event-card overview', () => {
    it('keeps participation and administration children distinct without importing every event attachment', async () => {
        const owner = await persistIntegrationProfile();
        const participant = await persistIntegrationProfile();
        const otherOwner = await persistIntegrationProfile();
        const eventId = await createEvent(owner, 'Membership event');
        await registerParticipant(eventId, participant);
        const sharedChild = await createPacking(owner, 'Both collections child', eventId, participant);
        const managedOnly = await createPacking(owner, 'Managed child only', eventId);
        const participatingOnly = await createPacking(otherOwner, 'Participating child only', eventId, participant);
        await createPacking(otherOwner, 'Unrelated attachment', eventId);

        const managed = await readOverview(owner);
        const participating = await readOverview(participant, {collection: 'participant'});
        expect(managed.items.map(item => item.id)).toEqual([eventId]);
        expect(participating.items.map(item => item.id)).toEqual([eventId]);
        expect(managed.items[0].overview).toMatchObject({total: 2, matching: 2});
        expect(participating.items[0].overview).toMatchObject({total: 2, matching: 2});
        expect(managed.collectionTotal).toBe(3);
        expect(participating.collectionTotal).toBe(3);

        const ownerChildren = await readOverview(owner, {eventId});
        const participantChildren = await readOverview(participant, {collection: 'participant', eventId});
        expect(ownerChildren.event?.id).toBe(eventId);
        expect(new Set(ownerChildren.items.map(item => item.id))).toEqual(new Set([sharedChild, managedOnly]));
        expect(new Set(participantChildren.items.map(item => item.id))).toEqual(new Set([sharedChild, participatingOnly]));
        expect(ownerChildren.items.some(item => item.type === 'event')).toBe(false);

        // Registration establishes the event card only. It cannot introduce sibling memberships.
        const registeredOnly = await persistIntegrationProfile();
        await registerParticipant(eventId, registeredOnly);
        const registered = await readOverview(registeredOnly, {collection: 'participant', eventId});
        expect(registered.items).toHaveLength(0);
        expect(registered.collectionTotal).toBe(1);
    });

    it('retains the feature-specific assignment, response, and zero-mask administration predicates', async () => {
        const owner = await persistIntegrationProfile();
        const participant = await persistIntegrationProfile();
        const eventId = await createEvent(owner, 'Not registered');
        const packing = await createPacking(owner, 'Assigned packing', eventId, participant);
        const activity = await activityService.createActivityPlanTx(owner.id, 'Assigned activity', '', '2027-06-01', '2027-06-03', [createActivitySlotEntity()], eventId);
        const [slot] = await activityService.getActivitySlotsFlat(activity);
        await assignActivitySlot(slot.id, participant.id);
        const drivers = await driverService.createDriversList(owner.id, 'Drivers require both relationships', '', eventId);
        const driverItem = createDriversItemEntity();
        await driverService.createDriversItem(drivers, owner.id, driverItem);
        await assignDriversItem(driverItem.id, participant.id);
        const survey = await surveyService.createSurveyTx(owner.id, 'Negative response still participates', '', [{weekday: 'MON', week: '1'}]);
        const [combination] = await surveyService.getCombinationsBySurveyId(survey);
        await surveyService.saveResponse(survey, participant.id, combination.id, 'no');

        const beforeDriverOwnership = await readOverview(participant, {collection: 'participant'});
        expect(new Set(beforeDriverOwnership.items.map(item => item.id))).toEqual(new Set([packing, activity, survey]));
        await driverService.createDriversItem(drivers, participant.id, createDriversItemEntity());
        const afterDriverOwnership = await readOverview(participant, {collection: 'participant'});
        expect(new Set(afterDriverOwnership.items.map(item => item.id))).toEqual(new Set([packing, activity, drivers, survey]));

        // Administrative assignment membership does not require a particular effective grant bit;
        // the survey exception remains owner-only even if a polymorphic ACL row exists for it.
        await adminService.addAdmin('packing', packing, participant.id, 0);
        await adminService.addAdmin('survey', survey, participant.id, PERM.ACCESS_ADMIN);
        await adminService.addAdmin('packing', packing, owner.id, PERM.ACCESS_ADMIN);
        const delegated = await readOverview(participant);
        expect(delegated.items.map(item => item.id)).toEqual([packing]);
        const ownerChildren = await readOverview(owner, {eventId});
        expect(ownerChildren.items.filter(item => item.id === packing)).toHaveLength(1);
    });

    it('pages one mixed card set and independently bounds the selected event children', async () => {
        const owner = await persistIntegrationProfile();
        const eventId = await createEvent(owner, 'A event with later child pages');
        const children: string[] = [];
        for (let index = 0; index < 27; index++) {
            children.push(await createPacking(owner, `Linked ${String(index).padStart(2, '0')}`, eventId));
        }
        const standalone: string[] = [];
        for (let index = 0; index < 25; index++) {
            const title = `Card ${String(index).padStart(2, '0')}`;
            standalone.push(index % 2
                ? await createEvent(owner, title)
                : await createPacking(owner, title));
        }

        const first = await readOverview(owner);
        const second = await readOverview(owner, {page: 2});
        expect(first.pageSize).toBe(24);
        expect(first.items.map(item => item.id)).toEqual([eventId, ...standalone.slice(0, 23)]);
        expect(second.items.map(item => item.id)).toEqual(standalone.slice(23));
        expect(first.cardTotal).toBe(26);
        expect(first.matchingTotal).toBe(53);
        expect(new Set([...first.items, ...second.items].map(item => archiveKey(item))).size).toBe(26);
        expect((await readOverview(owner, {page: 999})).query.page).toBe(2);

        const firstChildren = await readOverview(owner, {eventId});
        const lastChildren = await readOverview(owner, {eventId, childPage: 999});
        expect(firstChildren.items.map(item => item.id)).toEqual(children.slice(0, 24));
        expect(lastChildren.items.map(item => item.id)).toEqual(children.slice(24));
        expect(lastChildren.query.childPage).toBe(2);
        expect(lastChildren.childTotal).toBe(27);

        // Deleting the last top-level page clamps the next read and never falls back to stale rows.
        await eventService.deleteEvent(standalone[23]);
        await packingService.deletePackingList(standalone[24]);
        const clamped = await readOverview(owner, {page: 2});
        expect(clamped.query.page).toBe(1);
        expect(clamped.cardTotal).toBe(24);
    });

    it('finds unloaded children through event cards and treats SQL wildcard input literally', async () => {
        const owner = await persistIntegrationProfile();
        const eventId = await createEvent(owner, 'Parent title does not match children');
        const matching = await createPacking(owner, '100%_complete\\receipt', eventId);
        await createPacking(owner, '100AXcomplete\\receipt', eventId);
        const independent = await createPacking(owner, 'Independent equipment');
        const found = await readOverview(owner, {q: '100%_complete\\receipt', type: 'packing'});
        expect(found.items.map(item => item.id)).toEqual([eventId]);
        expect(found.matchingTotal).toBe(1);
        expect(found.cardTotal).toBe(1);
        expect(found.items[0].overview).toMatchObject({total: 2, matching: 1});
        expect(found.types).toEqual(expect.arrayContaining(['event', 'packing']));
        const children = await readOverview(owner, {q: '100%_complete\\receipt', type: 'packing', eventId});
        expect(children.items.map(item => item.id)).toEqual([matching]);
        expect(children.childTotal).toBe(2);
        expect(children.event?.overview?.matching).toBe(1);
        const parentMatch = await readOverview(owner, {q: 'Parent title', eventId});
        expect(parentMatch.event?.id).toBe(eventId);
        expect(parentMatch.items).toHaveLength(0);
        expect(parentMatch.matchingTotal).toBe(1);
        expect((await readOverview(owner, {q: 'INDEPENDENT'})).items.map(item => item.id)).toEqual([independent]);
        // Type names participate in the same literal search as titles/descriptions. An
        // accent-insensitive connection collation must not turn "évènt" into "event".
        const accentedType = await readOverview(owner, {q: 'évènt'});
        expect(accentedType.matchingTotal).toBe(0);
        expect(accentedType.items).toEqual([]);
    });

    it('releases children into ordinary cards when their parent is hidden or its membership is revoked', async () => {
        const parentOwner = await persistIntegrationProfile();
        const childOwner = await persistIntegrationProfile();
        const eventId = await createEvent(parentOwner, 'Delegated parent');
        const child = await createPacking(childOwner, 'Owned child', eventId);
        await adminService.addAdmin('event', eventId, childOwner.id, 0);
        expect((await readOverview(childOwner)).items.map(item => item.id)).toEqual([eventId]);
        await userService.setVisibility(childOwner.id, {type: 'event', id: eventId}, 'hidden');
        const hiddenParent = await readOverview(childOwner, {eventId});
        expect(hiddenParent.event).toBeUndefined();
        expect(hiddenParent.query.eventId).toBeUndefined();
        expect(hiddenParent.items.map(item => item.id)).toEqual([child]);
        expect((await readOverview(childOwner, {region: 'hidden'})).items.map(item => item.id)).toEqual([eventId]);
        await userService.setVisibility(childOwner.id, {type: 'event', id: eventId}, 'default');
        await adminService.removeAdmin('event', eventId, childOwner.id);
        expect((await readOverview(childOwner, {eventId})).items.map(item => item.id)).toEqual([child]);

        // Relinking is read from the actual relationship on the next request, not a saved card grouping.
        const replacement = await createEvent(childOwner, 'Replacement parent');
        await AppDataSource.getRepository(PackingList).update(child, {event: {id: replacement}});
        expect((await readOverview(childOwner)).items.map(item => item.id)).toEqual([replacement]);
        expect((await readOverview(childOwner, {eventId: replacement})).items.map(item => item.id)).toEqual([child]);
    });

    it('keeps SQL placement equivalent to the lifecycle policy for every archive and visibility combination', async () => {
        const owner = await persistIntegrationProfile();
        const timestamp = new Date('2027-01-01T00:00:00Z');
        const choices: PersonalVisibility[] = ['default', 'hidden', 'shown'];
        for (const inherited of [false, true]) {
            for (const direct of [false, true]) {
                for (const visibility of choices) {
                    const title = `Matrix ${inherited}-${direct}-${visibility}`;
                    const eventId = await createEvent(owner, `Parent ${title}`);
                    const child = await createPacking(owner, title, eventId);
                    if (direct) await archiveService.archiveEntity({type: 'packing', id: child}, timestamp);
                    if (inherited) await archiveService.archiveEntity({type: 'event', id: eventId}, timestamp);
                    await userService.setVisibility(owner.id, {type: 'packing', id: child}, visibility);
                    const expectedHidden = isHiddenInOverview(isEffectivelyArchived(direct ? timestamp : null, inherited ? timestamp : null), visibility);
                    const results = await userService.getOverviewPages(owner.id, [
                        overviewQuery({q: title, type: 'packing', eventId}),
                        overviewQuery({q: title, type: 'packing', eventId, region: 'hidden'}),
                    ]);
                    expect(results[0].matchingTotal, title).toBe(expectedHidden ? 0 : 1);
                    expect(results[1].matchingTotal, title).toBe(expectedHidden ? 1 : 0);
                    const placed = results[expectedHidden ? 1 : 0];
                    expect(placed.items.map(item => item.id), title).toEqual([child]);
                    expect(placed.archives.get(archiveKey({type: 'packing', id: child}))?.archived, title).toBe(direct || inherited);
                }
            }
        }
    });

    it('isolates active profiles and guests and does not merge different entity types sharing a UUID', async () => {
        const owner = await persistIntegrationProfile();
        const secondProfile = await AppDataSource.getRepository(Profile).save(createProfileEntity(owner.user!));
        const eventId = await createEvent(owner, 'Identity scope');
        const child = await createPacking(owner, 'Shared identity packing', eventId);
        await AppDataSource.getRepository(Survey).save({id: child, title: 'Shared identity survey', owner});
        const own = await readOverview(owner);
        expect(own.collectionTotal).toBe(3);
        expect(new Set(own.items.map(item => archiveKey(item)))).toEqual(new Set([`event:${eventId}`, `survey:${child}`]));
        expect((await readOverview(secondProfile)).collectionTotal).toBe(0);

        const guest = await userService.createGuest('Overview guest');
        await registerParticipant(eventId, guest.profile);
        const [item] = await packingService.getPackingItems(child);
        await assignPackingItem(item.id, guest.profile.id);
        const participating = await readOverview(guest.profile, {collection: 'participant', eventId});
        expect(participating.items.map(card => card.id)).toEqual([child]);
        expect(participating.collectionTotal).toBe(2);
        expect((await readOverview(guest.profile)).collectionTotal).toBe(0);
    });

    it('redacts fallback parent context until the existing permission evaluator permits access', async () => {
        const owner = await persistIntegrationProfile();
        const participant = await persistIntegrationProfile();
        const eventId = await createEvent(owner, 'Private parent context');
        const child = await createPacking(owner, 'Eligible child', eventId, participant);
        const session = {profile: participant, auth: {user: participant.user!}};
        const query = {collection: 'participant', region: 'main'};
        const restricted = await userController.getOverviewRegion(session, query);
        expect(restricted.items.map(item => item.id)).toEqual([child]);
        expect(JSON.stringify(restricted)).not.toContain('Private parent context');
        expect(JSON.stringify(restricted)).not.toContain(`/event/${eventId}`);
        await adminService.updatePerms('event', eventId, {public: PERM.ACCESS_VIEW});
        const permitted = await userController.getOverviewRegion(session, query);
        expect(JSON.stringify(permitted)).toContain('Private parent context');
        expect(JSON.stringify(permitted)).toContain(`/event/${eventId}`);
        // Event access still does not introduce event participation or unrelated child membership.
        expect(permitted.items.map(item => item.id)).toEqual([child]);
    });

    it('validates authenticated navigation and preserves bounded, independent URL state', async () => {
        const owner = await persistIntegrationProfile();
        const eventId = await createEvent(owner, 'Navigation event');
        const session = {profile: owner, auth: {user: owner.user!}};
        const query = {collection: 'owner', region: 'main'};
        await expect(userController.getOverviewRegion({profile: owner}, query)).rejects.toMatchObject({status: 401});
        for (const invalid of [
            {profileId: owner.id}, {pageSize: '100000'}, {owner_main_q: ['one', 'two']},
            {owner_main_page: '-1'}, {owner_main_page: '1.5'}, {owner_main_page: '9007199254740992'},
            {owner_main_event: 'not-a-uuid'}, {region: 'other'},
        ]) {
            await expect(userController.getOverviewRegion(session, {...query, ...invalid})).rejects.toMatchObject({status: 400});
        }
        const initial = await userController.getOverviewPage(session);
        expect(initial.owner.hidden.loaded).toBe(false);
        expect(initial.owner.hidden.items).toEqual([]);
        const loaded = await userController.getOverviewPage(session, {owner_hidden_open: '1'});
        expect(loaded.owner.hidden.loaded).toBe(true);
        const selected = await userController.getOverviewRegion(session, {
            ...query, owner_main_event: eventId.toUpperCase(), owner_main_page: '999',
            participant_main_q: 'Keep this separate', owner_hidden_open: '1',
        });
        expect(selected.eventId).toBe(eventId);
        const canonical = new URL(selected.canonicalUrl, 'http://surveyor.test');
        expect(canonical.searchParams.get('owner_main_event')).toBe(eventId);
        expect(canonical.searchParams.has('owner_main_page')).toBe(false);
        expect(canonical.searchParams.get('participant_main_q')).toBe('Keep this separate');
        expect(canonical.searchParams.get('owner_hidden_open')).toBe('1');
        expect(new URL(selected.backUrl, 'http://surveyor.test').searchParams.has('owner_main_event')).toBe(false);
    });
});
