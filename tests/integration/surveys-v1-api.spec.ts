import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as surveys from '../../src/backend/controller/surveyController';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {Survey} from '../../src/backend/modules/database/entities/surveys/Survey';
import {SurveyCombination} from '../../src/backend/modules/database/entities/surveys/SurveyCombination';
import {SurveyResponse} from '../../src/backend/modules/database/entities/surveys/SurveyResponse';
import {Guest} from '../../src/backend/modules/database/entities/user/Guest';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import * as surveyService from '../../src/backend/modules/database/services/SurveyService';
import {readOverview} from '../../src/backend/modules/overview/api';
import type {SessionLike} from '../../src/types/PermissionTypes';
import type {components} from '../../src/types/api/v1';
import {persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let guest: Profile;

function actor(profile: Profile): SessionLike {
    return {profile, auth: profile.guest ? {guest: profile.guest} : {user: profile.user!}};
}

function creation(): components['schemas']['SurveyCreateInput'] {
    return {title: 'Monthly gathering', description: 'Choose the recurring day', combinations: [
        {weekday: 'MON', nthWeek: '1'}, {weekday: 'FRI', nthWeek: 'LAST'},
    ]};
}

async function fixture(): Promise<string> {
    return (await surveys.createSurvey(creation(), undefined, actor(owner))).id;
}

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Survey owner'});
    participant = await persistIntegrationProfile({name: 'Account participant'});
    const identity = await AppDataSource.getRepository(Guest).save({username: 'Registered guest', token: randomUUID()});
    guest = await AppDataSource.getRepository(Profile).save({name: 'Guest participant', guest: identity});
}, 120_000);
afterAll(closeIntegrationDatabase);

