const test = require('node:test');
const assert = require('node:assert/strict');
const {
    classifyReading,
    resetModelCache
} = require('../services/calibrationModelService');

test('classifyReading picks the closest calibrated sensor signature', () => {
    resetModelCache();
    const model = {
        version: 1,
        trainedAt: '2026-05-02T00:00:00.000Z',
        features: ['mq2', 'mq3', 'mq135', 'temperatureC', 'humidityPct', 'gasIndex'],
        hasEmptyBaseline: true,
        hasRottenClass: true,
        hasFreshClass: false,
        featureScale: {
            mq2: 100,
            mq3: 100,
            mq135: 100,
            temperatureC: 2,
            humidityPct: 5,
            gasIndex: 10
        },
        labels: [
            {
                label: 'empty_baseline',
                state: 'empty',
                foodName: 'empty_container',
                foodForm: 'empty',
                samples: 60,
                features: {
                    mq2: { mean: 0 },
                    mq3: { mean: 520 },
                    mq135: { mean: 16 },
                    temperatureC: { mean: 36.2 },
                    humidityPct: { mean: 63 },
                    gasIndex: { mean: 52 }
                }
            },
            {
                label: 'rotten_cooked_rice',
                state: 'rotten',
                foodName: 'rice',
                foodForm: 'cooked',
                samples: 60,
                features: {
                    mq2: { mean: 120 },
                    mq3: { mean: 1500 },
                    mq135: { mean: 360 },
                    temperatureC: { mean: 34 },
                    humidityPct: { mean: 88 },
                    gasIndex: { mean: 100 }
                }
            }
        ]
    };

    const prediction = classifyReading({
        mq2: 115,
        mq3: 1488,
        mq135: 340,
        temperatureC: 34.2,
        humidityPct: 87.4
    }, { model });

    assert.equal(prediction.label, 'rotten_cooked_rice');
    assert.equal(prediction.state, 'rotten');
    assert.ok(prediction.confidence > 0.7);
    assert.equal(prediction.readyForRottenDetection, true);
});
