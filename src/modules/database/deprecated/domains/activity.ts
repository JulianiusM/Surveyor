import {generateUniqueId} from '../../../lib/util';

import {db, init} from '../pool';
import {RowDataPacket} from "mysql2";

/* ------------------------------------------------------------------ *
 *  low‑level helpers                                                *
 * ------------------------------------------------------------------ */

/**
 * Ensure a role exists and return its id. Creates the role lazily if it
 * is missing so that the API stays idempotent for new feature flags.
 *
 * @param {object} conn      – an open mysql2/promise connection
 * @param {string} roleName  – e.g. "default", "chef", "moderator"
 * @returns {Promise<number>} role_id
 */
export async function ensureRoleId(conn: any, roleName = 'default') {
    const [[row]] = await conn.execute(
        'SELECT id FROM roles WHERE name = ? LIMIT 1',
        [roleName]
    );
    if (row) return row.id;

    // create lazily (you may prefer a bootstrap‑script instead)
    const [res] = await conn.execute(
        'INSERT INTO roles (name, is_default) VALUES (?, ?)',
        [roleName, roleName === 'default' ? 1 : 0]
    );
    return res.insertId;
}

/**
 * Obtain the assignment_id for a slot/user/guest triple, inserting a new
 * activity_assignments row on demand.  The statement mirrors the former
 * INSERT IGNORE, but lets us capture LAST_INSERT_ID() safely even when
 * the row already existed.
 *
 * @param {object}  conn      – mysql2/promise connection
 * @param {string}  slotId
 * @param {number}  userId
 * @param {number}  guestId   – pass null for users, nullish for guests
 * @returns {Promise<number>} assignment_id
 */
export async function ensureAssignment(conn: any, slotId: any, userId: number | null = null, guestId: number | null = null): Promise<number> {
    if (!slotId) throw new Error('slotId is required');

    const isUser = userId !== null && userId !== undefined;
    const assigneeCol = isUser ? 'user_id' : 'guest_id';
    const assigneeVal = isUser ? userId : guestId;

    if (assigneeVal === null || assigneeVal === undefined) {
        throw new Error('Either userId or guestId must be provided');
    }

    // The trick: ON DUPLICATE KEY … LAST_INSERT_ID keeps existing id.
    const [res] = await conn.execute(
        `INSERT INTO activity_assignments (slot_id, ${assigneeCol}, plan_id)
         SELECT ?, ?, plan_id
         FROM activity_slots
         WHERE id = ?
         ON DUPLICATE KEY UPDATE activity_assignments.id = LAST_INSERT_ID(activity_assignments.id)`,
        [slotId, assigneeVal, slotId]
    );
    return res.insertId; // existing id if row already present
}

export async function assignRole(conn: any, assignmentId: any, roleName: any) {
    await conn.execute(
        'INSERT IGNORE INTO activity_assignment_roles (assignment_id, role_id) VALUES (?, ?)',
        [assignmentId, await ensureRoleId(conn, roleName)]
    );

    // Ensure that default role is always set
    /*if (roleName !== 'default') {
        conn.execute(
            `INSERT IGNORE INTO activity_assignment_roles (assignment_id, role_id)
             VALUES (?, ?)`,
            [assignmentId, await ensureRoleId(conn, 'default')]
        );
    }*/
}

export async function doUnassignRole(conn: any, assRow: any, roleName: any) {
    if (!assRow) {
        await conn.rollback();
        return false; // nothing to delete
    }

    // 2. Resolve role_id (ignore if unknown ⇒ nothing to delete)
    const [[roleRow]] = await conn.execute(
        'SELECT id FROM roles WHERE name = ? LIMIT 1',
        [roleName]
    );
    if (!roleRow) {
        await conn.rollback();
        return false;
    }

    // 3. Delete link row
    await conn.execute(
        'DELETE FROM activity_assignment_roles WHERE assignment_id = ? AND role_id = ?',
        [assRow.id, roleRow.id]
    );

    // 4. If assignment now has zero roles or default role was removed, delete it entirely
    const [[cntRow]] = await conn.execute(
        'SELECT COUNT(*) AS cnt FROM activity_assignment_roles WHERE assignment_id = ?',
        [assRow.id]
    );
    if (cntRow.cnt === 0 || roleName === 'default') {
        await conn.execute('DELETE FROM activity_assignments WHERE id = ?', [assRow.id]);
    }
}

