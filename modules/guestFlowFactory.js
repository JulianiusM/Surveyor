// ===========================================================
// guestFlowFactory.js  (NEU)
// -----------------------------------------------------------
// Factory erzeugt einen Router mit den Standard‑Routen
//   • /create                     (GET, POST)
//   • /:id/guest                  (GET, POST)
//   • /:id/edit/:token            (GET)
//   • /:id  (SAFE‑ZONE middleware + GET View)
//   – Gemeinsam für 'survey', 'packing', …
// -----------------------------------------------------------
const express = require('express');
const renderer = require('../modules/renderer');
const {isAuthenticated} = require('../modules/util');
const mailer = require('../modules/email');
const settings = require('../modules/settings');

function buildGuestLink(entityType, entityId, token) {
    return `${settings.rootUrl}/${entityType}/${entityId}/edit/${token}`;
}

/**
 * @param {Object} cfg
 *   entityType        'survey' | 'packing'
 *   db                reference auf DB‑Modul (muss passende CRUDs liefern)
 *   app               Router to use
 *   templates         { create, guest, view }
 *   buildRedirect     fn(id) → string  (z. B. `/survey/${id}`)
 *   preprocessCreate  fn(reqBody) → { title, items, extras… }
 *   createEntity      fn(ownerId, parsedBody) → Promise<entityId>
 *   afterCreateItems  fn(entityId, parsedBody) → Promise<void>
 *   fetchForView      fn(id) → Promise<{ entity, items, assignments }>
 *   fetchForDuplicate fn(id) -> Promise<{owner_id, entity, items}>
 *   deleteEntity      fn(entityId, session) -> Promise<{success: boolean, msg}>
 */
function createGuestFlowRouter(cfg) {
    let app = cfg.app;
    if (!app) {
        app = express.Router();
    }
    const t = cfg.templates;

    /* ───── /create (GET) ───── */
    app.get('/create', isAuthenticated, (_, res) =>
        renderer.render(res, t.create)
    );

    /* ───── /create (POST) ───── */
    app.post('/create', isAuthenticated, async (req, res) => {
        const parsed = cfg.preprocessCreate(req.body);
        if (parsed.error) {
            return renderer.renderWithErrorData(res, t.create, parsed.error.msg, parsed.error.data);
        }

        try {
            const id = await cfg.createEntity(req.session.user.id, parsed);
            await cfg.afterCreateItems(id, parsed);
            req.flash('success', `${cfg.entityType} created`);
            res.redirect(cfg.buildRedirect(id));
        } catch (e) {
            renderer.renderWithErrorData(res, t.create, e.message, parsed);
        }
    });

    /* ───── /:id/guest (GET) ───── */
    app.get('/:id/guest', async (req, res) => {
        const entity = await cfg.db.getById(req.params.id);
        if (!entity) return renderer.renderError(res, `${cfg.entityType} not found`);
        renderer.renderWithData(res, t.guest, {
            entityType: cfg.entityType,
            entityId: entity.id,
            title: entity.title,
        });
    });

    /* ───── /:id/guest (POST) ───── */
    app.post('/:id/guest', async (req, res) => {
        const entityId = req.params.id;
        const entity = await cfg.db.getById(entityId);
        if (!entity) return renderer.renderError(res, `${cfg.entityType} not found`);

        const {username, email} = req.body;
        if (!username) {
            req.flash('error', 'Username required');
            return renderer.renderWithData(res, t.guest, {
                entityType: cfg.entityType, entityId, title: entity.title,
            });
        }

        const {guestId, token} = await cfg.db.registerGuest(cfg.entityType, entityId, username, email);
        req.session.guest = await cfg.db.getGuestInternal(guestId);

        const link = buildGuestLink(cfg.entityType, entityId, token);
        if (email) await mailer.sendLinkEmail(email, link);

        req.flash('success', `Login successful. Use ${link} to edit later.`);
        res.redirect(cfg.buildRedirect(entityId));
    });

    /* ───── /:id/edit/:token (GET) ───── */
    app.get('/:id/edit/:token', async (req, res) => {
        const {id: entityId, token} = req.params;
        const link = await cfg.db.getGuestByToken(token);
        if (!link || link.entity_type !== cfg.entityType || link.entity_id !== entityId) {
            return renderer.renderError(res, 'Invalid or mismatched token');
        }
        req.session.user = undefined;
        req.session.guest = {id: link.id, username: link.username, email: link.email};
        req.flash('info', 'Switched to guest edit');
        res.redirect(cfg.buildRedirect(entityId));
    });

    app.get('/:id/duplicate', isAuthenticated, async (req, res) => {
        const data = await cfg.fetchForDuplicate(req.params.id, req.session);
        if (!data) return renderer.renderError(res, `${cfg.entityType} not found`);

        if (data.owner_id !== req.session.user.id)
            return renderer.renderError(res, 'Not allowed');

        renderer.renderWithData(
            res,
            t.create,
            {
                title: `Copy of ${data.entity.title}`,
                entity: data.entity,
                items: data.items,
                isDuplicate: true
            }
        );
    });

    app.post('/:id/delete', isAuthenticated, async (req, res) => {
        const resp = await cfg.deleteEntity(req.params.id, req.session);
        if (!resp) return renderer.renderError(res, `${cfg.entityType} not found`);
        if (!resp.success) return renderer.renderError(res, resp.msg);

        req.flash('success', resp.msg);
        res.redirect('/users/dashboard');
    });

    /* ───── SAFE‑ZONE + View ───── */
    app.use('/:id', async (req, res, next) => {
        const entityId = req.params.id;

        /* 1) Registrierte User dürfen immer weiter  */
        if (req.session.user) return next();

        /* 2) Gast-Session vorhanden? → Link-Check */
        if (req.session.guest) {
            const guest = req.session.guest;

            // Hat der Gast bereits einen Token für diese Pack-Liste?
            let token = await cfg.db.getGuestLinkToken(cfg.entityType, entityId, guest.id);

            // Falls nicht: neuen Link generieren + optional Mail senden
            if (!token) {
                token = await cfg.db.createGuestLink(cfg.entityType, entityId, guest.id);

                const link = buildGuestLink(cfg.entityType, entityId, token);
                req.flash('success', `Login successful. Use ${link} to edit later.`);

                if (guest.email) {
                    await mailer.sendLinkEmail(guest.email, link);
                }
            }
            return next();
        }

        /* 3) Keine Session → Gast-Registrierung */
        req.flash('info', 'Register as a guest to participate');
        res.redirect(`${cfg.buildRedirect(entityId)}/guest`);
    });

    app.get('/:id', async (req, res) => {
        const data = await cfg.fetchForView(req.params.id, req.session);
        if (!data) return renderer.renderError(res, `${cfg.entityType} not found`);
        renderer.renderWithData(res, t.view, data);
    });

    return app;
}

module.exports = {createGuestFlowRouter};
