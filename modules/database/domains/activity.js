const {generateUniqueId} = require('../../lib/util');
const {init, db} = require('../pool');

/* ---------- Activity Planner ---------------------------------- */

// Plan
async function createActivityPlan(id, ownerId, title, desc, start_date, end_date, allowGuestAdd, guestManage) {
    init();
    await db().execute(
        `INSERT INTO activity_plans
         (id, owner_id, title, description, start_date, end_date, allow_guest_add, guest_manage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ownerId, title, desc, start_date, end_date, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
    );
}

async function createActivityPlanTx(ownerId, title, desc, start_date, end_date, allowGuestAdd, guestManage, slots) {
    init();
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();
        const id = generateUniqueId();
        await conn.execute(
            `INSERT INTO activity_plans
             (id, owner_id, title, description, start_date, end_date, allow_guest_add, guest_manage)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, ownerId, title, desc, start_date, end_date, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
        );
        if (slots.length) {
            const vals = slots.map(it => [generateUniqueId(), id, it.title, it.description, it.date, it.position, it.maxAssignees]);
            await conn.query(
                `INSERT INTO activity_slots
                     (id, plan_id, title, description, day, pos, max_assignees)
                 VALUES ?`,
                [vals]
            );
        }
        await conn.commit();
        return id;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function getActivityPlanById(id) {
    init();
    const [rows] = await db().execute('SELECT * FROM activity_plans WHERE id = ?', [id]);
    return rows[0];
}

async function deleteActivityPlan(id) {
    init();
    await db().execute(
        `DELETE
         FROM activity_plans
         WHERE id = ?`,
        [id]
    );
}

async function updateActivityPlanFlags(planId, allowAdd, guestManage) {
    init();
    await db().execute(
        `UPDATE activity_plans
         SET allow_guest_add = ?,
             guest_manage    = ?
         WHERE id = ?`,
        [allowAdd ? 1 : 0, guestManage ? 1 : 0, planId]
    );
}

async function getActivityPlansByUserId(userId) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM activity_plans
         WHERE owner_id = ?`,
        [userId]
    );
    return rows;
}

async function updateActivityPlanDescription(planId, description) {
    init();
    await db().execute(
        `UPDATE activity_plans
         SET description = ?
         WHERE id = ?`,
        [description, planId]
    )
}

// Slots
async function addActivitySlot(planId, slot) {
    /* slot = { id, planId, date, pos, title, description } */
    init();
    await db().query(
        `INSERT INTO activity_slots
             (id, plan_id, title, description, day, pos, max_assignees)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [slot.id, planId, slot.title, slot.description, slot.date, slot.position, slot.maxAssignees]
    );
}

async function addActivitySlots(planId, slots) {
    /* slot = { id, planId, date, pos, title, description } */
    init();
    const values = slots.map(s => [
        s.id, planId, s.date, s.position, s.title, s.description || '', s.maxAssignees
    ]);
    await db().query(
        `INSERT INTO activity_slots
             (id, plan_id, title, description, day, pos, max_assignees)
         VALUES ?`,
        [values]
    );
}

async function getActivitySlots(planId) {
    init();
    const [rows] = await db().execute(
        `SELECT s.*,
                COALESCE(ac.cnt, 0) AS assigned_count
         FROM activity_slots s
                  LEFT JOIN (SELECT slot_id, COUNT(*) AS cnt
                             FROM activity_assignments
                             WHERE plan_id = ?
                             GROUP BY slot_id) ac ON ac.slot_id = s.id
         WHERE s.plan_id = ?
         ORDER BY s.pos`,
        [planId, planId]);

    rows.forEach((row) => {
        row.date = row.day;
        row.position = row.pos;
    });

    // Group by date
    return Object.groupBy(rows, (res) => res.date);
}

async function updateActivitySlot(slotId, fields) {
    init();
    const sets = [], vals = [];
    for (const [col, val] of Object.entries({
        title: fields.title,
        description: fields.description,
        max_assignees: fields.maxAssignees,
        pos: fields.position
    })) {
        if (val !== undefined) {
            sets.push(`${col} = ?`);
            vals.push(val);
        }
    }
    if (!sets.length) return;
    vals.push(slotId);
    const res = await db().execute(
        `UPDATE activity_slots
         SET ${sets.join(', ')}
         WHERE id = ?`,
        vals
    );
    return res[0].affectedRows === 1;
}

