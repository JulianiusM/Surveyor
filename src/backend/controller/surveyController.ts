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

import {hasAccountProfile} from './userController';
import {Request} from "express";
import {QueryFailedError} from 'typeorm';
import {
    archiveEntity, assertEntityPropertyContext, classifyArchiveCommandError, comparisonToken, entityTag,
    getArchivePresentations, getEntityPropertyPresentation, normalizeBasicProperties,
    requireEntityPropertyUpdate, restoreEntity,
} from './entityAdminController';
import Joi from 'joi';
import {Survey} from "../modules/database/entities/surveys/Survey";
import {SurveyCombination} from "../modules/database/entities/surveys/SurveyCombination";

import * as surveyService from "../modules/database/services/SurveyService";
import {ExpectedError, ValidationError} from "../modules/lib/errors";
import {checkNewImage, performImageSwap, removeImage} from "../modules/lib/fileCommons";
import {ApiProblem} from '../modules/api/problem';
import {getHeaderImageVersion} from '../modules/lib/util';
import {isOwner} from '../modules/permissionEngine';
import type {SessionLike} from '../../types/PermissionTypes';
import type {BasicEntityPropertyPatch} from '../../types/EntityPropertyTypes';
import type {components} from '../../types/api/v1';
import type {SurveyAnswer, SurveyMutationPreparation, WeekDay, WeekInMonth} from "../../types/SurveyTypes";
import type {EntityBase} from "../../types/UserTypes";

const CREATE_TEMPLATE = 'surveyor/survey-create';

function preprocessCreate(body: any): Partial<Survey> & { combinations: Partial<SurveyCombination>[] } {
    // 1) normalize combinations into an array of objects
    let combos = body.combinations;
    if (!combos) {
        combos = [];
    } else if (!Array.isArray(combos)) {
        // qs parsing gives an object with numeric keys
        combos = Object.values(combos);
    }

    // 2) declare Joi schema
    const schema = Joi.object({
        title: Joi.string().trim().required(),
        description: Joi.string().trim().allow('').required(),
        combinations: Joi.array()
            .items(
                Joi.object({
                    weekday: Joi.string()
                        .valid('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')
                        .required(),
                    week: Joi.alternatives()
                        .try(Joi.number().integer().min(1).max(4), Joi.string().valid('LAST'))
                        .required()
                })
            )
            .min(1)
            .required()
    });

    // 3) validate & throw on error
    const {error, value} = schema.validate(
        {
            title: body.title?.trim(),
            description: body.description?.trim(),
            combinations: combos
        },
        {abortEarly: false, allowUnknown: false}
    );

    if (error) {
        // Combine all messages into one
        const msg = error.details.map((d: any) => d.message).join(', ');
        // Throw a ValidationError to be caught by your centralized error handler
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    // 3) Normalize to entity types:
    //    week (number | 'LAST') -> nthWeek: WeekInMonth ('1' | '2' | '3' | '4' | 'LAST')
    const normalized: Partial<SurveyCombination>[] = value.combinations.map(
        (c: { weekday: WeekDay; week: number | 'LAST' }) => ({
            weekday: c.weekday,
            nthWeek: (typeof c.week === 'number' ? String(c.week) : c.week) as WeekInMonth,
        })
    );

    return {
        title: value.title,
        description: value.description || null,
        combinations: normalized,
    };
}

async function createEntity(
    ownerId: string,
    p: Partial<Survey> & { combinations: Partial<SurveyCombination>[] },
) {
    return surveyService.createSurveyTx(
        ownerId,
        p.title!,
        p.description!,
        p.combinations.map((it) => ({
            weekday: it.weekday!,
            week: it.nthWeek!,
        })),
        p.headerImg,
    );
}


async function afterCreateItems() {
    // Nothing to do here.
}

/** Preserve the independent read order for both presentation consumers. */
async function fetchForView(survey: Survey, req?: Request) {
    const combinations = await surveyService.getCombinationsBySurveyId(survey.id);
    const responses = await surveyService.getResponsesSorted(survey.id);
    return {survey, combinations, responses};
}

async function fetchForDuplicate(survey: Survey, session: SessionLike) {
    return await surveyService.getCombinationsBySurveyId(survey.id);
}

async function deleteEntity(survey: Survey, session: SessionLike) {
    return await surveyService.deleteSurvey(survey.id);
}

async function addCombination(survey: Survey, weekday: WeekDay, nth: WeekInMonth) {
    if (!weekday || !nth) throw new ExpectedError('Invalid selection', 'error', 400);
    await surveyService.addCombination(survey.id, weekday, nth);
}

/** Replace only the admitted profile's ballot through the existing delete/save
 * sequence. Validation precedes deletion; this operation deliberately retains its
 * established non-atomic persistence rather than promise concurrent replacement. */
async function submitResponses(survey: Survey, session: SessionLike, body: any) {
    const answers: { [p: string]: SurveyAnswer } = body;
    if (session.profile) {
        const gid = session.profile.id;
        // Validate every submitted choice against this survey before deleting any
        // prior answers. An omitted choice is absent from the replacement ballot.
        const combinations = await surveyService.getCombinationsBySurveyId(survey.id);
        const allowedCombinationIds = new Set(combinations.map((combination) => combination.id));
        const invalidEntry = Object.entries(answers).find(([combId, answer]) => {
            const parsedId = Number(combId);
            return !Number.isInteger(parsedId)
                || !allowedCombinationIds.has(parsedId)
                || !['yes', 'maybe', 'no', ''].includes(answer ?? '');
        });
        if (invalidEntry) {
            throw new ExpectedError('Invalid survey response', 'error', 400, {}, {cause: 'SURVEY_RESPONSE_INVALID'});
        }
        // Keep the persistence order and its independently saved rows.
        await surveyService.deleteResponsesByProfileId(gid, survey.id);
        for (const [combId, ans] of Object.entries(answers)) {
            await surveyService.saveResponse(survey.id, gid, Number(combId), ans);
        }
    }
}

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, surveyService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, surveyService.updateHeaderImage);
    return 'Image deleted';
}

