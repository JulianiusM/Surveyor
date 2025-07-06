const express = require('express');
const app = express.Router();

const db = require('../modules/db');
const {generateUniqueId, fromISOtoLocal} = require('../modules/util');
const renderer = require('../modules/renderer');
const {createGuestFlowRouter} = require('../modules/guestFlowFactory')

function hasManageRight(req, plan) {
    return (req.session.user && req.session.user.id === plan.owner_id)
        || (plan.guest_manage && (req.session.guest || req.session.user));
}

function validDateStr(d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/* ================================================================
   1) GENERISCHER GUEST-FLOW
   ================================================================ */
const core = createGuestFlowRouter({
    entityType: 'activity',

    /* ---- DB-Callbacks ------------------------------------------ */
    db: {
        getById: db.getActivityPlanById,
        registerGuest: db.registerGuest,      // (entity, id, username, email)
        getGuestInternal: db.getGuestInternal,
        getGuestByToken: db.getGuestByToken,
        getGuestLinkToken: db.getGuestLinkToken,
        createGuestLinkToken: db.createGuestLink,
    },

    /* ---- Templates --------------------------------------------- */
    templates: {
        create: 'activity/activity-create',
        guest: 'users/register-guest',
        view: 'activity/activity-view',
    },

    /* ---- Helper-Funktionen ------------------------------------- */
    buildRedirect: id => `/activity/${id}`,

    preprocessCreate(body) {
        let slots;
        try {
            slots = JSON.parse(body.slots || {});
        } catch {
            slots = {};
        }

        if (!body.title || !body.start || !body.end || !slots) {
            return {
                error: {
                    msg: 'Title, start and end dates, and at least one slot required',
                    data: {body}
                }
            };
        }

        for (const [date, arr] of Object.entries(slots)) {
            if (!validDateStr(date))
                return {
                    error: {
                        msg: 'Invalid date key',
                        data: {body}
                    }
                };

            const d = fromISOtoLocal(date);
            if (d < fromISOtoLocal(body.start) || d > fromISOtoLocal(body.end))
                return {
                    error: {
                        msg: 'Slot outside range',
                        data: {body}
                    }
                };

            const posSet = new Set();
            arr.forEach(s => {
                if (posSet.has(s.position))
                    return {
                        error: {
                            msg: `Duplicate pos in ${date}`,
                            data: {body}
                        }
                    };
                posSet.add(s.position);

                if (!s.title || s.title.length > 255)
                    return {
                        error: {
                            msg: 'Invalid title',
                            data: {body}
                        }
                    };

                if (isNaN(s.maxAssignees) || s.maxAssignees < 1)
                    return {
                        error: {
                            msg: 'Invalid maxAssignees',
                            data: {body}
                        }
                    };
            });
        }

        return {
            title: body.title,
            start: body.start,
            end: body.end,
            allow: Boolean(body.allowGuestAdd),
            guestManage: Boolean(body.guestManage),
            slots: Object.values(slots).flat(),
        };
    },

    /*  ---- NEU: alles in einer Transaktion ---- */
    async createEntity(ownerId, p) {
        return db.createActivityPlanTx(
            ownerId,
            p.title,
            p.start,
            p.end,
            p.allow,
            p.guestManage,
            p.slots,
        );
    },

    afterCreateItems: async () => {
    },   // entfällt — bereits in TX erledigt

    fetchForView: async (id, session) => {
        const plan = await db.getActivityPlanById(id);
        if (!plan) return null;
        const slots = await db.getActivitySlots(plan.id);

        const assignments = session.user
            ? await db.getActivitySlotAssignmentsForUser(plan.id, session.user.id) // reuse helper
            : session.guest
                ? await db.getActivitySlotAssignmentsForGuest(plan.id, session.guest.id)
                : [];

        const assigneeLists = await db.getActivitySlotAssignees(id);
        // Teilnehmer- und Offene-Zähler (ohne required_by_all-Items)
        const participantSet = new Set();
        let openCount = 0;
        let emptyCount = 0;

        Object.values(slots).flat().forEach(it => {
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
            plan,
            slots,
            assignments,
            assigneeLists,
            counters: {participants: participantCount, open: openCount, empty: emptyCount}
        };
    },

    fetchForDuplicate: async (id, session) => {
        const plan = await db.getActivityPlanById(id);
        if (!plan) return null;
        const slots = await db.getActivitySlots(plan.id);
        return {owner_id: plan.owner_id, entity: plan, items: slots}
    },

    deleteEntity: async (id, session) => {
        const plan = await db.getActivityPlanById(id);
        if (!plan) return null;
        if (plan.owner_id !== session.user.id)
            return {success: false, msg: "Not allowed"}

        try {
            await db.deleteActivityPlan(plan.id);
            return {success: true, msg: `Successfully deleted ${plan.title}`};
        } catch (err) {
            return {success: false, msg: `Failed to delete: ${err.message}`};
        }
    }
});

app.use("/", core);

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

app.post('/:id/assign', async (req, res) => {
    const {id: planId} = req.params;
    const {slotId} = req.body;

    try {
        if (req.session.user) await db.assignActivitySlotToUser(slotId, req.session.user.id);
        else if (req.session.guest) await db.assignActivitySlotToGuest(slotId, req.session.guest.id);
        else throw new Error('Session expired');

        renderer.respondWithSuccessJson(res, 'Item assigned');
    } catch (e) {
        renderer.respondWithErrorJson(res, e.message);
    }
});

app.post('/:id/unassign', async (req, res) => {
    const {id: planId} = req.params;
    const {slotId} = req.body;

    try {
        if (req.session.user) await db.unassignActivitySlotUser(slotId, req.session.user.id);
        else if (req.session.guest) await db.unassignActivitySlotGuest(slotId, req.session.guest.id);
        else throw new Error('Session expired');

        renderer.respondWithSuccessJson(res, 'Item unassigned');
    } catch (e) {
        renderer.respondWithErrorJson(res, e.message);
    }
});

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/slot/reorder', async (req, res) => {
    const planId = req.params.id;
    const plan = await db.getActivityPlanById(planId);
    if (!plan) return renderer.respondWithErrorJson(res, 'Plan not found');

    /* 2) Besitzer? */
    if (!hasManageRight(req, plan))
        return renderer.respondWithErrorJson(res, 'Only owner');

    /* 3) Reorder ausführen */
    try {
        await db.reorderActivitySlots(planId, req.body.order);
        renderer.respondWithSuccessJson(res, 'Order saved');
    } catch (e) {
        renderer.respondWithErrorJson(res, e.message);
    }
});

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/slot/add', async (req, res) => {
    const planId = req.params.id;
    const plan = await db.getActivityPlanById(planId);
    if (!plan) return renderer.respondWithErrorJson(res, 'Plan not found');

    if (!hasManageRight(req, plan) && !plan.allow_guest_add)
        return renderer.respondWithErrorJson(res, 'Adding disabled');

    const {date, title = '', description = '', maxAssignees = 1} = req.body;
    const d = fromISOtoLocal(date);
    if (d < fromISOtoLocal(plan.start_date) || d > fromISOtoLocal(plan.end_date))
        return renderer.respondWithErrorJson(res, 'Date outside range');

    if (!title) return renderer.respondWithErrorJson(res, 'Title required');

    const lastSlotNr = Number(await db.getLastActivitySlotNumber(planId, d)) || 0;

    await db.addActivitySlot(planId, {
        id: generateUniqueId(),
        date: d,
        title,
        description: description || '',
        maxAssignees: Number(maxAssignees) || 1,
        position: lastSlotNr + 1,
    });

    renderer.respondWithSuccessJson(res, 'Slot added');
});

