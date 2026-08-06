import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const rootEnv = path.resolve(process.cwd(), '.env');
if (fs.existsSync(rootEnv)) dotenv.config({path: rootEnv});

const jestEnv = path.resolve(__dirname, '.env.test');
if (fs.existsSync(jestEnv)) dotenv.config({path: jestEnv});

const jestEnvLocal = path.resolve(__dirname, '.env.test.local');
if (fs.existsSync(jestEnvLocal)) dotenv.config({path: jestEnvLocal});

process.env.TEST_DB_HOST ??= '127.0.0.1';
process.env.TEST_DB_PORT ??= '3306';
process.env.TEST_DB_USER ??= 'root';
process.env.TEST_DB_PASSWORD ??= 'password';
process.env.TEST_DB_NAME ??= 'surveyor_test';
process.env.TEST_DB_LOGGING ??= 'false';

// Production services read the normal DB_* variables. Map the dedicated test
// settings before application modules are imported so integration tests use
// the same DataSource configuration path as the running application.
process.env.DB_HOST = process.env.TEST_DB_HOST;
process.env.DB_PORT = process.env.TEST_DB_PORT;
process.env.DB_USER = process.env.TEST_DB_USER;
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD;
process.env.DB_NAME = process.env.TEST_DB_NAME;
