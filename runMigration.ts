import fs from 'fs';
import {spawn} from 'child_process';
import path from 'path';

import csvReader from 'csv-reader';

async function readSettingsFile(filePath: fs.PathLike) {
    return new Promise((resolve, reject) => {
        const settings: any = {};
        const inputStream = fs.createReadStream(filePath, 'utf-8');

        inputStream
            .pipe(new csvReader({parseNumbers: false, trim: true}))
            .on('data', (row: any) => {
                const [key, value] = row;
                settings[key] = value;
            })
            .on('end', () => resolve(settings))
            .on('error', reject);
    });
}

async function main() {
    try {
        const settingsFile = path.resolve(__dirname, './settings.csv'); // adjust path
        const settings: any = await readSettingsFile(settingsFile);

        // Map your CSV keys to env vars expected by dataSource.ts
        process.env.MYSQL_HOST = settings.MYSQL_HOST || '';
        process.env.MYSQL_PORT = settings.MYSQL_PORT || '';
        process.env.MYSQL_USER = settings.MYSQL_USER || '';
        process.env.MYSQL_PASSWORD = settings.MYSQL_PASSWORD || '';
        process.env.MYSQL_DATABASE = settings.MYSQL_DATABASE || '';

        console.log('Environment variables set from settings.csv');

        // Now spawn the typeorm CLI migration command
        const cliArgs = process.argv.slice(2); // forward all args after script name
        const cmd = cliArgs.shift();

        const typeormProcess = spawn(
            'npx',
            ['ts-node', './node_modules/typeorm/cli.js', cmd as string, '-d', ...cliArgs],
            {stdio: 'inherit', shell: true, env: process.env}
        );

        typeormProcess.on('exit', code => process.exit(code));

        typeormProcess.on('exit', (code) => {
            process.exit(code);
        });
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
