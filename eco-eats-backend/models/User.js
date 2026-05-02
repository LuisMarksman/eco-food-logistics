const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['donor', 'receiver'],
        required: true, 
    },
    
    phone: {
        type: String,
        default: "" 
    },
    address: {
        type: String,
        default: ""
    },
    coordinates: {
        lat: { type: Number },
        lng: { type: Number }
    },
    geocodeProvider: { type: String },
    geocodedAt: { type: Date },
    organization: {
        type: String,
        default: "" 
    }

}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
