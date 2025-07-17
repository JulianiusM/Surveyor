// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const mysql = require('mysql2');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'settings'.
const settings = require('../settings');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'db'.
let db;

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'init'.
function init() {
    if (db) return;
    const pool = mysql.createPool({
        host: settings.mysqlHost,
        user: settings.mysqlUser,
        password: settings.mysqlPassword,
        database: settings.mysqlDatabase,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        timezone: 'Z',              // treat TIMESTAMP / DATETIME as UTC
        dateStrings: ['DATE']       // A & B: return DATE as **string**
    });
    // @ts-expect-error TS(2588): Cannot assign to 'db' because it is a constant.
    db = pool.promise();
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = {init, db: () => db};
