const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MODEL_PATH = path.join(__dirname, '..', 'data', 'food_spoilage_model.json');
const DEFAULT_FEATURES = ['mq2', 'mq3', 'mq135', 'temperatureC', 'humidityPct', 'gasIndex'];
let modelCache = null;

function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeGasIndex(value) {
    const gas = toNumber(value);
    if (gas === null) return null;
    if (gas <= 100) return clamp(gas, 0, 100);
    return clamp((gas / 1000) * 100, 0, 100);
}

function getModelPath() {
    return process.env.FOOD_SENSOR_MODEL_PATH || DEFAULT_MODEL_PATH;
}

function loadModel() {
    const modelPath = getModelPath();

    try {
        const stat = fs.statSync(modelPath);

        if (modelCache && modelCache.path === modelPath && modelCache.mtimeMs === stat.mtimeMs) {
            return modelCache.model;
        }

        const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        modelCache = { path: modelPath, mtimeMs: stat.mtimeMs, model };
        return model;
    } catch (err) {
        return null;
    }
}

function resetModelCache() {
    modelCache = null;
}

function vectorFromReading(reading = {}, features = DEFAULT_FEATURES) {
    const gasValues = [reading.mq2, reading.mq3, reading.mq135]
        .map(toNumber)
        .filter((value) => value !== null);
    const withGasIndex = {
        ...reading,
        gasIndex: normalizeGasIndex(reading.gasIndex) ?? (gasValues.length ? normalizeGasIndex(Math.max(...gasValues)) : null)
    };

    return Object.fromEntries(features.map((feature) => [feature, toNumber(withGasIndex[feature])]));
}

function distanceToLabel(vector, label, model) {
    const features = model.features || DEFAULT_FEATURES;
    let total = 0;
    let count = 0;

    for (const feature of features) {
        const value = vector[feature];
        const center = label.features?.[feature]?.mean;
        if (value === null || center === null || center === undefined) continue;

        const scale = Math.max(1, toNumber(model.featureScale?.[feature]) || 1);
        total += ((value - center) / scale) ** 2;
        count += 1;
    }

    if (count === 0) return Number.POSITIVE_INFINITY;
    return Math.sqrt(total / count);
}

function confidenceFromDistances(bestDistance, secondDistance) {
    if (!Number.isFinite(bestDistance)) return 0;
    const base = 1 / (1 + bestDistance);

    if (!Number.isFinite(secondDistance)) {
        return Number(clamp(base, 0, 0.92).toFixed(2));
    }

    const separation = clamp((secondDistance - bestDistance) / Math.max(secondDistance, 1), 0, 1);
    return Number(clamp((base * 0.65) + (separation * 0.35), 0, 0.98).toFixed(2));
}

function classifyReading(reading = {}, options = {}) {
    const model = options.model || loadModel();
    if (!model || !Array.isArray(model.labels) || model.labels.length === 0) return null;

    const vector = vectorFromReading(reading, model.features);
    const distances = model.labels
        .map((label) => ({
            label: label.label,
            state: label.state,
            foodName: label.foodName,
            foodForm: label.foodForm,
            samples: label.samples,
            distance: distanceToLabel(vector, label, model)
        }))
        .filter((entry) => Number.isFinite(entry.distance))
        .sort((a, b) => a.distance - b.distance);

    if (distances.length === 0) return null;

    const [best, second] = distances;

    return {
        ...best,
        confidence: confidenceFromDistances(best.distance, second?.distance),
        trainedAt: model.trainedAt,
        modelVersion: model.version,
        readyForRottenDetection: Boolean(model.hasEmptyBaseline && model.hasRottenClass),
        readyForShelfLifeLearning: Boolean(model.hasFreshClass && model.hasRottenClass),
        distances: distances.slice(0, 3).map((entry) => ({
            label: entry.label,
            state: entry.state,
            distance: Number(entry.distance.toFixed(4))
        }))
    };
}

module.exports = {
    classifyReading,
    loadModel,
    resetModelCache,
    vectorFromReading
};
