require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const jsonServer = require('json-server');
const fetch      = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Serve frontend as static files ────────────────────
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── Auth: verify Google token + check whitelist ────────
//
// Flow:
//   1. Frontend signs user in with Google OAuth → receives access_token
//   2. Frontend calls POST /api/auth/verify with { accessToken }
//   3. We call Google's userinfo endpoint to get the real email
//   4. We check our db.json allowedUsers for that email
//   5. Return { allowed, user } to the frontend
//
app.post('/api/auth/verify', async (req, res) => {
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken is required' });
  }

  try {
    // Step 1 — Fetch user info from Google
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Invalid or expired Google token' });
    }

    const googleUser = await googleRes.json();
    const email = googleUser.email?.toLowerCase();

    if (!email) {
      return res.status(401).json({ error: 'Could not retrieve email from Google' });
    }

    // Step 2 — Check whitelist in db.json via json-server router
    const db = require('./db.json');
    const match = db.allowedUsers.find(
      u => u.email.toLowerCase() === email
    );

    if (!match) {
      return res.status(403).json({
        allowed: false,
        error: `Access denied. ${email} is not on the allowed list.`
      });
    }

    return res.json({
      allowed: true,
      user: {
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        role: match.role
      }
    });

  } catch (err) {
    console.error('Auth verify error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Mount json-server for allowedUsers CRUD ───────────
//
//   GET    /api/db/allowedUsers        → list all
//   GET    /api/db/allowedUsers/:id    → get one
//   POST   /api/db/allowedUsers        → add new
//   PUT    /api/db/allowedUsers/:id    → replace
//   PATCH  /api/db/allowedUsers/:id    → update field
//   DELETE /api/db/allowedUsers/:id    → remove
//
const dbRouter     = jsonServer.router(path.join(__dirname, 'db.json'));
const dbMiddleware = jsonServer.defaults({ logger: false });
app.use('/api/db', dbMiddleware, dbRouter);

// ── Catch-all → serve frontend ─────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'web.html'));
});

// ── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  TaskSync backend running`);
  console.log(`   App:       http://localhost:${PORT}`);
  console.log(`   DB (CRUD): http://localhost:${PORT}/api/db/allowedUsers`);
  console.log(`   Auth:      POST http://localhost:${PORT}/api/auth/verify\n`);
});
