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

import {Request} from "express";
import {assertEntityPropertyContext} from './entityAdminController';
import {applyPackingItemPatch, applyPackingMembership, createPackingItem, createPackingList, deletePackingAssignment, deletePackingItem,
    normalizePackingMetadataPatch, reorderPackingItems, requirePackingFieldValues, savePackingMetadata, setPackingHeader, setPackingSelfAssignment, updatePackingDefaults, updatePackingItem} from '../modules/packing/api';
import type {BasicEntityPropertyPatch} from '../types/EntityPropertyTypes';
import Joi from 'joi';
import type {ErrorObject} from 'ajv';
import {contractNativeStringLengthErrors, contractPathOrder, contractValidator} from '../modules/api/contracts';
import {ApiProblem} from '../modules/api/problem';
import {PackingItem} from "../modules/database/entities/packing/PackingItem";
import {PackingList} from "../modules/database/entities/packing/PackingList";

import * as packingService from '../modules/database/services/PackingService';
import {APIError, ValidationError} from '../modules/lib/errors';
import {performImageSwap, removeImage} from "../modules/lib/fileCommons";
import {ENTITIES, generateUniqueId} from "../modules/lib/util";
import {saveDefaultPermsFromBody} from "../modules/permissionEngine";
import {SessionLike} from "../types/PermissionTypes";
import type {EntityBase} from "../types/UserTypes";
import type {components} from '../types/api/v1';
import {PERM, toMaskFromBodyValue} from '../modules/lib/permissions';

// Template constant for create errors
const CREATE_TEMPLATE = 'packing/packing-create';
const METADATA_PATCH_SCHEMA = 'PackingMetadataPatch';

// Joi remains only as the established native transport scalar converter. The generated
// authored contract below owns object fields, optionality, types and domain constraints;
// there is deliberately no parallel Joi creation shape. These converters preserve Joi's
// decimal/exponent safety checks and case-insensitive true/false strings without broad
// Number() coercion (which would also accept hexadecimal and other new input forms).
const nativeNumberCoercion = Joi.number();
const nativeBooleanCoercion = Joi.boolean();

/** Convert an AJV JSON pointer to the human-readable labels used by the native form. */
function nativeFieldLabel(pointer: string): string {
    const parts = pointer.split('/').slice(1);
    let label = '';
    for (const part of parts) label += /^\d+$/.test(part) ? `[${part}]` : `${label ? '.' : ''}${part}`;
    return label || 'value';
}

/** Required and unknown fields need their own label instead of their containing object. */
function nativeErrorPointer(error: ErrorObject): string {
    if (error.keyword === 'required') return `${error.instancePath}/${String(error.params.missingProperty)}`;
    if (error.keyword === 'additionalProperties') return `${error.instancePath}/${String(error.params.additionalProperty)}`;
    return error.instancePath;
}

/** Preserve native field error wording while structural validation has one generated owner. */
function nativeValidationMessage(error: ErrorObject): string {
    const pointer = nativeErrorPointer(error);
    const label = `"${nativeFieldLabel(pointer)}"`;
    if (error.keyword === 'required') return `${label} is required`;
    if (error.keyword === 'minLength') return `${label} is not allowed to be empty`;
    if (error.keyword === 'maxLength') return `${label} length must be less than or equal to ${error.params.limit} characters long`;
    if (error.keyword === 'minProperties') return `${label} must have at least ${error.params.limit} key${error.params.limit === 1 ? '' : 's'}`;
    if (error.keyword === 'additionalProperties') return `${label} is not allowed`;
    if (error.keyword === 'minItems') return `${label} must contain at least ${error.params.limit} items`;
    if (error.keyword === 'minimum') return `${label} must be greater than or equal to ${error.params.limit}`;
    if (error.keyword === 'type') {
        // The native string rule explicitly allows null for metadata descriptions.
        // A rejected value still has the original "must be a string" diagnostic,
        // rather than exposing the generated validator's nullable type syntax.
        const type = String(error.params.type).split(',')[0]!;
        if (type === 'object') return `${label} must be of type object`;
        return `${label} must be ${type === 'integer' || type === 'array' || type === 'object' ? 'an' : 'a'} ${type}`;
    }
    if (pointer === '/event_id') return `${label} must be a valid GUID`;
    return `${label} ${error.message ?? 'is invalid'}`;
}

