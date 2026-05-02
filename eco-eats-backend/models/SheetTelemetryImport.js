const mongoose = require('mongoose');

const SheetTelemetryImportSchema = new mongoose.Schema({
    importKey: { type: String, required: true, unique: true, index: true },
    spreadsheetId: { type: String, required: true, index: true },
    range: { type: String, required: true },
    rowNumber: { type: Number, required: true },
    readingId: { type: String, trim: true },
    foodItem: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', default: null },
    deviceId: { type: String, trim: true },
    observedAt: { type: Date },
    status: {
        type: String,
        enum: ['processed', 'unsafe', 'duplicate', 'unmatched', 'failed', 'skipped'],
        required: true
    },
    message: { type: String, default: '' },
    freshnessState: { type: String, default: '' },
    freshnessScore: { type: Number },
    rawRow: [{ type: String }],
    processedAt: { type: Date, default: Date.now }
}, { timestamps: true });

SheetTelemetryImportSchema.index({ status: 1, processedAt: -1 });
SheetTelemetryImportSchema.index({ readingId: 1, spreadsheetId: 1 });

module.exports = mongoose.model('SheetTelemetryImport', SheetTelemetryImportSchema);
