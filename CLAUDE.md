# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Talkie Server is a real-time chat backend built with Node.js, Express, Socket.IO, and PostgreSQL. It provides authentication, messaging, user management, and real-time communication features for the Talkie mobile app.

## Development Commands

### Basic Operations
- `npm start` - Start the server (production mode)
- `node app.js` - Start the server directly

### Database Management
The database configuration includes a `FLUSH_DATABASE_ON_START` flag in `config/database.js:12`. When set to `true`, it will drop and recreate all tables on startup. Use with caution.

## Architecture Overview

### Core Components

**Entry Point (`app.js`)**
- Express server setup with CORS and JSON middleware
- Socket.IO server initialization
- Database table initialization
- Route mounting for `/api` (auth) and `/api/users` (user operations)

**Database Layer**
- `config/database.js` - PostgreSQL connection pool and table management
- `models/database.js` - Database abstraction layer with methods for users, messages, and app instances

**Authentication System**
- JWT-based authentication for both HTTP and Socket.IO connections
- `middleware/authMiddleware.js` - HTTP request authentication
- `middleware/socketAuthMiddleware.js` - Socket.IO connection authentication
- `controllers/authController.js` - Registration and login logic

**Real-time Communication**
- `services/socketService.js` - Main Socket.IO event handler
- `utils/broadcast.js` - User connection tracking and message broadcasting
- Supports individual and group messaging with delivery/read receipts

**Key Socket.IO Events:**
- `send_message` - Send individual messages
- `send_group_message` - Send messages to multiple recipients
- `get_messages` - Retrieve undelivered messages
- `set_delivery_status` / `set_read_status` - Update message status
- `search_users` - Search for users
- `user_profile_update` - Update user profile

### Database Schema

**Users Table:**
- `id` (SERIAL PRIMARY KEY)
- `name`, `email`, `password` (hashed)
- `profile_picture_url`

**Messages Table:**
- Supports both individual and group messages
- Tracks delivery and read status with timestamps
- Includes sender/recipient tracking and local message IDs
- Supports file attachments via `file_info` JSONB column

**App Instances Table:**
- Tracks different app installations per user
- Used for push notifications and connection management

### Authentication Flow

1. **Registration:** POST `/api/register` with name, email, password
2. **Login:** POST `/api/login` with email, password, and `app_instance_id`
3. **JWT Token:** Contains `userId` and `appInstanceId`, expires in 14 days
4. **Socket Connection:** Requires JWT token in auth header for Socket.IO connections

### Message System Architecture

- Messages are stored per recipient (not per conversation)
- Group messages create individual message records for each recipient
- Real-time delivery via Socket.IO with fallback to database polling
- Delivery/read receipts are tracked separately and broadcast to senders

### Connection Management

The `utils/broadcast.js` module maintains active user connections:
- Maps user IDs to their active Socket.IO connections
- Handles multiple app instances per user
- Automatically cleans up disconnected sessions

## Important Implementation Details

### Security
- JWT secret defaults to hardcoded value - should use `JWT_SECRET` environment variable
- Database credentials are hardcoded in `config/database.js:5` - should be moved to environment variables
- CORS allows all origins (`*`) - should be restricted in production

### Database Connection
- Uses PostgreSQL with connection pooling
- Database URL is currently hardcoded and should be moved to environment variables
- SSL is enabled with `rejectUnauthorized: false`

### Socket.IO Configuration
- Enforces WebSocket-only transport (no HTTP polling)
- CORS configured to allow all origins
- 10-second ping interval, 5-second ping timeout

### Error Handling
- Basic error logging to console
- Socket.IO errors emit `message_error` events
- HTTP errors return standard JSON error responses

## Recent Refactoring

The codebase was recently refactored from a monolithic `app.js` file into a modular architecture. See `docs/codebase_refactor.md` for details. All functionality was preserved during this refactoring.

## Development Notes

- The server expects a PostgreSQL database to be available
- No test framework is currently configured
- No linting or code formatting tools are configured
- Server uses basic console logging (no structured logging framework)