/** Normalize only legacy form scalars, retaining submitted item/title/description whitespace. */
function normalizeNativeItem(input: unknown, index: number, errors: Map<string, string>): unknown {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const item = {...input} as Record<string, unknown>;
    for (const [field, converter] of [['maxAssignees', nativeNumberCoercion], ['requiredByAll', nativeBooleanCoercion]] as const) {
        if (!Object.hasOwn(item, field)) continue;
        const result = converter.validate(item[field]);
        if (result.error) {
            const pointer = `/items/${index}/${field}`;
            errors.set(pointer, result.error.message.replace('"value"', `"${nativeFieldLabel(pointer)}"`));
        } else {
            item[field] = result.value;
        }
    }
    return item;
}

/** Compare source-owned schema order, retaining each row's order and each field's rule sequence. */
function compareContractErrorPaths(schema: string, left: string, right: string): number {
    const leftOrder = contractPathOrder(schema, left);
    const rightOrder = contractPathOrder(schema, right);
    for (let index = 0; index < Math.min(leftOrder.length, rightOrder.length); index++) {
        if (leftOrder[index] !== rightOrder[index]) return leftOrder[index]! - rightOrder[index]!;
    }
    return leftOrder.length - rightOrder.length;
}

function compareNativeErrorPaths(left: string, right: string): number {
    return compareContractErrorPaths('PackingNativeCreateInput', left, right);
}

function compareNativeMetadataErrorPaths(left: string, right: string): number {
    return compareContractErrorPaths(METADATA_PATCH_SCHEMA, left, right);
}

/**
 * Native property requests retain their established field diagnostics and APIError data.
 * Normalization and field declarations still come from the same operation and authored/generated
 * schema. Native strings retain Joi/HTML UTF-16 maximum counting; v1 keeps JSON Schema code-point
 * counting. This compatibility projection declares no second threshold. No persistence runs here.
 */
function prepareNativeMetadataPatch(body: unknown): components['schemas']['PackingMetadataPatch'] {
    const normalized = normalizePackingMetadataPatch(body);
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        // Joi's optional native fields counted an explicitly supplied undefined own key.
        // The legacy description adapter constructs that key even when JSON omits it.
        // Preserve it for generated validation, field authority and TypeORM's tracking-only
        // update; JSON v1 still rejects an empty patch through its separate input wrapper.
        for (const [key, value] of Object.entries(body)) {
            if (value === undefined) (normalized as Record<string, unknown>)[key] = value;
        }
    }
    const validator = contractValidator(METADATA_PATCH_SCHEMA);
    validator(normalized);
    const errors = [...validator.errors ?? [], ...contractNativeStringLengthErrors(METADATA_PATCH_SCHEMA, normalized)];
    if (!errors.length) return normalized as components['schemas']['PackingMetadataPatch'];

    const messages = new Map<string, string>();
    for (const error of errors) {
        const pointer = nativeErrorPointer(error);
        // Trimmed blank titles fail both minLength and the wire's nonblank pattern.
        // A maximum may also fail both counting rules. Native Joi reported each field
        // once; keep its first truthful diagnostic in the authored field order.
        if (!messages.has(pointer)) {
            // Undefined can reach trusted native callers even though JSON cannot
            // carry it. The original required object reports absence separately.
            messages.set(pointer, normalized === undefined ? '"value" is required' : nativeValidationMessage(error));
        }
    }
    const ordered = [...messages.keys()].sort(compareNativeMetadataErrorPaths);
    throw new APIError(ordered.map(pointer => messages.get(pointer)!).join('. '), {}, 400);
}