/**
 * Surveys keep their owner-only authorization in the shared property controller. Normalize before
 * locking, then check existence under the lock so a concurrent deletion cannot report a false save.
 * The service receives a plain patch and transaction manager, never request-specific error policy.
 */
async function updateProperties(entity: EntityBase, body: unknown) {
    const patch = normalizeBasicProperties(body);
    await saveSurveyProperties(entity.id, patch);
    return 'Properties updated';
}

/** Both transports retain the existing property lock and persistence owner.
 * Versioned calls check the captured owner under that lock and build their
 * response from the same current row without a fallible postcommit read. */
async function saveSurveyProperties(id: string, patch: BasicEntityPropertyPatch, session?: SessionLike) {
    return surveyService.withSurveyLock(id, async function saveLocked(manager, current) {
        // Direct-call admission remains with its existing adapter. The added transport
        // checks its own actor against current ownership before the shared write.
        assertEntityPropertyContext(current);
        if (session) requireSurveyOwner(current as Survey, session);

        // Metadata tokens identify returned values for draft refresh only. They
        // are not write preconditions and do not change last-write behavior.
        const result = session ? surveyMetadataResult({...current, ...patch} as Survey, session) : undefined;
        await surveyService.updateSurveyProperties(id, patch, manager);
        return result;
    });
}

/** A captured account or registered guest profile is the survey participant. */
function requireSurveyProfile(session: SessionLike): string {
    if (!session.profile?.id) throw new ApiProblem('AUTH_REQUIRED');
    return session.profile.id;
}

/** Surveys deliberately use ownership, never a general administrator matrix. */
function requireSurveyOwner(survey: Survey, session: SessionLike): void {
    requireSurveyProfile(session);
    if (!isOwner(session, survey.ownerId)) throw new ApiProblem('FORBIDDEN');
}

/** Resolve a nullable DBAL read without exposing persistence details to callers. */
async function requireSurvey(id: string): Promise<Survey> {
    const survey = await surveyService.getSurveyById(id);
    if (!survey) throw new ApiProblem('NOT_FOUND');
    return survey;
}

/** Stored image references stay on the server; consumers get an admitted URL
 * and an opaque presentation version through the existing shared image helper. */
function surveyHeaderProjection(survey: Survey) {
    return {headerUrl: survey.headerImg ? `/api/v1/surveys/${encodeURIComponent(survey.id)}/header` : null,
        headerVersion: getHeaderImageVersion(survey.headerImg)};
}

/** Project named answers from the same shared reads as the voting projection.
 * Missing choices remain omitted and display No in the client. No profile email,
 * account identity, raw response handle or stored image path crosses this boundary. */
export async function readSurvey(id: string, session: SessionLike) {
    const profileId = requireSurveyProfile(session);
    const survey = await requireSurvey(id);
    const {combinations, responses} = await fetchForView(survey);

    // Keep one answer map per visible participant. The grouped query is
    // authoritative for names and grouping; no second ballot or results owner exists.
    const results: components['schemas']['SurveyResponseView'][] = [];
    for (const [respondentId, answers] of Object.entries(responses)) {
        const values: components['schemas']['SurveyBallotInput']['answers'] = {};
        for (const answer of answers) values[String(answer.combinationId)] = answer.answer ?? 'no';
        results.push({profileId: respondentId, name: answers[0].name, answers: values});
    }
    const data: components['schemas']['SurveyView'] = {
        entityType: 'survey', id, title: survey.title, description: survey.description ?? null,
        ...surveyHeaderProjection(survey), archived: Boolean(survey.archivedAt),
        combinations: combinations.map(combination => ({id: String(combination.id), weekday: combination.weekday, nthWeek: combination.nthWeek})),
        responses: results, ownAnswers: results.find(response => response.profileId === profileId)?.answers ?? {},
        profileName: session.profile!.name ?? '',
        capabilities: {manageSettings: isOwner(session, survey.ownerId), addCombination: true, submitBallot: true},
    };
    return {data, etag: entityTag('survey-view', {data, profileId})};
}

