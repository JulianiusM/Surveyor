const express = require('express');
const app = express.Router();

const db = require('../modules/db');
const {generateUniqueId} = require('../modules/util');
const renderer = require('../modules/renderer');
const {createGuestFlowRouter} = require("../modules/guestFlowFactory");

function hasManageRight(req, list) {
    return (req.session.user && req.session.user.id === list.owner_id)
        || (list.guest_manage && (req.session.guest || req.session.user));
}

/* ================================================================
   1) GENERISCHER GUEST-FLOW
   ================================================================ */
const core = createGuestFlowRouter({
    entityType: 'packing',

    /* ---- DB-Callbacks ------------------------------------------ */
    db: {
        getById: db.getPackingListById,
        registerGuest: db.registerGuest,      // (entity, id, username, email)
        getGuestInternal: db.getGuestInternal,
        getGuestByToken: db.getGuestByToken,
        getGuestLinkToken: db.getGuestLinkToken,
        createGuestLinkToken: db.createGuestLink,
    },

    /* ---- Templates --------------------------------------------- */
    templates: {
        create: 'packing/packing-create',
        guest: 'users/register-guest',
        view: 'packing/packing-view',
    },

    /* ---- Helper-Funktionen ------------------------------------- */
    buildRedirect: id => `/packing/${id}`,

    preprocessCreate(body) {
        let items;
        try {
            items = JSON.parse(body.items || '[]');
        } catch {
            items = [];
        }
        if (!body.title || items.length === 0) {
            return {
                error: {
                    msg: 'Title and at least one item required',
                    data: {title: body.title, items}
                }
            };
        }
        return {
            title: body.title,
            allow: Boolean(body.allowGuestAdd),
            guestManage: Boolean(body.guestManage),
            items,
        };
    },

    /*  ---- NEU: alles in einer Transaktion ---- */
    async createEntity(ownerId, p) {
        return db.createPackingListTx(
            ownerId,
            p.title,
            p.allow,
            p.guestManage,
            p.items.map((it, i) => ({
                id: generateUniqueId(),
                title: it.title,
                description: it.description || '',
                maxAssignees: Number(it.maxAssignees) || 1,
                requiredByAll: Boolean(it.requiredByAll),
                position: i,
            }))
        );
    },

    afterCreateItems: async () => {
    },   // entfällt — bereits in TX erledigt

    fetchForView: async (id, session) => {
        const list = await db.getPackingListById(id);
        if (!list) return null;
        const items = await db.getPackingItems(id);

        const assignments = session.user
            ? await db.getPackingAssignmentsForUser(id, session.user.id)
            : session.guest
                ? await db.getPackingAssignmentsForGuest(id, session.guest.id)
                : [];

        const assigneeLists = await db.getPackingItemAssignees(id);
        // Teilnehmer- und Offene-Zähler (ohne required_by_all-Items)
        const participantSet = new Set();
        let openCount = 0;
        let emptyCount = 0;

        items.forEach(it => {
            if (it.required_by_all) return;                      // überspringen
            const arr = assigneeLists[it.id] || [];
            arr.forEach(a => {
                let id;
                if (a.user_id) {
                    id = `u_${a.user_id}`;
                } else if (a.guest_id) {
                    id = `g_${a.guest_id}`;
                } else {
                    id = a.name;
                }
                participantSet.add(id);
            }); // id, fallback name
            if (it.assigned_count === 0) emptyCount++;
            if (it.assigned_count < it.max_assignees) openCount++;
        });

        const participantCount = participantSet.size;

        return {
            list,
            items,
            assignments,
            assigneeLists,
            counters: {participants: participantCount, open: openCount, empty: emptyCount}
        };
    },

    fetchForDuplicate: async (id, session) => {
        const list = await db.getPackingListById(id);
        if (!list) return null;
        const items = await db.getPackingItems(id);
        return {owner_id: list.owner_id, entity: list, items: items}
    },

    deleteEntity: async (id, session) => {
        const list = await db.getPackingListById(id);
        if (!list) return null;
        if (list.owner_id !== session.user.id)
            return {success: false, msg: "Not allowed"}

        try {
            await db.deletePackingList(list.id);
            return {success: true, msg: `Successfully deleted ${list.title}`};
        } catch (err) {
            return {success: false, msg: `Failed to delete: ${err.message}`};
        }
    }
});

app.use("/", core);

/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

app.post('/:id/assign', async (req, res) => {
    const {id: listId} = req.params;
    const {itemId} = req.body;

    try {
        if (req.session.user) await db.assignPackingItemToUser(itemId, req.session.user.id);
        else if (req.session.guest) await db.assignPackingItemToGuest(itemId, req.session.guest.id);
        else throw new Error('Session expired');

        renderer.respondWithSuccessJson(res, 'Item assigned');
    } catch (e) {
        renderer.respondWithErrorJson(res, e.message);
    }
});