/** Decode native JSON rows, preserve form coercions/errors, then validate the authored native contract. */
function preprocessCreate(body: any): Omit<Partial<PackingList>, 'items' | 'eventId'> & {items: Partial<PackingItem>[]; eventId: string | null} {
    let items;
    try {
        items = JSON.parse(body.items || '[]');
    } catch {
        throw new ValidationError(CREATE_TEMPLATE, 'Invalid items JSON', {body});
    }

    const errors = new Map<string, string>();
    const decoded: Record<string, unknown> = {items};
    // Undefined native fields mean omitted; explicit null remains invalid even though
    // the distinct JSON API transport deliberately permits nullable descriptions.
    for (const field of ['title', 'description', 'event_id']) {
        if (body[field] !== undefined) decoded[field] = body[field];
    }
    if (Array.isArray(items)) {
        const normalized = [];
        for (let index = 0; index < items.length; index++) normalized.push(normalizeNativeItem(items[index], index, errors));
        decoded.items = normalized;
    }
    const validator = contractValidator('PackingNativeCreateInput');
    const messages = new Map<string, string[]>();
    for (const [pointer, message] of errors) messages.set(pointer, [message]);
    if (!validator(decoded)) {
        for (const error of validator.errors ?? []) {
            // Scalar conversion errors already preserve the original, more specific
            // wording (including unsafe numbers); anyOf's UUID branches describe one field.
            const pointer = nativeErrorPointer(error);
            if (errors.has(pointer)) continue;
            const message = nativeValidationMessage(error);
            const fieldMessages = messages.get(pointer) ?? [];
            // A UUID anyOf describes one native field failure. A non-string already
            // has its truthful native type message; branch failures must not add GUID errors.
            if (pointer === '/event_id' && fieldMessages.length) continue;
            if (!fieldMessages.includes(message)) fieldMessages.push(message);
            messages.set(pointer, fieldMessages);
        }
    }
    if (messages.size) {
        const ordered = [...messages.keys()].sort(compareNativeErrorPaths);
        const allMessages: string[] = [];
        for (const pointer of ordered) allMessages.push(...messages.get(pointer)!);
        throw new ValidationError(CREATE_TEMPLATE, allMessages.join(', '), {body});
    }
    const value = decoded as components['schemas']['PackingNativeCreateInput'];

    return {
        title: value.title,
        description: value.description || null,
        items: value.items,
        eventId: value.event_id || null,
    };
}

/** Native form normalization stays at this adapter; runtime creation uses the shared locked operation. */
async function createEntity(
    ownerId: string,
    listData: Omit<Partial<PackingList>, 'items' | 'eventId'> & {items: Partial<PackingItem>[]; eventId?: string | null; _body?: unknown; _file?: Express.Multer.File},
    session?: SessionLike,
) {
    if (session) {
        const defaults: components['schemas']['PermissionDefaults'] = {public: 0, guest: 0, authenticated: 0, participant: 0};
        const form = listData._body as {defaultPerms?: Partial<Record<keyof typeof defaults, unknown>>} | undefined;
        for (const audience of Object.keys(defaults) as (keyof typeof defaults)[]) {
            defaults[audience] = toMaskFromBodyValue(form?.defaultPerms?.[audience], PERM) ?? 0;
        }
        const body: components['schemas']['PackingCreateInput'] = {title: listData.title!, description: listData.description ?? null,
            eventId: listData.eventId ?? null, defaultPermissions: defaults,
            items: listData.items.map(item => ({title: item.title!, description: item.description || '',
                maxAssignees: Number(item.maxAssignees) || 1, requiredByAll: Boolean(item.requiredByAll)}))};
        try { return (await createPackingList(body, listData._file, session)).id; }
        catch (error) {
            // Admission can change while an upload waits for its parent lock. A rejected
            // command must discard its new file without touching another client's image.
            if (listData._file) removeImage(listData._file.path);
            throw error;
        }
    }
    // Internal fixture/migration hooks have an explicit trusted owner and no request actor.
    // They retain the same transaction-backed persistence rather than fabricating a session.
    return await packingService.createPackingListTx(
        ownerId,
        listData.title!,
        listData.description!,
        listData.items.map((it, i) => ({
            id: generateUniqueId(),
            title: it.title!,
            description: it.description || '',
            maxAssignees: Number(it.maxAssignees) || 1,
            requiredByAll: Boolean(it.requiredByAll),
            pos: i
        })),
        listData.eventId ?? undefined,
        listData.headerImg,
    );
}

