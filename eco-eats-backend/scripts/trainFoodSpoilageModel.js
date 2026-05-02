const fs = require('node:fs');
const path = require('node:path');
const {
    cleanValue,
    readDataset,
    toNumber
} = require('./foodSensorDataset');

const DEFAULT_DATASET = path.join(__dirname, '..', 'data', 'food_sensor_samples.csv');
const DEFAULT_MODEL = path.join(__dirname, '..', 'data', 'food_spoilage_model.json');
const FEATURES = ['mq2', 'mq3', 'mq135', 'temperatureC', 'humidityPct', 'gasIndex'];

function parseArgs(argv = process.argv.slice(2)) {
    const args = {};

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;

        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            index += 1;
        }
    }

    return args;
}

function mean(values) {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values, average = mean(values)) {
    if (values.length <= 1 || average === null) return 0;
    const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function normalizeGasIndex(value) {
    const gas = toNumber(value);
    if (gas === null) return null;
    if (gas <= 100) return Math.min(100, Math.max(0, gas));
    return Math.min(100, Math.max(0, (gas / 1000) * 100));
}

function featureValue(row, feature) {
    if (feature === 'gasIndex') return normalizeGasIndex(row[feature]);
    return toNumber(row[feature]);
}

function summarizeFeature(rows, feature) {
    const values = rows.map((row) => featureValue(row, feature)).filter((value) => value !== null);
    const average = mean(values);

    return {
        mean: average === null ? null : Number(average.toFixed(4)),
        std: Number(std(values, average).toFixed(4)),
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null
    };
}

function summarizeLabel(label, rows) {
    const first = rows[0] || {};

    return {
        label,
        state: cleanValue(first.state) || 'unknown',
        foodForm: cleanValue(first.foodForm) || 'unknown',
        foodName: cleanValue(first.foodName) || label,
        samples: rows.length,
        firstReadingAt: rows[0]?.time || null,
        lastReadingAt: rows.at(-1)?.time || null,
        features: Object.fromEntries(FEATURES.map((feature) => [feature, summarizeFeature(rows, feature)]))
    };
}

function featureScale(labels) {
    return Object.fromEntries(FEATURES.map((feature) => {
        const means = labels
            .map((label) => label.features[feature].mean)
            .filter((value) => value !== null);
        const spread = std(means);
        return [feature, Math.max(1, Number(spread.toFixed(4)))];
    }));
}

function main() {
    const args = parseArgs();
    const datasetPath = path.resolve(args.dataset || DEFAULT_DATASET);
    const modelPath = path.resolve(args.out || DEFAULT_MODEL);
    const minRowsPerLabel = Number(args['min-rows'] || 5);
    const rows = readDataset(datasetPath).filter((row) => cleanValue(row.label));
    const byLabel = new Map();

    for (const row of rows) {
        const label = cleanValue(row.label);
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label).push(row);
    }

    const labels = Array.from(byLabel.entries())
        .map(([label, labelRows]) => summarizeLabel(label, labelRows))
        .filter((summary) => summary.samples >= minRowsPerLabel);
    const model = {
        version: 1,
        trainedAt: new Date().toISOString(),
        dataset: datasetPath,
        features: FEATURES,
        minRowsPerLabel,
        totalRows: rows.length,
        trainedLabels: labels.length,
        hasRottenClass: labels.some((label) => ['rotten', 'unsafe'].includes(label.state)),
        hasFreshClass: labels.some((label) => ['fresh', 'good', 'excellent'].includes(label.state)),
        hasEmptyBaseline: labels.some((label) => label.state === 'empty' || label.label.includes('empty')),
        featureScale: featureScale(labels),
        labels
    };

    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`);

    console.log(JSON.stringify({
        model: modelPath,
        dataset: datasetPath,
        totalRows: model.totalRows,
        trainedLabels: model.trainedLabels,
        labels: labels.map((label) => ({
            label: label.label,
            state: label.state,
            foodForm: label.foodForm,
            samples: label.samples
        })),
        readyForRottenDetection: model.hasEmptyBaseline && model.hasRottenClass,
        readyForShelfLifeLearning: model.hasFreshClass && model.hasRottenClass
    }, null, 2));
}

main();
