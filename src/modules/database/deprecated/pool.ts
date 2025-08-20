import mysql from 'mysql2';
import settings from '../../settings';
import {Pool} from 'mysql2/promise';

let _pool: Pool;

export function init() {
    if (_pool) return;
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
    _pool = pool.promise();
}

export function db() {
    return _pool;
}
