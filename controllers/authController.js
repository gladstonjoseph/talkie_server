const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require('../models/database');

// User Registration
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if email already exists
    const existingUser = await db.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    await db.createUser(name, email, hashedPassword);

    res.json({ message: 'User registered successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// User Login
const login = async (req, res) => {
  try {
    const { email, password, app_instance_id } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!app_instance_id) {
      return res.status(400).json({ error: 'App instance ID is required' });
    }

    // Find user
    const user = await db.findUserByEmail(email);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create JWT
    // IMPORTANT: Use an environment variable for the secret key in a real production app
    const token = jwt.sign(
      { 
        userId: user.id,
        appInstanceId: app_instance_id
      },
      process.env.JWT_SECRET || 'your_super_secret_key_that_should_be_long_and_random',
            { expiresIn: '14d' } // Token expires in 14 days
    );

    // Save app_instance_id to the app_instances table
    try {
      await db.createAppInstance(user.id, app_instance_id);
      console.log(`App instance registered: ${app_instance_id} for user ${user.id}`);
    } catch (err) {
      console.error('Error saving app instance:', err);
      return res.status(500).json({ error: 'Failed to register app instance' });
    }

    res.json({
      message: 'Login successful',
      token: token,
      global_user_id: user.id,
      name: user.name,
      profile_picture_url: user.profile_picture_url
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  register,
  login
};