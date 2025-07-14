const userService = require('../services/userService');

// Get user profile
const getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await userService.getUserProfile(userId);
    
    if (result.status === 'success') {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error in getUserProfile controller:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch user profile'
    });
  }
};

// Update user profile
const updateUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { profilePictureUrl } = req.body;
    
    const result = await userService.updateUserProfile(userId, profilePictureUrl);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in updateUserProfile controller:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// Search users
const searchUsers = async (req, res) => {
  try {
    const { query } = req.query;
    
    const result = await userService.searchUsers(query);
    
    res.json(result);
  } catch (error) {
    console.error('Error in searchUsers controller:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error searching users'
    });
  }
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  searchUsers
};