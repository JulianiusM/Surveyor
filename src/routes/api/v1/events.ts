import {Router, type NextFunction, type Request, type Response} from 'express';
import type {components} from '../../../types/api/v1';
import * as eventApi from '../../../controller/eventController';
import {ApiProblem} from '../../../modules/api/problem';
import {requireApiContext} from '../../../modules/api/session';
import {decodeApiMultipartData, decodeApiMultipartImage, prepareValidatedJson, receiveApiUpload, sendPreparedJson, sendStoredApiBinary, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {prepareFileUploader, removeImage} from '../../../modules/lib/fileCommons';
import {searchLimiter} from '../../../middleware/adminApiFactory';
import settings from '../../../modules/settings';
import financeRouter from './finance';

const router = Router();
const uploadHeader = prepareFileUploader(settings.value.headerImgDir).single('image');

router.use('/:eventId/finance', financeRouter);

/** Decode one generated multipart command without adding a second Event parser. */
router.post('/', asyncHandler(async function createEvent(req, res) {
    const actor = await requireApiContext(req, res, true);
    eventApi.requireEventCreation(actor);
    let enteredCreation = false;
    try {
        // Account admission precedes byte storage. Structural validation then
        // decodes only the data part, retaining unknown fields for rejection.
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'createEvent', body => decodeApiMultipartData(body, req.file));
        // The controller cleans native validation failures before creation. Once
        // its existing creation owner runs, an uploaded image may be committed.
        enteredCreation = true;
        const result = await eventApi.createEvent(req.body.data, req.file, actor);
        res.location(`/api/v1/events/${encodeURIComponent(result.id)}`);
        sendValidatedJson(req, res, 'createEvent', 201, result);
    } finally {
        if (!enteredCreation && req.file) removeImage(req.file.path);
    }
}));

/** Prepare the invariant completion before entering an irreversible shared delete. */
router.delete('/:eventId/things-to-do/:entityType/:entityId', asyncHandler(async function deleteEventChild(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deleteEventChild');
    const reply = prepareValidatedJson(req, 'deleteEventChild', 200, {changed: true});
    await eventApi.deleteEventChild(String(req.params.eventId), req.params.entityType as 'activity' | 'drivers' | 'packing',
        String(req.params.entityId), actor, req.query.view as 'detail' | 'admin' | undefined);
    sendPreparedJson(req, res, reply);
}));

router.get('/create-entry', asyncHandler(async function getEventCreateEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventCreateEntry');
    const result = eventApi.readEventCreateEntry(actor, req.query.returnTo);
    sendValidatedJson(req, res, 'getEventCreateEntry', 200, result);
}));

router.get('/create-context', asyncHandler(async function getEventCreateContext(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getEventCreateContext');
    const result = eventApi.readEventCreateContext(actor);
    sendValidatedJson(req, res, 'getEventCreateContext', 200, result);
}));

router.get('/:eventId/entry', asyncHandler(async function getEventResourceEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventResourceEntry');
    const result = await eventApi.readEventResourceEntry(String(req.params.eventId), req.query.view as 'detail' | 'guest' | 'admin', actor, req.query.regToken as string | undefined);
    sendValidatedJson(req, res, 'getEventResourceEntry', 200, result);
}));

router.get('/:eventId', asyncHandler(async function getEvent(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getEvent');
    const result = await eventApi.readEvent(String(req.params.eventId), actor, req.query.view as 'detail' | 'admin' | undefined);
    sendValidatedJson(req, res, 'getEvent', 200, result);
}));

router.get('/:eventId/duplicate', asyncHandler(async function getEventDuplicate(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventDuplicate');
    const result = await eventApi.readEventDuplicate(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'getEventDuplicate', 200, result);
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

router.get('/:eventId/admins/:profileId/edit-baseline', asyncHandler(async function getEventAdminBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventAdminBaseline');
    const result = await eventApi.readEventAdminBaseline(String(req.params.eventId), String(req.params.profileId), actor);
    sendValidatedJson(req, res, 'getEventAdminBaseline', 200, result, result.editToken);
}));

router.post('/:eventId/admins', asyncHandler(async function addEventAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'addEventAdmin');
    const result = await eventApi.setEventAdmin(String(req.params.eventId), req.body.profileId, req.body.mask, actor, req.get('If-Match'));
    sendValidatedJson(req, res, 'addEventAdmin', 200, result);
}));