describe('versioned Survey production operations', () => {
    it('creates a standalone survey with recurring choices and no general sharing setup', async () => {
        const before = await AppDataSource.getRepository(Survey).count();
        await expect(surveys.createSurvey(creation(), undefined, {})).rejects.toMatchObject({status: 401});
        expect(await AppDataSource.getRepository(Survey).count()).toBe(before);

        const id = await fixture();
        const persisted = await surveyService.getSurveyById(id);
        expect(persisted).toMatchObject({title: creation().title, ownerId: owner.id});
        expect(persisted).not.toHaveProperty('eventId');
        const view = (await surveys.readSurvey(id, actor(owner))).data;
        expect(view.combinations).toMatchObject(creation().combinations);
        expect(view).toMatchObject({entityType: 'survey', ownAnswers: {}, responses: [],
            capabilities: {manageSettings: true, addCombination: true, submitBallot: true}});
        expect(contractValidator('SurveyView')(view)).toBe(true);
        for (const excluded of ['eventId', 'currentEventId', 'defaultPermissions', 'permissions', 'admins']) {
            expect(view).not.toHaveProperty(excluded);
        }
    });

    it('admits account and registered guest combinations without owner management authority', async () => {
        const id = await fixture();
        await expect(surveys.readSurvey(id, {})).rejects.toMatchObject({status: 401});
        for (const [index, profile] of [participant, guest].entries()) {
            expect((await surveys.readSurvey(id, actor(profile))).data.capabilities).toEqual({
                manageSettings: false, addCombination: true, submitBallot: true,
            });
            await surveys.addSurveyCombination(id, {weekday: index === 0 ? 'WED' : 'SUN', nthWeek: '3'}, actor(profile));
            await expect(surveys.readSurveySettings(id, actor(profile))).rejects.toMatchObject({status: 403});
        }
        expect(await surveyService.getCombinationsBySurveyId(id)).toHaveLength(4);
        expect(await surveyService.getResponsesSorted(id)).toEqual({});
    });

    it('rejects a foreign choice before replacing an existing ballot', async () => {
        const id = await fixture();
        const foreignId = await fixture();
        const own = (await surveys.readSurvey(id, actor(participant))).data.combinations[0]!;
        const foreign = (await surveys.readSurvey(foreignId, actor(participant))).data.combinations[0]!;
        await surveys.submitSurveyBallot(id, {answers: {[own.id]: 'yes'}}, actor(participant));
        await expect(surveys.submitSurveyBallot(id, {answers: {[foreign.id]: 'maybe'}}, actor(participant)))
            .rejects.toMatchObject({status: 400});
        expect((await surveys.readSurvey(id, actor(participant))).data.ownAnswers).toEqual({[own.id]: 'yes'});
        expect(await surveyService.getResponsesSorted(foreignId)).toEqual({});
    });

    it('identifies an already saved recurring choice as a known rejection while preserving every saved choice', async () => {
        const id = await fixture();
        const combination = {weekday: 'WED', nthWeek: '3'} as const;
        await surveys.addSurveyCombination(id, combination, actor(participant));

        // The second actor can submit a stale view. Exercise the actual database
        // uniqueness rejection rather than replacing the persistence owner.
        await expect(surveys.addSurveyCombination(id, combination, actor(guest)))
            .rejects.toMatchObject({code: 'SURVEY_COMBINATION_EXISTS', status: 409});
        const saved = await surveyService.getCombinationsBySurveyId(id);
        expect(saved).toHaveLength(3);
        expect(saved.filter(item => item.weekday === 'WED' && item.nthWeek === '3')).toHaveLength(1);
    });

    it('replaces omitted answers, preserves the other profile and clears an empty ballot', async () => {
        const id = await fixture();
        const [first, second] = (await surveys.readSurvey(id, actor(participant))).data.combinations;
        await surveys.submitSurveyBallot(id, {answers: {[first!.id]: 'yes', [second!.id]: 'maybe'}}, actor(participant));
        await surveys.submitSurveyBallot(id, {answers: {[first!.id]: 'no'}}, actor(guest));

        // This intentionally exercises the unchanged sequential replacement.
        // It establishes omission/isolation, not atomic concurrent replacement.
        await surveys.submitSurveyBallot(id, {answers: {[second!.id]: 'yes'}}, actor(participant));
        const replaced = (await surveys.readSurvey(id, actor(participant))).data;
        expect(replaced.ownAnswers).toEqual({[second!.id]: 'yes'});
        expect(replaced.responses).toEqual(expect.arrayContaining([
            {profileId: participant.id, name: participant.name, answers: {[second!.id]: 'yes'}},
            {profileId: guest.id, name: guest.name, answers: {[first!.id]: 'no'}},
        ]));
        expect((await surveys.readSurvey(id, actor(guest))).data.ownAnswers).toEqual({[first!.id]: 'no'});
        await surveys.submitSurveyBallot(id, {answers: {}}, actor(participant));
        expect((await surveys.readSurvey(id, actor(participant))).data).toMatchObject({ownAnswers: {}, responses: [
            {profileId: guest.id, name: guest.name, answers: {[first!.id]: 'no'}},
        ]});
    });

    it('projects named native results while excluding unrelated account and guest secrets', async () => {
        const id = await fixture();
        const choice = (await surveys.readSurvey(id, actor(guest))).data.combinations[0]!;
        await surveys.submitSurveyBallot(id, {answers: {[choice.id]: 'maybe'}}, actor(guest));
        const view = (await surveys.readSurvey(id, actor(participant))).data;
        const native = await surveyService.getResponsesSorted(id);
        expect(view.responses).toEqual([{profileId: guest.id, name: native[guest.id]![0]!.name,
            answers: {[choice.id]: native[guest.id]![0]!.answer}}]);
        expect(view.ownAnswers).toEqual({});
        expect(contractValidator('SurveyView')(view)).toBe(true);
        const wire = JSON.stringify(view);
        for (const hidden of ['ownerId', 'userId', 'guestId', 'email', 'password', 'migrationToken', guest.guest!.token]) {
            expect(wire).not.toContain(hidden);
        }
    });

    it('admits an owning guest duplicate draft while keeping its eventual creation account-only', async () => {
        const id = await fixture();
        // Ownership can outlive account membership. Exercise this real stored
        // relationship rather than equating every owner with a full account.
        await AppDataSource.getRepository(Survey).update(id, {owner: {id: guest.id}});
        expect(await surveys.readSurveyDuplicate(id, actor(guest))).toMatchObject({
            title: creation().title, combinations: creation().combinations,
        });
        expect(surveys.readSurveyCreateEntry(actor(guest), `/survey/${id}/duplicate`).entry)
            .toMatchObject({kind: 'redirect'});
        await expect(surveys.createSurvey(creation(), undefined, actor(guest))).rejects.toMatchObject({status: 403});
    });

    it('projects owned and participating Surveys through the real Overview with migrated standalone actions and images', async () => {
        const id = await fixture();
        const title = `Overview survey ${id}`;
        await surveys.patchSurveyMetadata(id, {title}, actor(owner));
        await surveyService.updateHeaderImage(id, 'uploads/overview-survey.png');
        const choice = (await surveys.readSurvey(id, actor(guest))).data.combinations[0]!;
        await surveys.submitSurveyBallot(id, {answers: {[choice.id]: 'no'}}, actor(guest));

        // Read actual ORM discovery, membership and card projection together.
        // A No answer is participation; it grants neither ownership nor a parent.
        const owned = await readOverview({collection: 'owner', region: 'main', type: 'survey', q: title}, actor(owner));
        const participating = await readOverview({collection: 'participant', region: 'main', type: 'survey', q: title}, actor(guest));
        expect(owned.items).toHaveLength(1);
        expect(participating.items).toHaveLength(1);
        expect(owned).toMatchObject({parent: null, eventId: null, totalChildren: 0});
        expect(participating).toMatchObject({parent: null, eventId: null, totalChildren: 0});
        const card = {id, type: 'survey', title, url: `/survey/${id}`,
            headerUrl: `/api/v1/surveys/${id}/header`, eventContext: null, children: null,
            archived: false, inheritedArchived: false};
        expect(owned.items[0]).toMatchObject({...card,
            capabilities: {archive: true, restore: false, duplicate: true, remove: true}});
        expect(participating.items[0]).toMatchObject({...card,
            capabilities: {archive: false, restore: false, duplicate: false, remove: false}});
        expect(contractValidator('OverviewRegion')(owned)).toBe(true);
        expect(contractValidator('OverviewRegion')(participating)).toBe(true);

        // Shared archive changes card placement, independently of the preserved
        // ballot and native owner-only restore/delete/duplicate responsibilities.
        await surveys.setSurveyArchived(id, true, actor(owner));
        const hidden = await readOverview({collection: 'owner', region: 'hidden', type: 'survey', q: title}, actor(owner));
        expect(hidden.items).toHaveLength(1);
        expect(hidden.items[0]).toMatchObject({id, archived: true, eventContext: null, children: null,
            capabilities: {archive: false, restore: true, duplicate: true, remove: true}});
        expect((await surveys.readSurvey(id, actor(guest))).data.ownAnswers).toEqual({[choice.id]: 'no'});
    });

    it('keeps properties and archive owner-only without suspending participant ballots', async () => {
        const id = await fixture();
        await expect(surveys.patchSurveyMetadata(id, {title: 'Forbidden'}, actor(guest))).rejects.toMatchObject({status: 403});
        await expect(surveys.setSurveyArchived(id, true, actor(participant))).rejects.toMatchObject({status: 403});
        await surveys.patchSurveyMetadata(id, {title: 'Updated gathering', description: 'Owner details'}, actor(owner));
        await surveys.setSurveyArchived(id, true, actor(owner));
        expect((await surveys.readSurvey(id, actor(guest))).data).toMatchObject({title: 'Updated gathering', archived: true});
        const choice = (await surveys.readSurvey(id, actor(guest))).data.combinations[0]!;
        await surveys.submitSurveyBallot(id, {answers: {[choice.id]: 'yes'}}, actor(guest));
        await surveys.addSurveyCombination(id, {weekday: 'SUN', nthWeek: '4'}, actor(participant));
        expect((await surveys.readSurvey(id, actor(owner))).data.responses).toHaveLength(1);
        await surveys.setSurveyArchived(id, false, actor(owner));
        expect((await surveys.readSurvey(id, actor(owner))).data.archived).toBe(false);
    });

    it('deletes only for the owner and cascades survey choices and ballots', async () => {
        const id = await fixture();
        const choice = (await surveys.readSurvey(id, actor(guest))).data.combinations[0]!;
        await surveys.submitSurveyBallot(id, {answers: {[choice.id]: 'yes'}}, actor(guest));
        await expect(surveys.deleteSurvey(id, actor(guest))).rejects.toMatchObject({status: 403});
        expect(await surveyService.getSurveyById(id)).not.toBeNull();
        await surveys.deleteSurvey(id, actor(owner));
        expect(await surveyService.getSurveyById(id)).toBeNull();
        expect(await AppDataSource.getRepository(SurveyCombination).countBy({entity: {id}})).toBe(0);
        expect(await AppDataSource.getRepository(SurveyResponse).countBy({entity: {id}})).toBe(0);
    });
});
