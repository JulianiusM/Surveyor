import {generateUniqueId} from '../../../lib/util';
import {db, init} from '../pool';
import {RowDataPacket} from "mysql2";

// Packing Lists
export async function createPackingList(listId: any, ownerId: any, title: any, desc: any, allowGuestAdd: any, guestManage: any) {
    init();
    await db().execute(
        `INSERT INTO packing_lists
             (id, owner_id, title, description, allow_guest_add, guest_manage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [listId, ownerId, title, desc, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
    );
}

export async function createPackingListTx(ownerId: any, title: any, desc: any, allowGuestAdd: any, guestManage: any, items: any) {
    init();
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();
        const listId = generateUniqueId();
        await conn.execute(
            `INSERT INTO packing_lists
                 (id, owner_id, title, description, allow_guest_add, guest_manage)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [listId, ownerId, title, desc, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
        );
        if (items.length) {
            const vals = items.map((it: any) => [
                it.id, listId, it.title, it.description,
                it.maxAssignees, it.requiredByAll, it.position
            ]);
            await conn.query(
                `INSERT INTO packing_items
                 (id, list_id, title, description,
                  max_assignees, required_by_all, pos)
                 VALUES ?`,
                [vals]
            );
        }
        await conn.commit();
        return listId;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

export async function updatePackingListTitle(listId: any, title: any) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET title = ?
         WHERE id = ?`,
        [title, listId]
    );
}

export async function deletePackingList(listId: any) {
    init();
    await db().execute(
        `DELETE
         FROM packing_lists
         WHERE id = ?`,
        [listId]
    );
}

export async function getPackingListById(listId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM packing_lists
         WHERE id = ?`,
        [listId]
    );
    return (rows as RowDataPacket[])[0] || null;
}

export async function getPackingListByUserId(userId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM packing_lists
         WHERE owner_id = ?`,
        [userId]
    );
    return rows;
}

export async function updatePackingListAllow(listId: any, allow: any) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET allow_guest_add = ?
         WHERE id = ?`,
        [allow ? 1 : 0, listId]
    );
}

export async function updatePackingListGuestManage(listId: any, flag: any) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET guest_manage = ?
         WHERE id = ?`,
        [flag ? 1 : 0, listId]
    );
}

export async function updatePackingListDescription(listId: any, description: any) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET description = ?
         WHERE id = ?`,
        [description, listId]
    )
}

// Packing Items
export async function createPackingItem(listId: any, item: any) {
    init();
    await db().execute(
        `INSERT INTO packing_items
             (id, list_id, title, description, max_assignees, pos)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, listId, item.title, item.description, item.maxAssignees, item.position]
    );
}

export async function addPackingItems(listId: any, items: any) {
    init();
    if (!items.length) return;
    const vals = items.map((it: any) => [
        it.id, listId, it.title, it.description, it.maxAssignees, it.position
    ]);
    await db().query(
        `INSERT INTO packing_items
             (id, list_id, title, description, max_assignees, pos)
         VALUES ?`,
        [vals]
    );
}

export async function updatePackingItem(itemId: any, fields: any) {
    init();
    const sets = [], vals = [];
    for (const [col, val] of Object.entries({
        title: fields.title,
        description: fields.description,
        max_assignees: fields.maxAssignees,
        position: fields.position
    })) {
        if (val !== undefined) {
            sets.push(`${col} = ?`);
            vals.push(val);
        }
    }
    if (!sets.length) return;
    vals.push(itemId);
    const res = await db().execute(
        `UPDATE packing_items
         SET ${sets.join(', ')}
         WHERE id = ?`,
        vals
    );
    return (res as RowDataPacket[])[0].affectedRows === 1;
}

export async function deletePackingItem(itemId: any) {
    init();
    await db().execute(
        `DELETE
         FROM packing_items
         WHERE id = ?`,
        [itemId]
    );
}

export async function reorderPackingItems(listId: any, orders: any) {
    init();
    await Promise.all(orders.map((o: any) => db().execute(
            `UPDATE packing_items
             SET pos = ?
             WHERE id = ?
               AND list_id = ?`,
            [o.position, o.itemId, listId]
        )
    ));
}

export async function getPackingItems(listId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT pi.*,
                COALESCE(ac.cnt, 0) AS assigned_count
         FROM packing_items pi
                  LEFT JOIN (SELECT item_id, COUNT(*) AS cnt
                             FROM packing_assignments
                             WHERE list_id = ?
                             GROUP BY item_id) ac ON ac.item_id = pi.id
         WHERE pi.list_id = ?
         ORDER BY pi.pos`,
        [listId, listId]
    );
    return rows;
}