/* ───────────────── DESCRIPTION UPDATE ─────────────────────── */

app.post('/:id/slot/:slotId/description', async (req, res) => {
    const {id: planId, slotId} = req.params;
    const {description} = req.body;

    const plan = await db.getActivityPlanById(planId);
    if (!plan) return renderer.respondWithErrorJson(res, 'Plan not found');

    if (!plan.allow_guest_add && !hasManageRight(req, plan))
        return renderer.respondWithErrorJson(res, 'Editing disabled');

    await db.updateActivitySlot(slotId, {description});
    renderer.respondWithSuccessJson(res, 'Description updated');
});

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/slot/:slotId/attr', async (req, res) => {
    const {id: planId, slotId} = req.params;
    const {field, value} = req.body;

    const allowed = {title: 1, description: 1, maxAssignees: 1};
    if (!allowed[field]) {
        return renderer.respondWithErrorJson(res, 'Invalid field');
    }

    const plan = await db.getActivityPlanById(planId);
    if (!plan) return renderer.respondWithErrorJson(res, 'Plan not found');
    if (!hasManageRight(req, plan)) {
        return renderer.respondWithErrorJson(res, 'Only owner may edit');
    }

    if (await db.updateActivitySlot(slotId, {[field]: value})) {
        renderer.respondWithSuccessJson(res, 'Slot updated');
    } else {
        renderer.respondWithErrorJson(res, 'An unknown error has occured');
    }
});

app.post('/:id/assignment/:assignId/delete', async (req, res) => {
    const planId = req.params.id;
    const assignId = req.params.assignId;

    // Besitzer-Check
    const plan = await db.getActivityPlanById(planId);
    if (!plan) return renderer.respondWithErrorJson(res, 'Plan not found');
    if (!hasManageRight(req, plan))
        return renderer.respondWithErrorJson(res, 'Only owner may delete');

    await db.deleteActivitySlotAssignment(assignId);
    renderer.respondWithSuccessJson(res, 'Assignment removed');
});

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', async (req, res) => {
    const planId = req.params.id;
    const plan = await db.getActivityPlanById(planId);
    if (!plan) return renderer.respondWithErrorJson(res, 'Plan not found');

    /* Nur Owner darf Flags ändern */
    if (!req.session.user || req.session.user.id !== plan.owner_id)
        return renderer.respondWithErrorJson(res, 'Not allowed');

    const {allowAdd, guestManage} = req.body;
    await db.updateActivityPlanFlags(planId, allowAdd, guestManage);
    renderer.respondWithSuccessJson(res, 'Settings saved');
});

app.post('/:id/slot/:slotId/delete', async (req, res) => {
    const planId = req.params.id;
    const slotId = req.params.slotId;

    const plan = await db.getActivityPlanById(planId);
    if (!plan) return renderer.respondWithErrorJson(res, 'Plan not found');

    if (!hasManageRight(req, plan))
        return renderer.respondWithErrorJson(res, 'Not allowed');

    await db.deleteActivitySlot(slotId);
    renderer.respondWithSuccessJson(res, 'Slot deleted');
});

module.exports = app;
