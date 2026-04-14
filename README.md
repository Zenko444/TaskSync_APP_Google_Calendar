# TaskSync

Task manager app backed by **Google Calendar** with a **Node.js/Express** backend and **json-server** whitelist.

## Testing Purposes - motivation

If you need to test POST/DELETE/PUT/PATCH do it using Thunder Client (CTRL+SHIFT+R);
Note: AI has been used in the creation of this application. It was purely made to facilitate a faster way of adding events to the Google Calendar. Timer for pop-ups/mail notifications can be modified from .js file. You will need the CLIENT_ID from the Google Cloud/Google AI Studio. The app is in test mode, meaning that all users should be added manually on the authorized port. If you decide to publish it and make use of the db.json, let me know how it handles! ~ Zenko444/github

## Project Structure

```
tasksync/
├── frontend/
│   ├── web.html          ← App shell
│   ├── css/
│   │   └── interface.css       ← All styles
│   └── js/
│       └── CRUD_and_flow.js          ← Google auth + Calendar CRUD
├── backend/
│   ├── server.js           ← Express + json-server + auth route
│   ├── db.json             ← Whitelist database (edit to add users)
│   └── package.json
└── README.md
```

## Setup

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Start the server

```bash
node server.js
# or, for auto-reload:
npx nodemon server.js
```

Server runs at **http://localhost:3000**
- App UI:          http://localhost:3000
- Whitelist CRUD:  http://localhost:3000/api/db/allowedUsers
- Auth endpoint:   POST http://localhost:3000/api/auth/verify

### 3. Google Cloud Console

In your OAuth Client ID settings, add to **Authorized JavaScript origins**:
```
http://localhost:3000
```

---

## Managing the whitelist

The whitelist lives in `backend/db.json`. You can manage it two ways:

### Via the REST API (json-server)

```bash
# List all allowed users
curl http://localhost:3000/api/db/allowedUsers

# Add a user
curl -X POST http://localhost:3000/api/db/allowedUsers \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@gmail.com","name":"New User","role":"user","addedAt":"2026-04-15"}'

# Remove a user (use their id from the list)
curl -X DELETE http://localhost:3000/api/db/allowedUsers/2
```

### By editing db.json directly

```json
{
  "allowedUsers": [
    {
      "id": 1,
      "email": "safire@gmail.com",
      "name": "safire",
      "role": "admin",
      "addedAt": "2026-04-15"
    },
    {
      "id": 2,
      "email": "friend@gmail.com",
      "name": "Friend",
      "role": "user",
      "addedAt": "2026-04-15"
    }
  ]
}
```

---

## Auth Flow

```
User clicks "Sign in with Google"
        ↓
Google OAuth popup → access_token returned to frontend
        ↓
Frontend: POST /api/auth/verify { accessToken }
        ↓
Backend: calls Google userinfo API → gets email
        ↓
Backend: checks db.json allowedUsers for that email
        ↓
  ✅ Allowed → return { allowed: true, user: {...} }
  🚫 Denied  → return 403 { allowed: false, error: "..." }
        ↓
Frontend: shows app or "Access Denied" screen
```
