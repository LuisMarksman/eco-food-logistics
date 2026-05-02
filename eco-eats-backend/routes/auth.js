const router = require('express').Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const VALID_ROLES = new Set(['donor', 'receiver']);

// REGISTER API
router.post('/register', async (req, res) => {
    try {
        // 1. Destructure data from the request body
        const { username, email, password, role } = req.body;
        const normalizedRole = role || 'donor';

        if (!VALID_ROLES.has(normalizedRole)) {
            return res.status(400).json({ message: "Role must be either donor or receiver." });
        }

        // 2. Check if user already exists
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: "Email already exists!" });
        }

        // 3. Hash the password (security step)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Create a new user
        const newUser = new User({
            username: username,
            email: email,
            password: hashedPassword,
            role: normalizedRole
        });

        // 5. Save to MongoDB
        const savedUser = await newUser.save();
        res.status(201).json({ message: "User registered successfully!", user: savedUser._id });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error", error: err.message });
    }
});

// LOGIN API
router.post('/login', async (req, res) => {
    try {
        // 1. Find User
        const user = await User.findOne({ email: req.body.email });
        if (!user) {
            return res.status(404).json({ message: "User not found!" });
        }

        // 2. NEW: Check if the role matches! 
        // (If the frontend sent a role, verify it. If not, skip this check)
        if (req.body.role && user.role !== req.body.role) {
            return res.status(403).json({ 
                message: `Access denied! This email is registered as a ${user.role}.` 
            });
        }

        // 3. Check Password
        const validPassword = await bcrypt.compare(req.body.password, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: "Wrong password!" });
        }

        // 4. Create Token
        const token = jwt.sign(
            { id: user._id, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: "3d" }
        );

        const { password, ...others } = user._doc; 
        res.status(200).json({ ...others, token });

    } catch (err) {
        res.status(500).json(err);
    }
});

// UPDATE USER PROFILE (Address/Phone)
router.put('/update/:id', async (req, res) => {
    try {
        const allowedFields = ['address', 'phone', 'organization'];
        const updates = {};

        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        });

        const existingUser = await User.findById(req.params.id);

        if (!existingUser) {
            return res.status(404).json({ message: "User not found" });
        }

        const addressChanged = updates.address !== undefined && updates.address !== existingUser.address;
        const updateOperation = { $set: updates };

        if (addressChanged) {
            updateOperation.$unset = {
                coordinates: "",
                geocodeProvider: "",
                geocodedAt: ""
            };
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            updateOperation,
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        const { password, ...safeUser } = updatedUser._doc;
        res.status(200).json(safeUser);
    } catch (err) {
        res.status(500).json(err);
    }
});
module.exports = router;
