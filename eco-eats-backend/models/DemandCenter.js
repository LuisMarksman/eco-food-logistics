const mongoose = require('mongoose');

const DemandCenterSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    coordinates: {
        lat: { type: Number },
        lng: { type: Number }
    },
    geocodeProvider: { type: String },
    geocodedAt: { type: Date },
    mealNeed: { type: Number, default: 0 },
    capacityMeals: { type: Number, default: 0 },
    urgency: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    acceptedCategories: [{ type: String, trim: true }],
    operatingHours: { type: String, default: '' },
    contactPhone: { type: String, default: '' },
    notes: { type: String, default: '' },
    active: { type: Boolean, default: true }
}, { timestamps: true });

DemandCenterSchema.index({ active: 1, urgency: 1 });
DemandCenterSchema.index({ name: 'text', address: 'text', notes: 'text' });

module.exports = mongoose.model('DemandCenter', DemandCenterSchema);
