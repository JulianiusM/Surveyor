/*
 * lib/assignRoutes.js
 */
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'asyncHandl... Remove this comment to see the full error message
const {asyncHandler} = require('../modules/lib/asyncHandler');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'renderer'.
const renderer = require('../modules/renderer');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'performAPI... Remove this comment to see the full error message
const {performAPIAction} = require("../modules/lib/util");

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = function attachAssignRoleRoutes(router: any, {
    assignToUser,
    assignToGuest,
    unassignFromUser,
    unassignFromGuest
}: any) {
    router.post('/:id/take-role', asyncHandler(async (req: any, res: any) => {
        await performAPIAction(req, {actionUser: assignToUser, actionGuest: assignToGuest});
        renderer.respondWithSuccessJson(res, 'Assigned');
    }));

    router.post('/:id/leave-role', asyncHandler(async (req: any, res: any) => {
        await performAPIAction(req, {actionUser: unassignFromUser, actionGuest: unassignFromGuest});
        renderer.respondWithSuccessJson(res, 'Unassigned');
    }));
};