/* ---------- Activity Planner ---------------------------------- */

// Plan
export async function createActivityPlan(id: any, ownerId: any, title: any, desc: any, start_date: any, end_date: any, allowGuestAdd: any, guestManage: any) {
    init();
    await db().execute(
        `INSERT INTO activity_plans
         (id, owner_id, title, description, start_date, end_date, allow_guest_add, guest_manage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ownerId, title, desc, start_date, end_date, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
    );
}

export async function createActivityPlanTx(ownerId: any, title: any, desc: any, start_date: any, end_date: any, allowGuestAdd: any, guestManage: any, slots: any) {
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
            const vals = slots.map((it: any) => [generateUniqueId(), id, it.title, it.description, it.date, it.position, it.maxAssignees]);
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

export async function getActivityPlanById(id: any) {
    init();
    const [rows] = await db().execute('SELECT * FROM activity_plans WHERE id = ?', [id]);
    return (rows as RowDataPacket[])[0];
}

export async function deleteActivityPlan(id: any) {
    init();
    await db().execute(
        `DELETE
         FROM activity_plans
         WHERE id = ?`,
        [id]
    );
}

export async function updateActivityPlanFlags(planId: any, allowAdd: any, guestManage: any) {
    init();
    await db().execute(
        `UPDATE activity_plans
         SET allow_guest_add = ?,
             guest_manage    = ?
         WHERE id = ?`,
        [allowAdd ? 1 : 0, guestManage ? 1 : 0, planId]
    );
}

export async function getActivityPlansByUserId(userId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM activity_plans
         WHERE owner_id = ?`,
        [userId]
    );
    return rows;
}

export async function updateActivityPlanDescription(planId: any, description: any) {
    init();
    await db().execute(
        `UPDATE activity_plans
         SET description = ?
         WHERE id = ?`,
        [description, planId]
    )
}