app.post('/:id/unassign', async (req, res) => {
    const {id: listId} = req.params;
    const {itemId} = req.body;

    try {
        if (req.session.user) await db.unassignPackingItemUser(itemId, req.session.user.id);
        else if (req.session.guest) await db.unassignPackingItemGuest(itemId, req.session.guest.id);
        else throw new Error('Session expired');

        renderer.respondWithSuccessJson(res, 'Item unassigned');
    } catch (e) {
        renderer.respondWithErrorJson(res, e.message);
    }
});

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/reorder', async (req, res) => {
    const listId = req.params.id;
    const list = await db.getPackingListById(listId);
    if (!list) return renderer.respondWithErrorJson(res, 'List not found');

    /* 2) Besitzer? */
    if (!hasManageRight(req, list))
        return renderer.respondWithErrorJson(res, 'Only owner');

    /* 3) Reorder ausführen */
    try {
        await db.reorderPackingItems(listId, req.body.orders);
        renderer.respondWithSuccessJson(res, 'Order saved');
    } catch (e) {
        renderer.respondWithErrorJson(res, e.message);
    }
});

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/items', async (req, res) => {
    const listId = req.params.id;
    const list = await db.getPackingListById(listId);
    if (!list) return renderer.respondWithErrorJson(res, 'List not found');

    if (!hasManageRight(req, list) && !list.allow_guest_add)
        return renderer.respondWithErrorJson(res, 'Adding disabled');

    const {title, description, max} = req.body;
    if (!title) return renderer.respondWithErrorJson(res, 'Title required');

    await db.createPackingItem(listId, {
        id: generateUniqueId(),
        title,
        description: description || '',
        maxAssignees: Number(max) || 1,
        position: (await db.getPackingItems(listId)).length,
    });

    renderer.respondWithSuccessJson(res, 'Item added');
});

/* ───────────────── DESCRIPTION UPDATE ─────────────────────── */

app.post('/:id/item/:itemId/description', async (req, res) => {
    const {id: listId, itemId} = req.params;
    const {description} = req.body;

    const list = await db.getPackingListById(listId);
    if (!list) return renderer.respondWithErrorJson(res, 'List not found');

    if (!list.allow_guest_add && !hasManageRight(req, list))
        return renderer.respondWithErrorJson(res, 'Editing disabled');

    await db.updatePackingItem(itemId, {description});
    renderer.respondWithSuccessJson(res, 'Description updated');
});

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/item/:itemId/attr', async (req, res) => {
    const {id: listId, itemId} = req.params;
    const {field, value} = req.body;

    const allowed = {title: 1, description: 1, maxAssignees: 1};
    if (!allowed[field]) {
        return renderer.respondWithErrorJson(res, 'Invalid field');
    }

    const list = await db.getPackingListById(listId);
    if (!list) return renderer.respondWithErrorJson(res, 'List not found');
    if (!hasManageRight(req, list)) {
        return renderer.respondWithErrorJson(res, 'Only owner may edit');
    }

    await db.updatePackingItem(itemId, {[field]: value});
    renderer.respondWithSuccessJson(res, 'Item updated');
});

app.post('/:id/assignment/:assignId/delete', async (req, res) => {
    const listId = req.params.id;
    const assignId = req.params.assignId;

    // Besitzer-Check
    const list = await db.getPackingListById(listId);
    if (!list) return renderer.respondWithErrorJson(res, 'List not found');
    if (!hasManageRight(req, list))
        return renderer.respondWithErrorJson(res, 'Only owner may delete');

    await db.deletePackingAssignment(assignId);
    renderer.respondWithSuccessJson(res, 'Assignment removed');
});

/* Owner / guest-manager darf Flag umschalten ----------------------- */
app.post('/:id/item/:itemId/required', async (req, res) => {
    const {id: listId, itemId} = req.params;
    const {flag} = req.body;                    // true / false

    const list = await db.getPackingListById(listId);
    if (!list) return renderer.respondWithErrorJson(res, 'List not found');

    if (!hasManageRight(req, list))
        return renderer.respondWithErrorJson(res, 'Not allowed');

    await db.togglePackingItemRequiredByAll(itemId, flag);
    renderer.respondWithSuccessJson(res, 'Updated');
});

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', async (req, res) => {
    const listId = req.params.id;
    const list = await db.getPackingListById(listId);
    if (!list) return renderer.respondWithErrorJson(res, 'List not found');

    /* Nur Owner darf Flags ändern */
    if (!req.session.user || req.session.user.id !== list.owner_id)
        return renderer.respondWithErrorJson(res, 'Not allowed');

    const {allowAdd, guestManage} = req.body;
    await db.updatePackingFlags(listId, allowAdd, guestManage);
    renderer.respondWithSuccessJson(res, 'Settings saved');
});

app.post('/:id/item/:itemId/delete', async (req, res) => {
    const listId = req.params.id;
    const itemId = req.params.itemId;

    const list = await db.getPackingListById(listId);
    if (!list) return renderer.respondWithErrorJson(res, 'List not found');

    if (!hasManageRight(req, list))
        return renderer.respondWithErrorJson(res, 'Not allowed');

    await db.deletePackingItem(itemId);
    renderer.respondWithSuccessJson(res, 'Item deleted');
});

module.exports = app;
