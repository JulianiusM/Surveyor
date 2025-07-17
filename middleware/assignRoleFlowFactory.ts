/*
 * lib/assignRoutes.js
 */
const {asyncHandler} = require('../modules/lib/asyncHandler');
const renderer = require('../modules/renderer');
const {performAPIAction} = require("../modules/lib/util");

module.exports = function attachAssignRoleRoutes(router, {
    assignToUser,
    assignToGuest,
    unassignFromUser,
    unassignFromGuest
}) {
    router.post('/:id/take-role', asyncHandler(async (req, res) => {
        await performAPIAction(req, {actionUser: assignToUser, actionGuest: assignToGuest});
        renderer.respondWithSuccessJson(res, 'Assigned');
    }));

    router.post('/:id/leave-role', asyncHandler(async (req, res) => {
        await performAPIAction(req, {actionUser: unassignFromUser, actionGuest: unassignFromGuest});
        renderer.respondWithSuccessJson(res, 'Unassigned');
    }));
};
