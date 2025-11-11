/**
 * Keywords for database operations in E2E tests
 * Reusable actions for database queries and token management
 */

let __e2e_db_pool: any | null = null;

/**
 * Get database connection pool
 */
export async function getDbPool(): Promise<any> {
    if (!__e2e_db_pool) {
        const mysql = await import('mysql2/promise');
        __e2e_db_pool = mysql.createPool({
            host: process.env.E2E_DB_HOST || process.env.DB_HOST || '127.0.0.1',
            port: Number(process.env.E2E_DB_PORT || process.env.DB_PORT || 3306),
            user: process.env.E2E_DB_USER || process.env.DB_USER,
            password: process.env.E2E_DB_PASSWORD || process.env.E2E_DB_PASS || process.env.DB_PASSWORD,
            database: process.env.E2E_DB_NAME || process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
        });
    }
    return __e2e_db_pool;
}

/**
 * Get activation token for a user
 */
export async function getActivationToken(username: string): Promise<string | undefined> {
    const pool = await getDbPool();
    const [rows] = await pool.query(
        'SELECT activation_token AS token FROM users WHERE username = ? ORDER BY id DESC LIMIT 1',
        [username]
    );
    return (rows as any[])[0]?.token;
}

/**
 * Get reset token for a user
 */
export async function getResetToken(username: string): Promise<string | undefined> {
    const pool = await getDbPool();
    const [rows] = await pool.query(
        'SELECT reset_token AS token FROM users WHERE username = ? ORDER BY id DESC LIMIT 1',
        [username]
    );
    return (rows as any[])[0]?.token;
}

/**
 * Check if a column exists in a table
 */
export async function columnExists(table: string, column: string): Promise<boolean> {
    const pool = await getDbPool();
    const [rows] = await pool.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [table, column]
    );
    return (rows as any[]).length > 0;
}

/**
 * Expire a reset token for a user (if schema supports it)
 */
export async function expireResetToken(username: string): Promise<boolean> {
    const pool = await getDbPool();
    const table = 'users';
    const candidates = ['reset_token_expires', 'reset_expires_at', 'reset_token_expires_at'];
    
    for (const col of candidates) {
        if (await columnExists(table, col)) {
            await pool.query(
                `UPDATE ${table} SET ${col} = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE username = ?`,
                [username]
            );
            return true;
        }
    }
    return false;
}
