const FoodItem = require('../models/FoodItem');
const {
    buildFreshnessSnapshot,
    normalizeSensorReading
} = require('./freshnessService');

const DEFAULT_MAX_SENSOR_READINGS = Number(process.env.MAX_SENSOR_READINGS_PER_ITEM || 50);

class TelemetryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'TelemetryError';
        this.statusCode = statusCode;
    }
}

function buildTelemetryFoodQuery(payload = {}) {
    if (payload.foodItemId) return { _id: payload.foodItemId };
    if (payload.deviceId) {
        return {
            deviceId: payload.deviceId,
            $or: [{ status: 'available' }, { status: { $exists: false } }]
        };
    }

    return null;
}

async function findFoodForTelemetry(payload = {}, options = {}) {
    const FoodModel = options.FoodModel || FoodItem;
    const query = buildTelemetryFoodQuery(payload);

    if (!query) {
        throw new TelemetryError('foodItemId or deviceId is required.', 400);
    }

    const result = FoodModel.findOne(query);
    const foodItem = result && typeof result.sort === 'function'
        ? await result.sort({ createdAt: -1 })
        : await result;

    if (!foodItem) {
        throw new TelemetryError('No active food item found for this telemetry.', 404);
    }

    return foodItem;
}

async function attachTelemetryToFood(payload = {}, options = {}) {
    const now = options.now || new Date();
    const maxReadings = options.maxSensorReadings || DEFAULT_MAX_SENSOR_READINGS;
    const foodItem = await findFoodForTelemetry(payload, options);
    const reading = normalizeSensorReading(payload);
    const freshness = buildFreshnessSnapshot({
        ...reading,
        readingAt: reading.observedAt
    }, {
        expiryDate: foodItem.expiryDate,
        category: foodItem.category,
        now
    });

    if (payload.deviceId && !foodItem.deviceId) {
        foodItem.deviceId = payload.deviceId;
    }

    if (!Array.isArray(foodItem.sensorReadings)) {
        foodItem.sensorReadings = [];
    }

    foodItem.sensorReadings.push({
        temperatureC: reading.temperatureC,
        humidityPct: reading.humidityPct,
        gasLevel: reading.gasLevel,
        gasIndex: reading.gasIndex,
        mq2: reading.mq2,
        mq3: reading.mq3,
        mq135: reading.mq135,
        observedAt: reading.observedAt,
        receivedAt: now,
        source: reading.source
    });

    if (foodItem.sensorReadings.length > maxReadings) {
        foodItem.sensorReadings.splice(0, foodItem.sensorReadings.length - maxReadings);
    }

    foodItem.freshness = freshness;

    if (typeof foodItem.save === 'function') {
        await foodItem.save();
    }

    return {
        foodItem,
        reading,
        freshness
    };
}

module.exports = {
    TelemetryError,
    attachTelemetryToFood,
    buildTelemetryFoodQuery,
    findFoodForTelemetry
};
