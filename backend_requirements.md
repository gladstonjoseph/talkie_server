# Backend Requirements Document

## Overview
This document outlines the detailed requirements for the backend of a real-time chat application. The backend will provide user authentication, user search, and WebSocket-based ephemeral messaging.

### Key Design Decisions
- No persistent message storage; messages will only exist in real-time.
- No tracking of online/offline status; the backend will check if a user is online only when sending a message.
- The iOS app will handle message retries if a user is offline.
- Users must be able to **sign up with their name, email, and password**.

---

## 1. User Authentication (Email & Password)
The backend must allow users to register and log in using an email and password.

### 1.1 User Registration
- **1.1.1 Set up an Express route for user signup (`POST /api/register`).**  
  - The request body must include:
    ```json
    {
      "name": "John Doe",
      "email": "user@example.com",
      "password": "password123"
    }
    ```
  - If any field is missing, return a `400 Bad Request` error.

- **1.1.2 Validate input fields.**  
  - Ensure the **email is in valid format**.  
  - Ensure the **password is at least 6 characters** long.  
  - If validation fails, return an appropriate error message.

- **1.1.3 Store the user's information in PostgreSQL.**  
  - Create a `users` table in PostgreSQL with the following schema:
    ```sql
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
    ```
  - Insert the user into the database when they register.

- **1.1.4 Return a success message.**  
  - If registration is successful:
    ```json
    {
      "message": "User registered successfully"
    }
    ```
  - If the email is already taken:
    ```json
    {
      "error": "Email already in use"
    }
    ```

---

### 1.2 User Login
- **1.2.1 Set up an Express route for user login (`POST /api/login`).**  
  - The request body must contain:
    ```json
    {
      "email": "user@example.com",
      "password": "password123"
    }
    ```
  - If either field is missing, return `400 Bad Request`.

- **1.2.2 Retrieve the user’s email and password from the database.**  
  - Query the database to check if the email exists.

- **1.2.3 If the provided password matches the stored password, return a success message.**  
  - If login is successful:
    ```json
    {
      "message": "Login successful",
      "userId": 1,
      "name": "John Doe"
    }
    ```
  - If the credentials are incorrect:
    ```json
    {
      "error": "Invalid email or password"
    }
    ```

---

## 2. User Search
The backend must allow users to search for other users by name or email.

### 2.1 Implement User Search API
- **2.1.1 Set up an Express route for searching users (`GET /api/users?query=<search_term>`).**  
  - This endpoint allows searching by name or email.

- **2.1.2 Query the database for users matching the search term.**  
  - Use a case-insensitive SQL query to find users:
    ```sql
    SELECT id, name, email FROM users
    WHERE LOWER(name) LIKE LOWER('%search_term%')
    OR LOWER(email) LIKE LOWER('%search_term%');
    ```

- **2.1.3 Return the list of matching users.**  
  - The response should be an array of users:
    ```json
    [
      {
        "id": 1,
        "name": "John Doe",
        "email": "johndoe@example.com"
      },
      {
        "id": 2,
        "name": "Jane Doe",
        "email": "janedoe@example.com"
      }
    ]
    ```
  - If no users are found, return an empty array `[]`.

---

## 3. Real-Time Chat (Ephemeral Messaging)
The backend will facilitate real-time messaging between users using WebSockets. Messages are **not stored** on the backend.

### 3.1 WebSocket Server Setup
- **3.1.1 Install and configure `socket.io` in the Node.js backend.**  
  - Install dependencies:
    ```sh
    npm install express socket.io cors
    ```
  - Set up an Express server with WebSocket support:
    ```javascript
    const express = require("express");
    const http = require("http");
    const { Server } = require("socket.io");

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: "*" } });

    server.listen(3000, () => console.log("Server running on port 3000"));
    ```

- **3.1.2 Create a WebSocket connection handler (`io.on("connection")`).**  
  - When a user connects, they must register their user ID with the socket:
    ```javascript
    io.on("connection", (socket) => {
        socket.on("register", (userId) => {
            socket.userId = userId;
        });
    });
    ```

### 3.2 Sending Messages
- **3.2.1 Define a WebSocket event for sending messages (`socket.emit("send_message")`).**  
  - The message payload must include:
    ```json
    {
      "to": "user_b_id",
      "from": "user_a_id",
      "message": "Hey, what's up?"
    }
    ```

- **3.2.2 Check if the recipient has an active WebSocket connection.**  
  ```javascript
  io.on("connection", (socket) => {
      socket.on("send_message", ({ to, from, message }) => {
          const recipientSocket = findSocketByUserId(to);
          if (recipientSocket) {
              recipientSocket.emit("receive_message", { from, message });
          } else {
              socket.emit("message_not_delivered", { to, message });
          }
      });
  });

  function findSocketByUserId(userId) {
      return [...io.sockets.sockets.values()].find(s => s.userId === userId);
  }
  ```