router.patch('/:eventId/admins/:profileId', asyncHandler(async function updateEventAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateEventAdmin');
    const result = await eventApi.setEventAdmin(String(req.params.eventId), String(req.params.profileId), req.body.mask, actor, req.get('If-Match'));
    sendValidatedJson(req, res, 'updateEventAdmin', 200, result);
}));

router.delete('/:eventId/admins/:profileId', asyncHandler(async function deleteEventAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deleteEventAdmin');
    const result = await eventApi.setEventAdmin(String(req.params.eventId), String(req.params.profileId), null, actor, req.get('If-Match'));
    sendValidatedJson(req, res, 'deleteEventAdmin', 200, result);
}));

router.get('/:eventId/header/edit-baseline', asyncHandler(async function getEventHeaderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventHeaderBaseline');
    const result = await eventApi.readEventHeaderBaseline(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'getEventHeaderBaseline', 200, result, result.editToken);
}));

router.delete('/:eventId/header', asyncHandler(async function deleteEventHeader(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deleteEventHeader');
    const result = await eventApi.setEventHeader(String(req.params.eventId), undefined, actor, req.get('If-Match'));
    sendValidatedJson(req, res, 'deleteEventHeader', 200, result);
}));

router.post('/:eventId/archive', asyncHandler(async function archiveEvent(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'archiveEvent');
    const result = await eventApi.setEventArchived(String(req.params.eventId), true, actor);
    sendValidatedJson(req, res, 'archiveEvent', 200, result);
}));

router.post('/:eventId/restore', asyncHandler(async function restoreEvent(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'restoreEvent');
    const result = await eventApi.setEventArchived(String(req.params.eventId), false, actor);
    sendValidatedJson(req, res, 'restoreEvent', 200, result);
}));

router.delete('/:eventId', asyncHandler(async function deleteEvent(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deleteEvent');
    const result = await eventApi.removeEvent(String(req.params.eventId), actor);
    sendValidatedJson(req, res, 'deleteEvent', 200, result);
}));

/** Capture authoritative request context before the shared native search limiter can reject. */
async function admitEventProfileSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    await requireApiContext(req, res);
    validateOperationRequest(req, 'searchEventProfiles');
    next();
}

router.get('/:eventId/profiles', asyncHandler(admitEventProfileSearch), searchLimiter, asyncHandler(async function searchEventProfiles(req, res) {
    const result = await eventApi.searchEventProfiles(String(req.params.eventId), String(req.query.q ?? ''), req.apiActor!);
    sendValidatedJson(req, res, 'searchEventProfiles', 200, result);
}));

router.put('/:eventId/header', asyncHandler(async function uploadEventHeader(req, res) {
    const actor = await requireApiContext(req, res);
    // Reject forbidden writes before accepting bytes, then recheck under the controller's lock.
    await eventApi.readEventHeaderBaseline(String(req.params.eventId), actor);
    let committed = false;
    try {
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'uploadEventHeader', body => decodeApiMultipartImage(body, req.file));
        if (!req.file) throw new ApiProblem('UPLOAD_INVALID');
        const result = await eventApi.setEventHeader(String(req.params.eventId), req.file, actor, req.get('If-Match'));
        committed = true;
        sendValidatedJson(req, res, 'uploadEventHeader', 200, result);
    } finally {
        // Delivery failure after persistence must not remove the committed upload.
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

router.get('/:eventId/header', asyncHandler(async function getEventHeader(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getEventHeader');
    const storedPath = await eventApi.readEventHeaderPath(String(req.params.eventId), actor);
    await sendStoredApiBinary(req, res, 'getEventHeader', 200, settings.value.headerImgDir, storedPath);
}));

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

router.put('/:eventId/automatic-archive', asyncHandler(async function setEventAutomaticArchival(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'setEventAutomaticArchival');
    const result = await eventApi.setEventAutomaticArchival(String(req.params.eventId), req.body, actor);
    sendValidatedJson(req, res, 'setEventAutomaticArchival', 200, result);
}));

router.put('/:eventId/things-to-do/:entityType/:entityId/automatic-archive', asyncHandler(async function setEventChildAutomaticArchival(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'setEventChildAutomaticArchival');
    const result = await eventApi.setEventChildAutomaticArchival(String(req.params.eventId), req.params.entityType as 'activity' | 'drivers' | 'packing',
        String(req.params.entityId), req.body, actor, req.query.view as 'detail' | 'admin' | undefined);
    sendValidatedJson(req, res, 'setEventChildAutomaticArchival', 200, result);
}));

export default router;
