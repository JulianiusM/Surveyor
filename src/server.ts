import http from 'http';
import settings from './modules/settings';
import app from './app';
import {initDataSource} from "./modules/database/dataSource";

async function bootstrap() {
    try {
        console.log('🔧 Initializing database connection...');
        await settings.readSettingsFile();
        await initDataSource();

        const server = http.createServer(app);
        server.listen(settings.appPort, () => {
            console.log(`🚀 Server listening on http://localhost:${settings.appPort}`);
        });
    } catch (err) {
        console.error('❌ Failed to initialize app:', err);
        process.exit(1);
    }
}

bootstrap();
