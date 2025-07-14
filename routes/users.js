const express = require('express');
const router = express.Router();
const { getUserProfile, updateUserProfile, searchUsers } = require('../controllers/userController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Search users - requires authentication
router.get('/search', authenticateToken, searchUsers);

// Get user profile - requires authentication
router.get('/:userId', authenticateToken, getUserProfile);

// Update user profile - requires authentication
router.put('/:userId', authenticateToken, updateUserProfile);

module.exports = router;