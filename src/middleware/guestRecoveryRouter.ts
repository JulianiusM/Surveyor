import express, {Request, Response} from 'express';

import renderer from '../modules/renderer';
import mailer from '../modules/email';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {ValidationError} from '../modules/lib/errors';
import {paramHandler} from './paramHandler';
import {getResource} from '../modules/lib/util';
import {buildGuestLink} from '../modules/lib/guestLinks';
import * as userService from '../modules/database/services/UserService';
import type {GuestRecoveryConfig, GuestRecoveryDb} from '../types/UserTypes';

function initConfig(): GuestRecoveryDb {
    return {
        getById: () => {
            throw new Error('getById not implemented');
        },
        getGuestLinksForEntityByEmail: userService.getGuestLinksForEntityByEmail,
    };
}

export function createGuestRecoveryRouter(cfg: GuestRecoveryConfig) {
    const {entityType, buildRedirect, db = {}}: GuestRecoveryConfig = cfg;
    const {getById, getGuestLinksForEntityByEmail}: GuestRecoveryDb = Object.assign(initConfig(), db);
    const router = express.Router();
    const resFct = (req: Request) => getResource(req, entityType);

    paramHandler('id', router, getById, entityType);

    router.route('/:id/guest/recover')
        .get(asyncHandler(async (req: Request, res: Response) => {
            const {id, title} = resFct(req);
            renderer.renderWithData(res, 'users/recover-guest-links', {
                entityType,
                entityId: id,
                title,
                email: String(req.query.email || ''),
            });
        }))
        .post(asyncHandler(async (req: Request, res: Response) => {
            const {id, title} = resFct(req);
            const email = String(req.body.email || '').trim();
            if (!email) {
                throw new ValidationError('users/recover-guest-links', 'E-mail is required', {
                    entityType,
                    entityId: id,
                    title,
                    email,
                });
            }

            const links = await getGuestLinksForEntityByEmail(entityType, id, email);
            if (links.length > 0) {
                const fullLinks = links.map((link) => buildGuestLink(link.entityType, link.entityId, link.token));
                await mailer.sendGuestRecoveryEmail(email, fullLinks);
            }
            req.flash('success', 'If a guest account with this e-mail exists, the recovery links have been sent.');
            res.redirect(`${buildRedirect(id)}/guest`);
        }));

    return router;
}