async function deleteActivitySlot(slotId) {
    init();
    await db().execute(
        `DELETE
         FROM activity_slots
         WHERE id = ?`,
        [slotId]
    );
}

async function reorderActivitySlots(planId, order) {
    init();
    await Promise.all(order.map(o =>
        db().execute(
            `UPDATE activity_slots
             SET pos = ?
             WHERE id = ?
               AND plan_id = ?`,
            [o.position, o.slotId, planId]
        )
    ));
}

async function getLastActivitySlotNumber(planId, date) {
    init();
    const [rows] = await db().execute(
        `SELECT MAX(pos)
         FROM activity_slots
         WHERE plan_id = ?
           AND day = ?`,
        [planId, date]
    );
    return rows[0];
}

// Assignments
async function assignActivitySlotToUser(slotId, userId) {
    init();
    await db().execute(`INSERT IGNORE INTO activity_assignments (slot_id, user_id, plan_id)
                        SELECT ?, ?, plan_id
                        FROM activity_slots
                        WHERE id = ?`,
        [slotId, userId, slotId]);
}

async function unassignActivitySlotUser(slotId, userId) {
    init();
    await db().execute(
        `DELETE
         FROM activity_assignments
         WHERE slot_id = ?
           AND user_id = ?`,
        [slotId, userId]
    );
}

async function assignActivitySlotToGuest(slotId, guestId) {
    init();
    await db().execute(`INSERT IGNORE INTO activity_assignments (slot_id, guest_id, plan_id)
                        SELECT ?, ?, plan_id
                        FROM activity_slots
                        WHERE id = ?`,
        [slotId, guestId, slotId]);
}

async function unassignActivitySlotGuest(slotId, guestId) {
    init();
    await db().execute(
        `DELETE
         FROM activity_assignments
         WHERE slot_id = ?
           AND guest_id = ?`,
        [slotId, guestId]
    );
}

async function getActivitySlotAssignmentsForUser(planId, userId) {
    init();
    const [rows] = await db().execute(
        `SELECT slot_id
         FROM activity_assignments
         WHERE plan_id = ?
           AND user_id = ?`,
        [planId, userId]
    );
    return rows.map(r => r.slot_id);
}

async function getActivitySlotAssignmentsForGuest(planId, guestId) {
    init();
    const [rows] = await db().execute(
        `SELECT slot_id
         FROM activity_assignments
         WHERE plan_id = ?
           AND guest_id = ?`,
        [planId, guestId]
    );
    return rows.map(r => r.slot_id);
}

async function getActivitySlotAssignees(planId) {
    init();
    const [rows] = await db().execute(
        `SELECT pa.id      AS assign_id,
                pa.slot_id,
                u.username AS uname,
                g.username AS gname,
                pa.user_id,
                pa.guest_id
         FROM activity_assignments pa
                  LEFT JOIN users u ON u.id = pa.user_id
                  LEFT JOIN guests g ON g.id = pa.guest_id
         WHERE pa.plan_id = ?`,
        [planId]
    );
    const map = {};
    rows.forEach(r => {
        map[r.slot_id] = map[r.slot_id] || [];
        map[r.slot_id].push({
            id: r.assign_id,
            user_id: r.user_id,
            guest_id: r.guest_id,
            name: r.uname || r.gname || '—'
        });
    });
    return map;
}

async function deleteActivitySlotAssignment(assignId) {
    init();
    await db().execute(
        `DELETE
         FROM activity_assignments
         WHERE id = ?`,
        [assignId]
    );
}

module.exports = {
    createActivityPlan,
    createActivityPlanTx,
    getActivityPlanById,
    deleteActivityPlan,
    updateActivityPlanFlags,
    getActivityPlansByUserId,
    updateActivityPlanDescription,

    getActivitySlots,
    addActivitySlot,
    addActivitySlots,
    updateActivitySlot,
    deleteActivitySlot,
    reorderActivitySlots,
    getLastActivitySlotNumber,

    assignActivitySlotToUser,
    unassignActivitySlotUser,
    assignActivitySlotToGuest,
    unassignActivitySlotGuest,
    getActivitySlotAssignmentsForUser,
    getActivitySlotAssignmentsForGuest,
    getActivitySlotAssignees,
    deleteActivitySlotAssignment,
};
