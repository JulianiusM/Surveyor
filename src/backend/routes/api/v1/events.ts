import {Router} from 'express';
import type {components} from '../../../../types/api/v1';
import * as eventApi from '../../../controller/eventController';
import {createGuestFlowApiRouter} from '../../../middleware/guestFlowFactory';
import {eventFlow} from '../../eventFlow';
import {requireApiContext} from '../../../modules/api/session';
import {prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {createEntityAdminApiRouter, createEntityArchiveApiRouter, createUserSearchApiRouter} from '../../../middleware/adminApiFactory';
import {createEntityHeaderUpdateRouter} from '../../../middleware/entityHeaderUpdateHandler';
import financeRouter from './finance';

const router = Router();

router.use('/:eventId/finance', financeRouter);
router.use(createGuestFlowApiRouter(eventFlow));

/** Prepare the invariant completion before entering an irreversible shared delete. */
router.delete('/:eventId/things-to-do/:entityType/:entityId', asyncHandler(async function deleteEventChild(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deleteEventChild');
    const reply = prepareValidatedJson(req, 'deleteEventChild', 200, {changed: true});
    await eventApi.deleteEventChild(String(req.params.eventId), req.params.entityType as 'activity' | 'drivers' | 'packing',
        String(req.params.entityId), actor, req.query.view as 'detail' | 'admin' | undefined);
    sendPreparedJson(req, res, reply);
}));

router.get('/:eventId/metadata', asyncHandler(async function getEventMetadata(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventMetadata');
    const result = await eventApi.readEventMetadata(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'getEventMetadata', 200, result, result.editToken);
}));

router.patch('/:eventId/metadata', asyncHandler(async function updateEventMetadata(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateEventMetadata', eventApi.normalizeEventMetadataPatch);
    /** Capture the generated wire shape and edit header before its transaction commits. */
    function prepareMetadata(result: components['schemas']['EventMetadata']) {
        return {reply: prepareValidatedJson(req, 'updateEventMetadata', 200, result), etag: result.editToken};
    }
    const prepared = await eventApi.patchEventMetadata(String(req.params.eventId), req.body, req.get('If-Match'), actor, prepareMetadata);
    res.set('ETag', prepared.etag);
    sendPreparedJson(req, res, prepared.reply);
}));

router.get('/:eventId/settings', asyncHandler(async function getEventSettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getEventSettings');
    const result = await eventApi.readEventSettings(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'getEventSettings', 200, result);
}));

router.put('/:eventId/registration', asyncHandler(async function saveEventRegistration(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'saveEventRegistration');
    const result = await eventApi.saveEventRegistration(String(req.params.eventId), req.body, actor);
    sendValidatedJson(req, res, 'saveEventRegistration', 200, result);
}));

router.delete('/:eventId/registration', asyncHandler(async function cancelEventRegistration(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'cancelEventRegistration');
    const result = await eventApi.cancelEventRegistration(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'cancelEventRegistration', 200, result);
}));

router.get('/:eventId/participants', asyncHandler(async function getEventParticipants(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventParticipants');
    const result = await eventApi.readEventParticipants(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'getEventParticipants', 200, result);
}));

router.patch('/:eventId/registrations/:registrationId', asyncHandler(async function updateEventRegistrationDates(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateEventRegistrationDates');
    const result = await eventApi.editEventRegistration(String(req.params.eventId), String(req.params.registrationId), req.body, actor);
    sendValidatedJson(req, res, 'updateEventRegistrationDates', 200, result);
}));

router.delete('/:eventId/registrations/:registrationId', asyncHandler(async function removeEventRegistration(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'removeEventRegistration');
    const result = await eventApi.removeEventRegistration(String(req.params.eventId), String(req.params.registrationId), actor);
    sendValidatedJson(req, res, 'removeEventRegistration', 200, result);
}));

router.get('/:eventId/links', asyncHandler(async function listEventRegistrationLinks(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'listEventRegistrationLinks');
    const result = await eventApi.readEventRegistrationLinks(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'listEventRegistrationLinks', 200, result);
}));

router.post('/:eventId/links', asyncHandler(async function createEventRegistrationLink(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'createEventRegistrationLink');
    const result = await eventApi.addEventRegistrationLink(String(req.params.eventId), req.body, actor);
    sendValidatedJson(req, res, 'createEventRegistrationLink', 200, result);
}));

router.delete('/:eventId/links/:linkId', asyncHandler(async function revokeEventRegistrationLink(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'revokeEventRegistrationLink');
    const result = await eventApi.revokeEventRegistrationLink(String(req.params.eventId), String(req.params.linkId), actor);
    sendValidatedJson(req, res, 'revokeEventRegistrationLink', 200, result);
}));

router.get('/:eventId/things-to-do', asyncHandler(async function getEventThingsToDo(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getEventThingsToDo');
    const result = await eventApi.readEventThingsToDo(String(req.params.eventId), actor, req.query.view as 'detail' | 'admin' | undefined);
    sendValidatedJson(req, res, 'getEventThingsToDo', 200, result);
}));

