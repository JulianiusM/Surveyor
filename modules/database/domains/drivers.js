const {generateUniqueId} = require('../../lib/util');
const {init, db} = require('../pool');

// Drivers Lists
async function createDriversList(listId, ownerId, title, desc, allowGuestAdd, guestManage) {
    init();
    await db().execute(
        `INSERT INTO drivers_lists
             (id, owner_id, title, description, allow_guest_add, guest_manage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [listId, ownerId, title, desc, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
    );
}

async function createDriversListTx(ownerId, title, desc, allowGuestAdd, guestManage, items) {
    init();
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();
        const listId = generateUniqueId();
        await conn.execute(
            `INSERT INTO drivers_lists
                 (id, owner_id, title, description, allow_guest_add, guest_manage)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [listId, ownerId, title, desc, allowGuestAdd ? 1 : 0, guestManage ? 1 : 0]
        );
        if (items.length) {
            const vals = items.map(it => [
                it.id, listId, it.title, it.description, ownerId,
                it.maxAssignees, it.position
            ]);
            await conn.query(
                `INSERT INTO drivers_items
                 (id, list_id, title, description, user_id,
                  max_assignees, pos)
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

async function updateDriversListTitle(listId, title) {
    init();
    await db().execute(
        `UPDATE drivers_lists
         SET title = ?
         WHERE id = ?`,
        [title, listId]
    );
}

async function deleteDriversList(listId) {
    init();
    await db().execute(
        `DELETE
         FROM drivers_lists
         WHERE id = ?`,
        [listId]
    );
}

async function getDriversListById(listId) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM drivers_lists
         WHERE id = ?`,
        [listId]
    );
    return rows[0] || null;
}

async function getDriversListByUserId(userId) {
    init();
    const [rows] = await db().execute(
        `SELECT *
         FROM drivers_lists
         WHERE owner_id = ?`,
        [userId]
    );
    return rows;
}

async function updateDriversListAllow(listId, allow) {
    init();
    await db().execute(
        `UPDATE drivers_lists
         SET allow_guest_add = ?
         WHERE id = ?`,
        [allow ? 1 : 0, listId]
    );
}

async function updateDriversListGuestManage(listId, flag) {
    init();
    await db().execute(
        `UPDATE drivers_lists
         SET guest_manage = ?
         WHERE id = ?`,
        [flag ? 1 : 0, listId]
    );
}

async function updateDriversListDescription(listId, description) {
    init();
    await db().execute(
        `UPDATE drivers_lists
         SET description = ?
         WHERE id = ?`,
        [description, listId]
    )
}

// Drivers Items
async function createDriversItemUser(listId, userId, item) {
    init();
    await db().execute(
        `INSERT INTO drivers_items
             (id, list_id, title, description, user_id, max_assignees, pos)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [item.id, listId, item.title, item.description, userId, item.maxAssignees, item.position]
    );
}

// Drivers Items
async function createDriversItemGuest(listId, guestId, item) {
    init();
    await db().execute(
        `INSERT INTO drivers_items
             (id, list_id, title, description, guest_id, max_assignees, pos)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [item.id, listId, item.title, item.description, guestId, item.maxAssignees, item.position]
    );
}

async function updateDriversItem(itemId, fields) {
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
        `UPDATE drivers_items
         SET ${sets.join(', ')}
         WHERE id = ?`,
        vals
    );
    return res[0].affectedRows === 1;
}

async function deleteDriversItem(itemId) {
    init();
    await db().execute(
        `DELETE
         FROM drivers_items
         WHERE id = ?`,
        [itemId]
    );
}

async function reorderDriversItems(listId, orders) {
    init();
    await Promise.all(orders.map(o =>
        db().execute(
            `UPDATE drivers_items
             SET pos = ?
             WHERE id = ?
               AND list_id = ?`,
            [o.position, o.itemId, listId]
        )
    ));
}

async function getDriversItems(listId) {
    init();
    const [rows] = await db().execute(
        `SELECT pi.*,
                COALESCE(ac.cnt, 0)              AS assigned_count,
                COALESCE(u.username, g.username) AS driver_name
         FROM drivers_items pi
                  LEFT JOIN (SELECT item_id, COUNT(*) AS cnt
                             FROM drivers_assignments
                             WHERE list_id = ?
                             GROUP BY item_id) ac ON ac.item_id = pi.id
                  LEFT JOIN users u ON u.id = pi.user_id
                  LEFT JOIN guests g ON g.id = pi.guest_id
         WHERE pi.list_id = ?
         ORDER BY pi.pos`,
        [listId, listId]
    );
    return rows;
}

