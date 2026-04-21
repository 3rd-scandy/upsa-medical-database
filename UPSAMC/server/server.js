const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../university-medical')));

// ─── In-memory session store ───────────────────────────────────────────────
// { sessionId -> { sessionId, staffName, loginTime, logoutTime|null } }
const sessions = new Map();

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function getSessionsPayload() {
  const all = Array.from(sessions.values());
  return {
    type: 'sessions_update',
    active: all.filter(s => !s.logoutTime),
    past:   all.filter(s =>  s.logoutTime).slice().reverse()
  };
}

// ─── REST API ──────────────────────────────────────────────────────────────

// POST /api/login  { staffName }  → { sessionId }
app.post('/api/login', (req, res) => {
  const { staffName } = req.body;
  if (!staffName) return res.status(400).json({ error: 'staffName required' });

  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const entry = { sessionId, staffName, loginTime: new Date().toISOString(), logoutTime: null };
  sessions.set(sessionId, entry);

  broadcast(getSessionsPayload());
  res.json({ sessionId });
});

// POST /api/logout  { sessionId }
app.post('/api/logout', (req, res) => {
  const { sessionId } = req.body;
  const entry = sessions.get(sessionId);
  if (!entry) return res.status(404).json({ error: 'Session not found' });

  entry.logoutTime = new Date().toISOString();
  broadcast(getSessionsPayload());
  res.json({ ok: true });
});

// GET /api/sessions
app.get('/api/sessions', (req, res) => {
  res.json(getSessionsPayload());
});

// ─── WebSocket ─────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  // Send current state immediately on connect
  ws.send(JSON.stringify(getSessionsPayload()));
});

// ─── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`UPSAMC server running at http://localhost:${PORT}`);
});