/** Account-only creation matches the creation form and its duplicate POST. */
export function requireSurveyCreation(session: SessionLike): void {
    requireSurveyProfile(session);
    if (!hasAccountProfile(session)) throw new ApiProblem('FORBIDDEN');
}

/** Decode the versioned recurring-choice names into the form parser,
 * then invoke its existing transactional creator. The shared operation alone owns
 * validation/normalization and persistence; this adapter adds no parent or ACLs. */
export async function createSurvey(body: components['schemas']['SurveyCreateInput'], file: Express.Multer.File | undefined, session: SessionLike): Promise<components['schemas']['SurveyCreated']> {
    requireSurveyCreation(session);
    checkNewImage(file);
    const parsed = preprocessCreate({...body, combinations: body.combinations.map(combination => ({weekday: combination.weekday, week: combination.nthWeek}))});

    // Only admitted upload bytes may supply a persisted path. Creation retains
    // the established transaction and has no fallible postcommit projection read.
    parsed.headerImg = file?.path;
    const id = await createEntity(requireSurveyProfile(session), parsed);
    return {id};
}

/** Duplicate reads retain the shared owner grant and copy only form content.
 * Ballots, header, owner, archival and any unrelated feature state are excluded. */
export async function readSurveyDuplicate(id: string, session: SessionLike): Promise<components['schemas']['SurveyDuplicate']> {
    const survey = await requireSurvey(id);
    requireSurveyOwner(survey, session);
    const combinations = await fetchForDuplicate(survey, session);
    return {title: survey.title, description: survey.description ?? null,
        combinations: combinations.map(combination => ({weekday: combination.weekday, nthWeek: combination.nthWeek}))};
}

/** Metadata refresh identity is independent from ballots and new combinations.
 * It supplies no optimistic write guarantee beyond the existing property owner. */
function surveyMetadataResult(survey: Survey, session: SessionLike) {
    const data: components['schemas']['SurveyMetadata'] = {
        entityType: 'survey', id: survey.id, values: {title: survey.title, description: survey.description ?? null},
        editableFields: ['title', 'description'], currentEventId: null, archived: Boolean(survey.archivedAt), inheritedArchived: false,
    };
    return {data, etag: entityTag('survey-meta', {data, profileId: session.profile!.id})};
}

/** Owner-only metadata reads contain only the fields rendered by that editor. */
export async function readSurveyMetadata(id: string, session: SessionLike) {
    const survey = await requireSurvey(id);
    requireSurveyOwner(survey, session);
    return surveyMetadataResult(survey, session);
}

/** Reuse form trim/clear semantics before the generated closed-shape validator. */
export function normalizeSurveyMetadataPatch(body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const patch = {...body} as Record<string, unknown>;
    if (typeof patch.title === 'string') patch.title = patch.title.trim();
    if (patch.description === '') patch.description = null;
    return patch;
}

/** Versioned property saves retain last-write behavior under its existing
 * root lock. No comparison token is accepted as authority or stale-write evidence. */
export async function patchSurveyMetadata(id: string, body: components['schemas']['SurveyMetadataPatch'], session: SessionLike) {
    const survey = await requireSurvey(id);
    await requireEntityPropertyUpdate('survey', survey, body, session);
    const patch = normalizeBasicProperties(body);
    return (await saveSurveyProperties(id, patch, session))!;
}

/** Compose the shared settings presentation with only applicable survey actions.
 * The lifecycle controller owns archive eligibility; no permission matrix, event
 * selector, automatic schedule or administrator list is disclosed or introduced. */
export async function readSurveySettings(id: string, session: SessionLike): Promise<components['schemas']['SurveySettings']> {
    const survey = await requireSurvey(id);
    requireSurveyOwner(survey, session);
    const properties = await getEntityPropertyPresentation('survey', survey, session);
    const archive = (await getArchivePresentations([{type: 'survey', id}], session)).get(`survey:${id}`)!;

    // Settings tokens describe the rendered image only. Header writes deliberately
    // retain their existing last-write behavior instead of adding a concurrency rule.
    return {id, title: survey.title, ...surveyHeaderProjection(survey),
        settingsToken: comparisonToken('survey-settings', id, session, {header: survey.headerImg ?? null}),
        editableFields: ['title', 'description'], currentEvent: null, access: null,
        capabilities: {editHeader: properties.canEditHeader, linkEvent: false, managePermissions: false,
            duplicate: properties.canDuplicate, remove: true, manageArchive: archive.canManage,
            archive: archive.canArchive, restore: archive.canRestore},
        archive: {direct: archive.directArchived, inherited: false, archivedAt: survey.archivedAt?.toISOString() ?? null,
            autoArchivePaused: false, eventUrl: null}};
}