router.get('/:eventId/default-permissions', asyncHandler(async function getEventDefaultsBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventDefaultsBaseline');
    const result = await eventApi.readEventDefaultsBaseline(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'getEventDefaultsBaseline', 200, result, result.editToken);
}));

router.put('/:eventId/default-permissions', asyncHandler(async function updateEventDefaults(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateEventDefaults');
    const result = await eventApi.updateEventDefaults(String(req.params.eventId), req.body, actor, req.get('If-Match'));
    sendValidatedJson(req, res, 'updateEventDefaults', 200, result);
}));

createEntityAdminApiRouter<'event'>(router, {
    entityType: 'event', parameter: 'eventId',
    baseline: {operation: 'getEventAdminBaseline', requireProfile: false,
        async read({id, profileId, actor}) {
            const data = await eventApi.readEventAdminBaseline(id, profileId, actor);
            return {data, etag: data.editToken};
        }},
    add: {operation: 'addEventAdmin', requireProfile: false, delivery: 'result',
        async execute({id, body, actor, ifMatch}) {
            return {data: await eventApi.setEventAdmin(id, body.profileId, body.mask, actor, ifMatch)};
        }},
    update: {operation: 'updateEventAdmin', requireProfile: false, delivery: 'result',
        async execute({id, profileId, body, actor, ifMatch}) {
            return {data: await eventApi.setEventAdmin(id, profileId, body.mask, actor, ifMatch)};
        }},
    remove: {operation: 'deleteEventAdmin', requireProfile: false, delivery: 'result',
        async execute({id, profileId, actor, ifMatch}) {
            return {data: await eventApi.setEventAdmin(id, profileId, null, actor, ifMatch)};
        }},
});

router.get('/:eventId/header/edit-baseline', asyncHandler(async function getEventHeaderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventHeaderBaseline');
    const result = await eventApi.readEventHeaderBaseline(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'getEventHeaderBaseline', 200, result, result.editToken);
}));

createEntityHeaderUpdateRouter(router, {
    parameter: 'eventId', uploadOperation: 'uploadEventHeader', deleteOperation: 'deleteEventHeader',
    requireProfile: false, admitUpload: eventApi.readEventHeaderBaseline,
    command: {
        receipt: 'after-write',
        execute({id, file, actor, ifMatch}) {
            return eventApi.setEventHeader(id, file, actor, ifMatch);
        },
    },
});

createEntityArchiveApiRouter<'event'>(router, {
    entityType: 'event', parameter: 'eventId',
    archive: {operation: 'archiveEvent', requireProfile: true, delivery: 'result',
        async execute({id, actor}) { return {data: await eventApi.setEventArchived(id, true, actor)}; }},
    restore: {operation: 'restoreEvent', requireProfile: true, delivery: 'result',
        async execute({id, actor}) { return {data: await eventApi.setEventArchived(id, false, actor)}; }},
    automatic: {operation: 'setEventAutomaticArchival', requireProfile: true, delivery: 'result',
        async execute({id, body, actor}) { return {data: await eventApi.setEventAutomaticArchival(id, body, actor)}; }},
});

createUserSearchApiRouter<'event'>(router, {
    entityType: 'event', parameter: 'eventId',
    search: {operation: 'searchEventProfiles', requireProfile: false,
        async read({id, query, actor}) {
            return {data: await eventApi.searchEventProfiles(id, String(query.q ?? ''), actor)};
        }},
});

router.post('/:eventId/things-to-do/:entityType/:entityId/archive', asyncHandler(async function archiveEventChild(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'archiveEventChild');
    const result = await eventApi.setEventChildArchived(String(req.params.eventId), req.params.entityType as 'activity' | 'drivers' | 'packing',
        String(req.params.entityId), true, actor, req.query.view as 'detail' | 'admin' | undefined);
    sendValidatedJson(req, res, 'archiveEventChild', 200, result);
}));

router.post('/:eventId/things-to-do/:entityType/:entityId/restore', asyncHandler(async function restoreEventChild(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'restoreEventChild');
    const result = await eventApi.setEventChildArchived(String(req.params.eventId), req.params.entityType as 'activity' | 'drivers' | 'packing',
        String(req.params.entityId), false, actor, req.query.view as 'detail' | 'admin' | undefined);
    sendValidatedJson(req, res, 'restoreEventChild', 200, result);
}));

router.put('/:eventId/things-to-do/:entityType/:entityId/automatic-archive', asyncHandler(async function setEventChildAutomaticArchival(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'setEventChildAutomaticArchival');
    const result = await eventApi.setEventChildAutomaticArchival(String(req.params.eventId), req.params.entityType as 'activity' | 'drivers' | 'packing',
        String(req.params.entityId), req.body, actor, req.query.view as 'detail' | 'admin' | undefined);
    sendValidatedJson(req, res, 'setEventChildAutomaticArchival', 200, result);
}));

export default router;