export async function getPackingAssignmentCounts(listId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id, COUNT(*) AS cnt
         FROM packing_assignments
         WHERE list_id = ?
         GROUP BY item_id`,
        [listId]
    );
    return (rows as RowDataPacket[]).reduce((m: any, r: any) => {
        m[r.item_id] = r.cnt;
        return m;
    }, {});
}

export async function getLastPackingItemNumber(listId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT MAX(pos)
         FROM packing_items
         WHERE list_id = ?`,
        [listId]
    );
    return (rows as RowDataPacket[])[0];
}

// Assignments
export async function assignPackingItemToUser(itemId: any, userId: any) {
    init();
    await db().execute(
        `INSERT IGNORE INTO packing_assignments (item_id, user_id, list_id)
         SELECT ?, ?, list_id
         FROM packing_items
         WHERE id = ?`,
        [itemId, userId, itemId]
    );
}

export async function unassignPackingItemUser(itemId: any, userId: any) {
    init();
    await db().execute(
        `DELETE
         FROM packing_assignments
         WHERE item_id = ?
           AND user_id = ?`,
        [itemId, userId]
    );
}

export async function assignPackingItemToGuest(itemId: any, guestId: any) {
    init();
    await db().execute(
        `INSERT IGNORE INTO packing_assignments (item_id, guest_id, list_id)
         SELECT ?, ?, list_id
         FROM packing_items
         WHERE id = ?`,
        [itemId, guestId, itemId]
    );
}

export async function unassignPackingItemGuest(itemId: any, guestId: any) {
    init();
    await db().execute(
        `DELETE
         FROM packing_assignments
         WHERE item_id = ?
           AND guest_id = ?`,
        [itemId, guestId]
    );
}

export async function getPackingAssignmentsForUser(listId: any, userId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id
         FROM packing_assignments
         WHERE list_id = ?
           AND user_id = ?`,
        [listId, userId]
    );
    return (rows as RowDataPacket[]).map((r: any) => r.item_id);
}

export async function getPackingAssignmentsForGuest(listId: any, guestId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id
         FROM packing_assignments
         WHERE list_id = ?
           AND guest_id = ?`,
        [listId, guestId]
    );
    return (rows as RowDataPacket[]).map((r: any) => r.item_id);
}

export async function getPackingItemAssignees(listId: any) {
    init();
    const [rows] = await db().execute(
        `SELECT pa.id      AS assign_id,
                pa.item_id,
                u.username AS uname,
                g.username AS gname,
                pa.user_id,
                pa.guest_id
         FROM packing_assignments pa
                  LEFT JOIN users u ON u.id = pa.user_id
                  LEFT JOIN guests g ON g.id = pa.guest_id
         WHERE pa.list_id = ?`,
        [listId]
    );
    const map = {};
    (rows as RowDataPacket[]).forEach((r: any) => {

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        map[r.item_id] = map[r.item_id] || [];

        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        map[r.item_id].push({
            id: r.assign_id,
            user_id: r.user_id,
            guest_id: r.guest_id,
            name: r.uname || r.gname || '—'
        });
    });
    return map;
}

export async function deletePackingAssignment(assignId: any) {
    init();
    await db().execute(
        `DELETE
         FROM packing_assignments
         WHERE id = ?`,
        [assignId]
    );
}

export async function togglePackingItemRequiredByAll(itemId: any, flag: any) {
    init();
    await db().execute(
        `UPDATE packing_items
         SET required_by_all = ?
         WHERE id = ?`,
        [flag ? 1 : 0, itemId]
    );
}

export async function updatePackingFlags(listId: any, allowAdd: any, guestManage: any) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET allow_guest_add = ?,
             guest_manage    = ?
         WHERE id = ?`,
        [allowAdd ? 1 : 0, guestManage ? 1 : 0, listId]
    );
}
