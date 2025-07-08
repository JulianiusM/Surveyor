const {generateUniqueId} = require('../../lib/util');
const {init, db} = require('../pool');

// Packing Lists
async function createPackingList(listId, ownerId, title, desc, allowGuestAdd, guestManage) {
    init();
    await db().execute(
        `INSERT INTO packing_lists
             (id, owner_id, title, description, allow_guest_add, guest_manage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [listId, ownerId, title, desc, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
    );
}

async function createPackingListTx(ownerId, title, desc, allowGuestAdd, guestManage, items) {
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
            const vals = items.map(it => [
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

async function updatePackingListTitle(listId, title) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET title = ?
         WHERE id = ?`,
        [title, listId]
    );
}

async function deletePackingList(listId) {
    init();
    await db().execute(
        `DELETE
         FROM packing_lists
         WHERE id = ?`,
        [listId]
    );
}

async function getPackingListById(listId) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM packing_lists
         WHERE id = ?`,
        [listId]
    );
    return rows[0] || null;
}

async function getPackingListByUserId(userId) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM packing_lists
         WHERE owner_id = ?`,
        [userId]
    );
    return rows;
}

async function updatePackingListAllow(listId, allow) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET allow_guest_add = ?
         WHERE id = ?`,
        [allow ? 1 : 0, listId]
    );
}

async function updatePackingListGuestManage(listId, flag) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET guest_manage = ?
         WHERE id = ?`,
        [flag ? 1 : 0, listId]
    );
}

async function updatePackingListDescription(listId, description) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET description = ?
         WHERE id = ?`,
        [description, listId]
    )
}

// Packing Items
async function createPackingItem(listId, item) {
    init();
    await db().execute(
        `INSERT INTO packing_items
             (id, list_id, title, description, max_assignees, pos)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, listId, item.title, item.description, item.maxAssignees, item.position]
    );
}

async function addPackingItems(listId, items) {
    init();
    if (!items.length) return;
    const vals = items.map(it => [
        it.id, listId, it.title, it.description, it.maxAssignees, it.position
    ]);
    await db().query(
        `INSERT INTO packing_items
             (id, list_id, title, description, max_assignees, pos)
         VALUES ?`,
        [vals]
    );
}

async function updatePackingItem(itemId, fields) {
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
    return res[0].affectedRows === 1;
}

async function deletePackingItem(itemId) {
    init();
    await db().execute(
        `DELETE
         FROM packing_items
         WHERE id = ?`,
        [itemId]
    );
}

async function reorderPackingItems(listId, orders) {
    init();
    await Promise.all(orders.map(o =>
        db().execute(
            `UPDATE packing_items
             SET pos = ?
             WHERE id = ?
               AND list_id = ?`,
            [o.position, o.itemId, listId]
        )
    ));
}

async function getPackingItems(listId) {
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

async function getPackingAssignmentCounts(listId) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id, COUNT(*) AS cnt
         FROM packing_assignments
         WHERE list_id = ?
         GROUP BY item_id`,
        [listId]
    );
    return rows.reduce((m, r) => {
        m[r.item_id] = r.cnt;
        return m;
    }, {});
}

async function getLastPackingItemNumber(listId) {
    init();
    const [rows] = await db().execute(
        `SELECT MAX(pos)
         FROM packing_items
         WHERE list_id = ?`,
        [listId]
    );
    return rows[0];
}

// Assignments
async function assignPackingItemToUser(itemId, userId) {
    init();
    await db().execute(
        `INSERT IGNORE INTO packing_assignments (item_id, user_id, list_id)
         SELECT ?, ?, list_id
         FROM packing_items
         WHERE id = ?`,
        [itemId, userId, itemId]
    );
}

async function unassignPackingItemUser(itemId, userId) {
    init();
    await db().execute(
        `DELETE
         FROM packing_assignments
         WHERE item_id = ?
           AND user_id = ?`,
        [itemId, userId]
    );
}

async function assignPackingItemToGuest(itemId, guestId) {
    init();
    await db().execute(
        `INSERT IGNORE INTO packing_assignments (item_id, guest_id, list_id)
         SELECT ?, ?, list_id
         FROM packing_items
         WHERE id = ?`,
        [itemId, guestId, itemId]
    );
}

async function unassignPackingItemGuest(itemId, guestId) {
    init();
    await db().execute(
        `DELETE
         FROM packing_assignments
         WHERE item_id = ?
           AND guest_id = ?`,
        [itemId, guestId]
    );
}

async function getPackingAssignmentsForUser(listId, userId) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id
         FROM packing_assignments
         WHERE list_id = ?
           AND user_id = ?`,
        [listId, userId]
    );
    return rows.map(r => r.item_id);
}

async function getPackingAssignmentsForGuest(listId, guestId) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id
         FROM packing_assignments
         WHERE list_id = ?
           AND guest_id = ?`,
        [listId, guestId]
    );
    return rows.map(r => r.item_id);
}

async function getPackingItemAssignees(listId) {
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
    rows.forEach(r => {
        map[r.item_id] = map[r.item_id] || [];
        map[r.item_id].push({
            id: r.assign_id,
            user_id: r.user_id,
            guest_id: r.guest_id,
            name: r.uname || r.gname || '—'
        });
    });
    return map;
}

async function deletePackingAssignment(assignId) {
    init();
    await db().execute(
        `DELETE
         FROM packing_assignments
         WHERE id = ?`,
        [assignId]
    );
}

async function togglePackingItemRequiredByAll(itemId, flag) {
    init();
    await db().execute(
        `UPDATE packing_items
         SET required_by_all = ?
         WHERE id = ?`,
        [flag ? 1 : 0, itemId]
    );
}

async function updatePackingFlags(listId, allowAdd, guestManage) {
    init();
    await db().execute(
        `UPDATE packing_lists
         SET allow_guest_add = ?,
             guest_manage    = ?
         WHERE id = ?`,
        [allowAdd ? 1 : 0, guestManage ? 1 : 0, listId]
    );
}

module.exports = {
    createPackingList,
    createPackingListTx,
    updatePackingListTitle,
    deletePackingList,
    getPackingListById,
    getPackingListByUserId,
    updatePackingListAllow,
    updatePackingListGuestManage,
    updatePackingListDescription,

    createPackingItem,
    addPackingItems,
    updatePackingItem,
    deletePackingItem,
    reorderPackingItems,
    getPackingItems,
    getPackingAssignmentCounts,
    getLastPackingItemNumber,

    assignPackingItemToUser,
    unassignPackingItemUser,
    assignPackingItemToGuest,
    unassignPackingItemGuest,
    getPackingAssignmentsForUser,
    getPackingAssignmentsForGuest,
    getPackingItemAssignees,
    deletePackingAssignment,
    togglePackingItemRequiredByAll,
    updatePackingFlags
};
