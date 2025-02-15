const express = require('express');
const pool = require('../config/database');
const router = express.Router();

// Get User by ID
router.get('/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Validate that userId is provided and is a number
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; 