/** Runtime creation commits defaults atomically; actor-free internal hooks retain their separate initialization. */
async function afterCreateItems(id: string, data: any, session?: SessionLike) {
    if (session) return;
    await saveDefaultPermsFromBody(ENTITIES.PACKING, id, data._body);
}

async function fetchForView(list: PackingList, req: Request) {
    const items = await packingService.getPackingItems(list.id);
    const session = req.session;

    let assignments = await packingService.getPackingAssignments(list.id, session.profile!.id);

    const assigneeLists = await packingService.getPackingItemAssignees(list.id);
    // Teilnehmer- und Offene-Zähler (ohne required_by_all-Items)
    const participantSet = new Set();
    let openCount = 0;
    let emptyCount = 0;

    items.forEach((it) => {
        if (it.requiredByAll) return;                      // überspringen
        const arr = assigneeLists[it.id] || [];
        arr.forEach((a) => {
            let id;
            if (a.profileId) {
                id = `p_${a.profileId}`;
            } else {
                id = a.name;
            }
            participantSet.add(id);
        }); // id, fallback name
        if (it.assignedCount === 0) emptyCount++;
        if (it.assignedCount < (it.maxAssignees ?? 0)) openCount++;
    });

    const participantCount = participantSet.size;

    return {
        list,
        items,
        assignments,
        assigneeLists,
        counters: {participants: participantCount, open: openCount, empty: emptyCount}
    };
}

async function fetchForDuplicate(list: PackingList, session: Request['session']) {
    return await packingService.getPackingItems(list.id);
}

