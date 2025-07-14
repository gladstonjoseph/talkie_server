const db = require('../models/database');

class UserService {
  constructor() {
    this.db = db;
  }

  async searchUsers(query) {
    try {
      console.log('Searching users for query:', query);
      
      if (!query) {
        return {
          status: 'success',
          users: []
        };
      }

      const result = await this.db.searchUsers(query);

      console.log(`Found ${result.rows.length} users for query: ${query}`);
      
      return {
        status: 'success',
        users: result.rows
      };
    } catch (err) {
      console.error('Error searching users via WebSocket:', err);
      return {
        status: 'error',
        message: 'Error searching users'
      };
    }
  }

  async getUserProfile(globalUserId) {
    try {
      console.log('Fetching user profile for user ID:', globalUserId);
      
      const user = await this.db.findUserById(globalUserId);
      
      if (user) {
        console.log('User profile fetched successfully for user ID:', globalUserId);
        return {
          status: 'success',
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            profile_picture_url: user.profile_picture_url
          }
        };
      } else {
        console.log('User not found for user ID:', globalUserId);
        return {
          status: 'error',
          message: 'User not found'
        };
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return {
        status: 'error',
        message: 'Failed to fetch user profile'
      };
    }
  }

  async updateUserProfile(globalUserId, profilePictureUrl) {
    try {
      const result = await this.db.updateUserProfilePicture(globalUserId, profilePictureUrl);

      if (result.rows.length > 0) {
        return { success: true };
      } else {
        return { success: false, error: 'User not found' };
      }
    } catch (error) {
      console.error('Error updating profile picture URL:', error);
      return { success: false, error: 'Server error' };
    }
  }

  async deleteAppInstance(userId, appInstanceId) {
    try {
      console.log('Deleting app instance:', appInstanceId, 'for user:', userId);
      
      const result = await this.db.deleteAppInstance(userId, appInstanceId);

      if (result.rows.length > 0) {
        console.log(`App instance ${appInstanceId} deleted successfully for user ${userId}`);
        return {
          status: 'success',
          message: 'App instance deleted successfully'
        };
      } else {
        console.log(`App instance ${appInstanceId} not found for user ${userId}`);
        return {
          status: 'error',
          message: 'App instance not found'
        };
      }
    } catch (error) {
      console.error('Error deleting app instance:', error);
      return {
        status: 'error',
        message: 'Failed to delete app instance'
      };
    }
  }
}

module.exports = new UserService();