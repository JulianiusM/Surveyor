/*
 * lib/assignRoutes.js
 */
const {asyncHandler} = require('../modules/lib/asyncHandler');
const renderer = require('../modules/renderer');
const {APIError} = require("../modules/lib/errors");

async function performAction(req, {actionUser, actionGuest}) {
    const userId = req.session.user?.id;
    const guestId = req.session.guest?.id;
    if (userId) await actionUser(req.body, userId);
    else if (guestId) await actionGuest(req.body, guestId);
    else throw new APIError('Unknown user', {}, 401);
}

module.exports = function attachAssignRoutes(router, {
    assignToUser,
    assignToGuest,
    unassignFromUser,
    unassignFromGuest
}) {
    router.post('/:id/assign', asyncHandler(async (req, res) => {
        await performAction(req, {actionUser: assignToUser, actionGuest: assignToGuest});
        renderer.respondWithSuccessJson(res, 'Assigned');
    }));

    router.post('/:id/unassign', asyncHandler(async (req, res) => {
        await performAction(req, {actionUser: unassignFromUser, actionGuest: unassignFromGuest});
        renderer.respondWithSuccessJson(res, 'Unassigned');
    }));
};