async function getDriversItemById(itemId) {
    init();
    const [rows] = await db().execute(
        `SELECT pi.*,
                COALESCE(ac.cnt, 0)              AS assigned_count,
                COALESCE(u.username, g.username) AS driver_name
         FROM drivers_items pi
                  LEFT JOIN (SELECT item_id, COUNT(*) AS cnt
                             FROM drivers_assignments
                             WHERE item_id = ?
                             GROUP BY item_id) ac ON ac.item_id = pi.id
                  LEFT JOIN users u ON u.id = pi.user_id
                  LEFT JOIN guests g ON g.id = pi.guest_id
         WHERE pi.id = ?
         ORDER BY pi.pos`,
        [itemId, itemId]
    );
    return rows[0];
}

async function getDriversAssignmentCounts(listId) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id, COUNT(*) AS cnt
         FROM drivers_assignments
         WHERE list_id = ?
         GROUP BY item_id`,
        [listId]
    );
    return rows.reduce((m, r) => {
        m[r.item_id] = r.cnt;
        return m;
    }, {});
}

async function getLastDriversItemNumber(listId) {
    init();
    const [rows] = await db().execute(
        `SELECT MAX(pos)
         FROM drivers_items
         WHERE list_id = ?`,
        [listId]
    );
    return rows[0];
}

// Assignments
async function assignDriversItemToUser(itemId, userId) {
    init();
    await db().execute(
        `INSERT IGNORE INTO drivers_assignments (item_id, user_id, list_id)
         SELECT ?, ?, list_id
         FROM drivers_items
         WHERE id = ?`,
        [itemId, userId, itemId]
    );
}

async function unassignDriversItemUser(itemId, userId) {
    init();
    await db().execute(
        `DELETE
         FROM drivers_assignments
         WHERE item_id = ?
           AND user_id = ?`,
        [itemId, userId]
    );
}

async function assignDriversItemToGuest(itemId, guestId) {
    init();
    await db().execute(
        `INSERT IGNORE INTO drivers_assignments (item_id, guest_id, list_id)
         SELECT ?, ?, list_id
         FROM drivers_items
         WHERE id = ?`,
        [itemId, guestId, itemId]
    );
}

async function unassignDriversItemGuest(itemId, guestId) {
    init();
    await db().execute(
        `DELETE
         FROM drivers_assignments
         WHERE item_id = ?
           AND guest_id = ?`,
        [itemId, guestId]
    );
}

async function getDriversAssignmentsForUser(listId, userId) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id
         FROM drivers_assignments
         WHERE list_id = ?
           AND user_id = ?`,
        [listId, userId]
    );
    return rows.map(r => r.item_id);
}

async function getDriversAssignmentsForGuest(listId, guestId) {
    init();
    const [rows] = await db().execute(
        `SELECT item_id
         FROM drivers_assignments
         WHERE list_id = ?
           AND guest_id = ?`,
        [listId, guestId]
    );
    return rows.map(r => r.item_id);
}

async function getDriversItemAssignees(listId) {
    init();
    const [rows] = await db().execute(
        `SELECT pa.id      AS assign_id,
                pa.item_id,
                u.username AS uname,
                g.username AS gname,
                pa.user_id,
                pa.guest_id
         FROM drivers_assignments pa
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

async function deleteDriversAssignment(assignId) {
    init();
    await db().execute(
        `DELETE
         FROM drivers_assignments
         WHERE id = ?`,
        [assignId]
    );
}

async function updateDriversFlags(listId, allowAdd, guestManage) {
    init();
    await db().execute(
        `UPDATE drivers_lists
         SET allow_guest_add = ?,
             guest_manage    = ?
         WHERE id = ?`,
        [allowAdd ? 1 : 0, guestManage ? 1 : 0, listId]
    );
}

module.exports = {
    createDriversList,
    createDriversListTx,
    updateDriversListTitle,
    deleteDriversList,
    getDriversListById,
    getDriversListByUserId,
    updateDriversListAllow,
    updateDriversListGuestManage,
    updateDriversListDescription,

    createDriversItemUser,
    createDriversItemGuest,
    updateDriversItem,
    deleteDriversItem,
    reorderDriversItems,
    getDriversItems,
    getDriversItemById,
    getDriversAssignmentCounts,
    getLastDriversItemNumber,

    assignDriversItemToUser,
    unassignDriversItemUser,
    assignDriversItemToGuest,
    unassignDriversItemGuest,
    getDriversAssignmentsForUser,
    getDriversAssignmentsForGuest,
    getDriversItemAssignees,
    deleteDriversAssignment,
    updateDriversFlags
};