// Slots
export async function addActivitySlot(planId: any, slot: any) {
    /* slot = { id, planId, date, pos, title, description } */
    init();
    await db().query(
        `INSERT INTO activity_slots
             (id, plan_id, title, description, day, pos, max_assignees)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [slot.id, planId, slot.title, slot.description, slot.date, slot.position, slot.maxAssignees]
    );
}

export async function addActivitySlots(planId: any, slots: any) {
    /* slot = { id, planId, date, pos, title, description } */
    init();
    const values = slots.map((s: any) => [
        s.id, planId, s.date, s.position, s.title, s.description || '', s.maxAssignees
    ]);
    await db().query(
        `INSERT INTO activity_slots
             (id, plan_id, title, description, day, pos, max_assignees)
         VALUES ?`,
        [values]
    );
}

export async function getActivitySlots(planId: any) {
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

    (rows as RowDataPacket[]).forEach((row: any) => {
        row.date = row.day;
        row.position = row.pos;
    });

    // Group by date

    return Object.groupBy(rows as RowDataPacket[], (res: any) => res.date);
}

export async function updateActivitySlot(slotId: any, fields: any) {
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
    return (res as RowDataPacket[])[0].affectedRows === 1;
}

export async function deleteActivitySlot(slotId: any) {
    init();
    await db().execute(
        `DELETE
         FROM activity_slots
         WHERE id = ?`,
        [slotId]
    );
}

export async function reorderActivitySlots(planId: any, order: any) {
    init();
    await Promise.all(order.map((o: any) => db().execute(
            `UPDATE activity_slots
             SET pos = ?
             WHERE id = ?
               AND plan_id = ?`,
            [o.position, o.slotId, planId]
        )
    ));
}

export async function getLastActivitySlotNumber(planId: any, date: any) {
    init();
    const [rows] = await db().execute(
        `SELECT MAX(pos)
         FROM activity_slots
         WHERE plan_id = ?
           AND day = ?`,
        [planId, date]
    );
    return (rows as RowDataPacket[])[0];
}

/* ------------------------------------------------------------------ *
 *  Role‑aware assignment helpers                                     *
 * ------------------------------------------------------------------ */

/**
 * Assign a role to a *user* on a slot.  Works for the same user taking
 * multiple roles.  Safe‑idempotent if the (assignment_id, role_id) pair
 * already exists thanks to INSERT IGNORE.
 */
export async function assignActivityAssignmentRoleToUser(slotId: any, userId: any, roleName = 'default') {
    init();
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();

        const assignmentId = await ensureAssignment(conn, slotId, userId, null);

        await assignRole(conn, assignmentId, roleName);

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Assign a role to a *guest* on a slot.  Logic mirrors assignRoleToUser.
 */
export async function assignActivityAssignmentRoleToGuest(slotId: any, guestId: any, roleName = 'default') {
    init();
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();

        const assignmentId = await ensureAssignment(conn, slotId, null, guestId);
        await assignRole(conn, assignmentId, roleName);

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Remove a role from a user.  If the assignment no longer holds *any*
 * roles afterwards, the base activity_assignments row is deleted too so
 * that max_assignees counts stay correct.
 */
export async function unassignActivityAssignmentRoleFromUser(slotId: any, userId: any, roleName = 'default') {
    init();
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();

        // 1. Find assignment_id (may not exist)
        // @ts-ignore
        const [[assRow]] = await conn.execute(
            'SELECT id FROM activity_assignments WHERE slot_id = ? AND user_id = ? LIMIT 1',
            [slotId, userId]
        );

        await doUnassignRole(conn, assRow, roleName);

        await conn.commit();
        return true;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Guest‑flavoured variant of unassignRoleFromUser.
 */
export async function unassignActivityAssignmentRoleFromGuest(slotId: any, guestId: any, roleName = 'default') {
    init();
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();

        // @ts-ignore
        const [[assRow]] = await conn.execute(
            'SELECT id FROM activity_assignments WHERE slot_id = ? AND guest_id = ? LIMIT 1',
            [slotId, guestId]
        );

        await doUnassignRole(conn, assRow, roleName);

        await conn.commit();
        return true;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/* ------------------------------------------------------------------ *
 *  Convenience wrappers for legacy API users                         *
 * ------------------------------------------------------------------ */

// Backwards‑compat versions behave like the old functions by merely
// calling the new role‑aware helpers with role = 'default'.
export async function assignActivitySlotToUser(slotId: any, userId: any) {
    return assignActivityAssignmentRoleToUser(slotId, userId, 'default');
}

export async function unassignActivitySlotUser(slotId: any, userId: any) {
    return unassignActivityAssignmentRoleFromUser(slotId, userId, 'default');
}

export async function assignActivitySlotToGuest(slotId: any, guestId: any) {
    return assignActivityAssignmentRoleToGuest(slotId, guestId, 'default');
}

export async function unassignActivitySlotGuest(slotId: any, guestId: any) {
    return unassignActivityAssignmentRoleFromGuest(slotId, guestId, 'default');
}

export async function getActivitySlotAssignmentsForUser(planId: any, userId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT slot_id
         FROM activity_assignments
         WHERE plan_id = ?
           AND user_id = ?`,
        [planId, userId]
    );
    return (rows as RowDataPacket[]).map((r: any) => r.slot_id);
}

