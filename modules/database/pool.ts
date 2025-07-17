const mysql = require('mysql2');
const settings = require('../settings');

let db;

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
    db = pool.promise();
}

module.exports = {init, db: () => db};