async function deleteEntity(list: PackingList, session: Request['session']) {
    return await packingService.deletePackingList(list.id);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(id: string, body: any, expectedEventId?: string | null, session?: SessionLike) {
    const patch = prepareNativeMetadataPatch({description: body.description});
    const expectedValues = Object.hasOwn(body, 'expectedValue') ? {description: body.expectedValue} : undefined;
    if (session) await savePackingMetadata(id, patch, undefined, session, false, expectedEventId, expectedValues);
    else await saveProperties(id, patch, expectedEventId, expectedValues);
    return 'Description updated';
}

/** Normalize the native full-table order while sharing locked authority and row-set checks with v1. */
async function reorderItems(id: string, order: any, session?: SessionLike) {
    if (session) {
        if (!Array.isArray(order) || order.some(row => !row || typeof row.itemId !== 'string'
            || !Number.isInteger(row.position) || row.position < 0)
            || new Set(order.map(row => row.position)).size !== order.length) throw new APIError('Invalid packing item order', {}, 400);
        // The browser sends dense positions for every rendered row. Its array is transport data;
        // the common operation independently checks the current complete set under the root lock.
        const itemIds = [...order].sort((left, right) => left.position - right.position).map(row => row.itemId);
        await reorderPackingItems(id, {itemIds}, undefined, session, false);
    } else {
        // Trusted internal hooks preserve historical explicit/non-dense positions and have no actor.
        await packingService.reorderPackingItems(id, order);
    }
    return 'Order saved';
}

async function quickAddItem(list: PackingList, body: any, session: SessionLike) {
    const {title = '', description = '', maxAssignees = '1'} = body;
    if (!title) throw new APIError('Title required', body, 400);

    // Keep native coercion at its transport adapter; the common operation determines creator,
    // position, current authority and persistence while holding the same root lock as v1.
    const item: components['schemas']['PackingNewItem'] = {
        title,
        description,
        maxAssignees: Number(maxAssignees) || 1,
        requiredByAll: false,
    };
    await createPackingItem(list.id, item, session, false);
    return 'Item added';
}

async function updateItemDescription(itemId: string, body: any, listId?: string, session?: SessionLike) {
    await saveNativeItem(itemId, {description: body.description}, body, listId, session,
        Object.hasOwn(body, 'expectedValue') ? {description: body.expectedValue} : undefined);
    return 'Description updated';
}

async function updateItemAttr(itemId: string, body: any, listId?: string, session?: SessionLike) {
    const {field, value} = body;
    const allowed: Record<string, boolean> = {title: true, description: true, maxAssignees: true};

    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    await saveNativeItem(itemId, {[field]: value}, body, listId, session,
        Object.hasOwn(body, 'expectedValue') ? {[field]: body.expectedValue} : undefined);
    return 'Item updated';
}

async function updateRequired(itemId: string, body: any, listId?: string, session?: SessionLike) {
    const {flag} = body;
    await saveNativeItem(itemId, {requiredByAll: Boolean(flag)}, body, listId, session,
        Object.hasOwn(body, 'expectedValue') ? {requiredByAll: body.expectedValue} : undefined);
    return 'Requirement updated';
}

async function deleteAssignment(assignId: string, listId?: string, session?: SessionLike) {
    if (session && listId) await deletePackingAssignment(listId, assignId, session, false);
    else await packingService.deletePackingAssignment(assignId);
    return 'Assignment removed';
}

async function updateSettings(id: string, body: any, session?: SessionLike) {
    if (session) {
        const patch: components['schemas']['PermissionDefaultsPatch'] = {};
        for (const audience of ['public', 'guest', 'authenticated', 'participant'] as const) {
            const mask = toMaskFromBodyValue(body?.defaultPerms?.[audience], PERM);
            if (mask !== undefined) patch[audience] = mask;
        }
        await updatePackingDefaults(id, patch, session, undefined, false);
    } else await saveDefaultPermsFromBody(ENTITIES.PACKING, id, body);
    return 'Settings saved';
}

async function deleteItem(itemId: string, listId?: string, session?: SessionLike) {
    if (session && listId) await deletePackingItem(listId, itemId, session, false);
    else await packingService.deletePackingItem(itemId);
    return 'Item deleted';
}

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File, session?: SessionLike) {
    if (session) {
        try { await setPackingHeader(entity.id, file, session, undefined, false); }
        catch (error) {
            if (file) removeImage(file.path);
            throw error;
        }
    }
    else await performImageSwap(entity, packingService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase, session?: SessionLike) {
    if (session) await setPackingHeader(entity.id, undefined, session, undefined, false);
    else await performImageSwap(entity, packingService.updateHeaderImage);
    return 'Image deleted';
}

function getAssignmentAccessMapping() {
    return {
        assign: assignNativeItem,
        unassign: unassignNativeItem,
    };
}

async function assignNativeItem(body: any, profileId: string, req?: Request): Promise<void> {
    await changeNativeMembership(body.itemId, profileId, true, req);
}

async function unassignNativeItem(body: any, profileId: string, req?: Request): Promise<void> {
    await changeNativeMembership(body.itemId, profileId, false, req);
}

/**
 * The locked operation owns capacity and identity. Only its legacy transport adapter
 * restores the established data.itemId envelope; v1 keeps the typed params.itemId field.
 * Use the shared English message unchanged and never parse prose to recognize the cause.
 */
async function changeNativeMembership(itemId: string, profileId: string, assigned: boolean, req?: Request): Promise<void> {
    try {
        if (req) await setPackingSelfAssignment(String(req.params.id), itemId, assigned, req.session);
        else await assignItem(itemId, profileId, assigned);
    } catch (error) {
        if (error instanceof ApiProblem && error.code === 'PACKING_ITEM_FULL') {
            throw new APIError(error.message, {itemId}, error.status);
        }
        throw error;
    }
}

/**
 * Assignment policy belongs to the controller. Check the locked DB snapshot in this order:
 * absence is a 404, an existing assignment is an idempotent retry, then capacity constrains
 * a new assignment. The DBAL keeps the item lock until the approved insertion commits.
 */
async function assignItem(itemId: string, profileId: string, assigned: boolean): Promise<void> {
    await packingService.withPackingAssignmentLock(itemId, profileId, async function assignLocked(manager, item, existing, count) {
        if (!item) throw new APIError('Packing item not found', {itemId}, 404);
        await applyPackingMembership(manager, item, existing, count, assigned, profileId);
    });
}

/**
 * Native adapters share sparse persistence and item locking with v1, retaining their route-specific
 * outcomes. Unlike root properties, an undefined-only item patch never reached a DB update in the
 * original service; its controller returned a known 500 with the submitted body. Project that
 * outcome only after the common operation has rechecked current authority and comparison evidence.
 */
async function saveNativeItem(itemId: string, patch: components['schemas']['PackingItemPatch'], body: object, listId?: string, session?: SessionLike,
    expectedValues?: components['schemas']['PackingItemPatch']): Promise<void> {
    if (session && listId) {
        await updatePackingItem(listId, itemId, patch, undefined, session, false, expectedValues);
    } else {
        // Internal native hooks have no request actor. They still use the common locked operation
        // so a capacity change cannot race a membership insert or accidentally remove existing rows.
        await packingService.withPackingAssignmentLock(itemId, '', async function saveLocked(manager, item) {
            if (!item) throw new APIError('Unknown error while saving', body, 500);
            if (expectedValues) requirePackingFieldValues(item, expectedValues);
            await applyPackingItemPatch(manager, item, patch);
        });
    }
    if (Object.values(patch).every(value => value === undefined)) throw new APIError('Unknown error while saving', body, 500);
}

/**
 * Both the legacy description route and the property form use this controller boundary.
 * A parent change after route authorization must reject the whole patch, since permissions
 * might have come from registration in the old event. Keep that check under the root lock.
 */
async function saveProperties(id: string, patch: BasicEntityPropertyPatch, expectedEventId?: string | null,
    expectedValues?: components['schemas']['PackingMetadataPatch']): Promise<void> {
    await packingService.withPackingListLock(id, async function saveLocked(manager, current) {
        assertEntityPropertyContext(current, expectedEventId);
        if (expectedValues) requirePackingFieldValues(current!, expectedValues);
        await packingService.updatePackingListProperties(id, patch, manager);
    });
}

/** Normalize all submitted fields before acquiring a lock; omitted fields remain unchanged. */
async function updateProperties(entity: EntityBase, body: unknown, session?: SessionLike) {
    const fields = body && typeof body === 'object' && !Array.isArray(body) ? {...body} as Record<string, unknown> : null;
    const expected = fields?.expectedValues;
    if (fields) delete fields.expectedValues;
    if (expected !== undefined && (!expected || typeof expected !== 'object' || Array.isArray(expected))) throw new APIError('Invalid original property values', {}, 400);
    const patch = prepareNativeMetadataPatch(fields ?? body);
    const expectedValues = expected as components['schemas']['PackingMetadataPatch'] | undefined;
    if (expectedValues && Object.keys(expectedValues).some(field => !Object.hasOwn(patch, field))) throw new APIError('Invalid original property fields', {}, 400);
    if (session) await savePackingMetadata(entity.id, patch, undefined, session, false, entity.eventId ?? null, expectedValues);
    else await saveProperties(entity.id, patch, entity.eventId ?? null, expectedValues);
    return 'Properties updated';
}

export default {
    updateProperties,
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    updateDescription,
    reorderItems,
    quickAddItem,
    updateItemDescription,
    updateItemAttr,
    deleteAssignment,
    updateSettings,
    deleteItem,
    updateRequired,

    updateHeaderImg,
    deleteHeaderImg,

    getAssignmentAccessMapping,
}