export async function getActivitySlotAssignmentsForGuest(planId: any, guestId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT slot_id
         FROM activity_assignments
         WHERE plan_id = ?
           AND guest_id = ?`,
        [planId, guestId]
    );
    return (rows as RowDataPacket[]).map((r: any) => r.slot_id);
}

/* ------------------------------------------------------------------ *
 *  Aggregate queries (role aware)                                    *
 * ------------------------------------------------------------------ */

/**
 * Returns a map { slot_id → [ { user_id, guest_id, name, roles[] } ] }
 * Roles is an array, *not* a single string.  Useful for display layers.
 */
export async function getActivitySlotAssignees(planId: any) {
    init();

    const [rows] = await db().execute(
        `SELECT aa.id                AS assignment_id,
                aa.slot_id,
                u.username           AS uname,
                g.username           AS gname,
                aa.user_id,
                aa.guest_id,
                GROUP_CONCAT(r.name) AS roles
         FROM activity_assignments aa
                  LEFT JOIN users u ON u.id = aa.user_id
                  LEFT JOIN guests g ON g.id = aa.guest_id
                  JOIN activity_assignment_roles ar ON ar.assignment_id = aa.id
                  JOIN roles r ON r.id = ar.role_id
         WHERE aa.plan_id = ?
         GROUP BY aa.id`,
        [planId]
    );

    const map = {};
    (rows as RowDataPacket[]).forEach((r: any) => {
        const slot = r.slot_id;

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        map[slot] = map[slot] || [];

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        map[slot].push({
            id: r.assignment_id,
            user_id: r.user_id,
            guest_id: r.guest_id,
            name: r.uname || r.gname || '—',
            roles: r.roles ? r.roles.split(',') : []
        });
    });
    return map;
}

/**
 * Participant overview – counts distinct assignment_ids (not roles),
 * then aggregates role list per person for richer UI summaries.
 */
export async function getActivityPlanParticipants(planId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT name,
                COUNT(DISTINCT assignment_id)             AS count,
                GROUP_CONCAT(DISTINCT role ORDER BY role) AS roles
         FROM (SELECT aa.id                            AS assignment_id,
                      COALESCE(u.username, g.username) AS name,
                      r.name                           AS role
               FROM activity_assignments aa
                        LEFT JOIN users u ON u.id = aa.user_id
                        LEFT JOIN guests g ON g.id = aa.guest_id
                        LEFT JOIN activity_assignment_roles ar ON ar.assignment_id = aa.id
                        LEFT JOIN roles r ON r.id = ar.role_id
               WHERE aa.plan_id = ?) AS sub
         GROUP BY name`,
        [planId]
    );
    (rows as RowDataPacket[]).forEach((r: any) => r.roles = r.roles ? r.roles.split(',') || [] : []);
    return rows;
}

export async function deleteActivitySlotAssignment(assignId: any) {
    init();
    await db().execute(
        `DELETE
         FROM activity_assignments
         WHERE id = ?`,
        [assignId]
    );
}

export async function getActivitySlotRoles(planId: any) {
    init();

    const [rows] = await db().execute(
        `SELECT sl.slot_id as slot_id,
                r.id       as role_id,
                r.name     as role_name
         FROM activity_slot_role sl
                  JOIN activity_slots slots ON slots.id = sl.slot_id
                  JOIN roles r ON r.id = sl.role_id
         WHERE slots.plan_id = ?`,
        [planId]
    );

    const map = {};
    (rows as RowDataPacket[]).forEach((r: any) => {
        const slot = r.slot_id;

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        map[slot] = map[slot] || [];

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        map[slot].push({
            id: r.role_id,
            name: r.role_name
        });
    });
    return map;
}

export async function addActivitySlotRoles(slotId: any, roles: any) {
    init();
    const values = roles.map((r: any) => [slotId, r, 1]);
    await db().query(
        `INSERT INTO activity_slot_role (slot_id, role_id, max_qty)
         VALUES ?`,
        [values]
    );
}
