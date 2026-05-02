const { spawnSync } = require('node:child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');

async function main() {
    const mongo = await MongoMemoryServer.create({
        instance: {
            dbName: 'eco-eats'
        }
    });

    process.env.MONGO_URI = mongo.getUri('eco-eats');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'eco-eats-local-dev-secret-change-before-production';
    process.env.PORT = process.env.PORT || '5000';
    process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

    const seed = spawnSync(process.execPath, ['scripts/seedDemoData.js'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit'
    });

    if (seed.status !== 0) {
        throw new Error('Demo data seed failed.');
    }

    const { startServer } = require('../server');
    await startServer();

    const stop = async () => {
        await mongo.stop();
        process.exit(0);
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

main().catch((err) => {
    console.error('Failed to start full local backend:', err.message);
    process.exit(1);
});