/** Any admitted account or registered guest may extend the shared choices.
 * The finite generated input constrains transport and the existing unique
 * index remains authoritative, including a choice added after the caller read. */
export async function addSurveyCombination(id: string, body: components['schemas']['SurveyCombinationInput'], session: SessionLike,
    prepare?: SurveyMutationPreparation): Promise<components['schemas']['MutationResult']> {
    requireSurveyProfile(session);
    const survey = await requireSurvey(id);
    prepare?.({changed: true});
    try {
        await addCombination(survey, body.weekday, body.nthWeek);
    } catch (failure) {
        // This operation inserts only one generated-ID recurring choice. Its
        // duplicate-key rejection confirms that the weekday/occurrence already
        // exists; classify it without exposing driver text or adding a racy
        // precheck. Every other persistence failure retains normal uncertainty.
        if (failure instanceof QueryFailedError
            && (failure.driverError as Error & {code?: string}).code === 'ER_DUP_ENTRY') {
            throw new ApiProblem('SURVEY_COMBINATION_EXISTS');
        }
        throw failure;
    }
    return {changed: true};
}

/** Submit exactly this profile's supplied ballot through the shared
 * validator/replacement operation. Omitted choices and empty ballots retain their
 * existing meaning, and no stronger concurrent persistence guarantee is added. */
export async function submitSurveyBallot(id: string, body: components['schemas']['SurveyBallotInput'], session: SessionLike,
    prepare?: SurveyMutationPreparation): Promise<components['schemas']['MutationResult']> {
    requireSurveyProfile(session);
    const survey = await requireSurvey(id);
    prepare?.({changed: true});
    await submitResponses(survey, session, body.answers);
    return {changed: true};
}

/** Upload admission uses owner authority before bytes are written. Survey
 * settings expose the same owner method without adding a general ACL interface. */
export async function requireSurveyHeaderWrite(id: string, session: SessionLike): Promise<Survey> {
    const survey = await requireSurvey(id);
    requireSurveyOwner(survey, session);
    return survey;
}

/** Reuse the established image swap and cleanup lifecycle with its unchanged
 * write guarantees. There is no postcommit root read or speculative file removal. */
export async function setSurveyHeader(id: string, file: Express.Multer.File | undefined, session: SessionLike,
    prepare?: SurveyMutationPreparation): Promise<components['schemas']['MutationResult']> {
    const survey = await requireSurveyHeaderWrite(id, session);
    const changed = Boolean(file || survey.headerImg);
    prepare?.({changed});
    if (file) await updateHeaderImg(survey, file);
    else await deleteHeaderImg(survey);
    return {changed};
}

/** Header bytes remain inside the admitted detail-page boundary. */
export async function readSurveyHeaderPath(id: string, session: SessionLike): Promise<string> {
    requireSurveyProfile(session);
    const survey = await requireSurvey(id);
    if (!survey.headerImg) throw new ApiProblem('NOT_FOUND');
    return survey.headerImg;
}

/** Archive and restore retain the shared controller's locked owner checks,
 * idempotence and separation from permanent deletion and file retention. */
export async function setSurveyArchived(id: string, archived: boolean, session: SessionLike,
    prepare?: SurveyMutationPreparation): Promise<components['schemas']['MutationResult']> {
    requireSurveyProfile(session);
    try {
        // The existing lifecycle owner performs every decision and persistence
        // step; this adapter has no separate timestamp or automation policy.
        prepare?.({changed: true});
        if (archived) await archiveEntity({type: 'survey', id}, {}, session);
        else await restoreEntity({type: 'survey', id}, {}, session);
        return {changed: true};
    } catch (error) {
        throw classifyArchiveCommandError(error, archived);
    }
}

/** Delete through the original simple survey operation, then retire its header
 * using the same best-effort cleanup as shared deletion. Archive is independent. */
export async function deleteSurvey(id: string, session: SessionLike,
    prepare?: SurveyMutationPreparation): Promise<components['schemas']['MutationResult']> {
    const survey = await requireSurvey(id);
    requireSurveyOwner(survey, session);
    prepare?.({changed: true});
    await deleteEntity(survey, session);
    if (survey.headerImg) removeImage(survey.headerImg);
    return {changed: true};
}

export default {
    updateProperties,
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    addCombination,
    submitResponses,

    updateHeaderImg,
    deleteHeaderImg,
}
