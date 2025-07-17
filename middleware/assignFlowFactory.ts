/*
 * lib/assignRoutes.js
 */
const {asyncHandler} = require('../modules/lib/asyncHandler');
const renderer = require('../modules/renderer');
const {performAPIAction} = require('../modules/lib/util');

module.exports = function attachAssignRoutes(router, {
    assignToUser,
    assignToGuest,
    unassignFromUser,
    unassignFromGuest
}) {
    router.post('/:id/assign', asyncHandler(async (req, res) => {
        await performAPIAction(req, {actionUser: assignToUser, actionGuest: assignToGuest});
        renderer.respondWithSuccessJson(res, 'Assigned');
    }));

    router.post('/:id/unassign', asyncHandler(async (req, res) => {
        await performAPIAction(req, {actionUser: unassignFromUser, actionGuest: unassignFromGuest});
        renderer.respondWithSuccessJson(res, 'Unassigned');
    }));
};
