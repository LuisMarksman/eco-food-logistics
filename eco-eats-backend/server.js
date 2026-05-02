require('dotenv').config({ path: './.env' });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoute = require('./routes/auth');
const foodRoute = require('./routes/food');
const routeAnalyzerRoute = require('./routes/routeAnalyzer');
const iotRoute = require('./routes/iot');
const demandCenterRoute = require('./routes/demandCenters');
const { startSheetsTelemetryPolling } = require('./services/sheetsTelemetryService');

const app = express();
const PORT = process.env.PORT || 5000;
let startupState = {
    mode: 'booting',
    database: 'unknown',
    missingEnv: [],
    databaseError: null
};

function requireEnv() {
    const missing = ['MONGO_URI', 'JWT_SECRET'].filter((key) => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
    }
}

function buildCorsOptions() {
    const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    return {
        credentials: true,
        origin(origin, callback) {
            if (!origin || configuredOrigins.includes('*') || configuredOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error(`CORS blocked origin: ${origin}`));
        }
    };
}

app.use(cors(buildCorsOptions()));
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).json({
        service: 'eco-eats-backend',
        status: 'ok',
        message: 'Backend is running. Open the frontend Vite URL, usually http://127.0.0.1:5173.',
        health: '/api/health'
    });
});

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'eco-eats-backend',
        mode: startupState.mode,
        database: startupState.database,
        missingEnv: startupState.missingEnv,
        databaseError: startupState.databaseError,
        timestamp: new Date().toISOString()
    });
});

app.use('/api/routes', routeAnalyzerRoute);
app.use('/api/iot', iotRoute);

function requireDatabaseForRequest(req, res, next) {
    if (mongoose.connection.readyState === 1) {
        return next();
    }

    return res.status(503).json({
        message: 'Database is unavailable. Add backend .env credentials to enable auth and food data APIs.'
    });
}

app.use('/api/auth', requireDatabaseForRequest, authRoute);
app.use('/api/food', requireDatabaseForRequest, foodRoute);
app.use('/api/demand-centers', requireDatabaseForRequest, demandCenterRoute);

app.use((err, req, res, next) => {
    if (err.message && err.message.startsWith('CORS blocked origin')) {
        return res.status(403).json({ message: err.message });
    }

    console.error(err);
    return res.status(500).json({ message: 'Server Error' });
});

async function connectToDatabase() {
    requireEnv();
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000)
    });
    console.log('MongoDB connected successfully.');
}

async function startServer() {
    try {
        try {
            await connectToDatabase();
            startupState = {
                mode: 'full',
                database: 'connected',
                missingEnv: [],
                databaseError: null
            };
            startSheetsTelemetryPolling();
        } catch (err) {
            startupState = {
                mode: 'degraded',
                database: 'disconnected',
                missingEnv: ['MONGO_URI', 'JWT_SECRET'].filter((key) => !process.env[key]),
                databaseError: err.message
            };
            console.warn('Starting backend in degraded mode:', err.message);
        }

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT} (${startupState.mode} mode)`);
        });
    } catch (err) {
        console.error('Failed to start server:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = { app, connectToDatabase, requireEnv, startServer };
