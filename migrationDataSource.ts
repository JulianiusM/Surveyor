import {DataSource} from "typeorm";

export const AppDataSource = new DataSource({
    type: 'mysql',  // Use 'mysql' instead of 'mariadb' to avoid native UUID type in MariaDB 10.11+
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'test',
    entities: ['src/modules/database/entities/**/*.ts'],
    migrations: ['src/migrations/*.ts'],
    synchronize: false,
});