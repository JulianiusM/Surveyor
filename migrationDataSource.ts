import {DataSource} from "typeorm";

export const AppDataSource = new DataSource({
    type: (process.env.DB_TYPE as "mariadb" | "mysql") || 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'test',
    entities: ['src/modules/database/entities/**/*.ts'],
    migrations: ['src/migrations/*.ts'],
    synchronize: false,
});