require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const LIVEKIT_API_KEY    = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_URL        = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const GROQ_KEY           = process.env.GROQ_API_KEY;
const PORT               = process.env.PORT || 5000;
const CLIENT_URL         = process.env.CLIENT_URL || 'http://localhost:3000';
const GROQ_MODEL         = 'llama-3.3-70b-versatile';

if (!GROQ_KEY) {
  console.error('❌  GROQ_API_KEY is not set — /summarize and /transcribe will not work.');
}


// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

// Simple request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── LiveKit Room Service ──────────────────────────────────────────────────────
const roomService = new RoomServiceClient(
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

// ── Host tracking (in-memory: room -> host identity) ─────────────────────────
const roomHosts = new Map();

// ── Rate limiter (manual, no extra deps) ─────────────────────────────────────
const summarizeHits = new Map();
function rateLimit(req, res, next) {
  const ip  = req.ip;
  const now = Date.now();
  const windowMs = 60_000;
  const max = 5;
  const entry = summarizeHits.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  summarizeHits.set(ip, entry);
  if (entry.count > max) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }
  next();
}

// ── Host-only guard ───────────────────────────────────────────────────────────
function requireHost(req, res, next) {
  const { room, requester } = req.body;
  if (!room || !requester) {
    return res.status(400).json({ error: 'room and requester are required.' });
  }
  if (roomHosts.get(room) !== requester) {
    return res.status(403).json({ error: 'Only the host can do that.' });
  }
  next();
}
// ── /token ────────────────────────────────────────────────────────────────────
app.get('/token', async (req, res) => {
  const username = req.query.username?.trim();
  const room     = req.query.room?.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const create   = req.query.create === 'true';
  const photoURL = req.query.photoURL?.trim() || '';

  if (!username || !room) {
    return res.status(400).json({ error: 'username and room are required.' });
  }
  if (username.length > 50 || room.length > 50) {
    return res.status(400).json({ error: 'username and room must be under 50 characters.' });
  }
  if (photoURL.length > 500) {
    return res.status(400).json({ error: 'photoURL is too long.' });
  }

  if (!create) {
    try {
      const rooms = await roomService.listRooms([room]);
      if (rooms.length === 0 || rooms[0].numParticipants === 0) {
        return res.status(404).json({ error: 'Meeting not found. Check the room ID and try again.' });
      }
    } catch (err) {
      console.error('Room check error:', err);
      return res.status(500).json({ error: 'Could not verify room. Is LiveKit running?' });
    }
  }

  if (create && !roomHosts.has(room)) {
    roomHosts.set(room, username);
  }
  const isHost = roomHosts.get(room) === username;

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: username,
      name: username,
      ttl: '2h',
      metadata: JSON.stringify({ photoURL, isHost }),
    });
    at.addGrant({
      roomJoin:     true,
      room,
      canPublish:   true,
      canSubscribe: true,
    });
    const token = await at.toJwt();
    res.json({ token, isHost });
  } catch (err) {
    console.error('Token error:', err);
    res.status(500).json({ error: 'Failed to generate token.' });
  }
});

// ── /host/mute-all ────────────────────────────────────────────────────────────

app.post('/host/mute-all', requireHost, async (req, res) => {
  const { room, requester } = req.body;
  try {
    const participants = await roomService.listParticipants(room);
    const results = await Promise.allSettled(
      participants
        .filter(p => p.identity !== requester)
        .flatMap(p =>
          (p.tracks || [])
            .filter(t => t.type === 'AUDIO' || t.type === 0)
            .map(t => roomService.mutePublishedTrack(room, p.identity, t.sid, true))
        )
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    res.json({ ok: true, mutedTracks: results.length - failed, failed });
  } catch (err) {
    console.error('Mute-all error:', err);
    res.status(500).json({ error: 'Failed to mute participants.' });
  }
});

// ── /host/mute-participant ────────────────────────────────────────────────────
app.post('/host/mute-participant', requireHost, async (req, res) => {
  const { room, target } = req.body;
  if (!target) return res.status(400).json({ error: 'target is required.' });
  try {
    const participants = await roomService.listParticipants(room);
    const p = participants.find(pp => pp.identity === target);
    if (!p) return res.status(404).json({ error: 'Participant not found.' });

    const results = await Promise.allSettled(
      (p.tracks || [])
        .filter(t => t.type === 'AUDIO' || t.type === 0)
        .map(t => roomService.mutePublishedTrack(room, target, t.sid, true))
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    res.json({ ok: true, mutedTracks: results.length - failed, failed });
  } catch (err) {
    console.error('Mute-participant error:', err);
    res.status(500).json({ error: 'Failed to mute participant.' });
  }
});

// ── /host/remove-participant ──────────────────────────────────────────────────
app.post('/host/remove-participant', requireHost, async (req, res) => {
  const { room, target } = req.body;
  if (!target) return res.status(400).json({ error: 'target is required.' });
  try {
    await roomService.removeParticipant(room, target);
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove-participant error:', err);
    res.status(500).json({ error: 'Failed to remove participant.' });
  }
});

// ── /summarize ────────────────────────────────────────────────────────────────
app.post('/summarize', rateLimit, async (req, res) => {
  const transcript = req.body.transcript?.trim();
  if (!transcript) {
    return res.status(400).json({ error: 'transcript is required.' });
  }
  if (transcript.length > 50_000) {
    return res.status(400).json({ error: 'Transcript too long (max 50,000 characters).' });
  }
  if (!GROQ_KEY) {
    return res.status(503).json({ error: 'GROQ_KEY not configured on server.' });
  }
  try {
    const { data } = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: GROQ_MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Summarize this meeting transcript into 3 sections:
1. Key Topics Discussed
2. Decisions Made
3. Action Items
Be concise. Use bullet points under each section.
Transcript:
${transcript}`,
        }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_KEY}`,
        },
        timeout: 60_000,
      }
    );
    const summary = data.choices?.[0]?.message?.content;
    if (!summary) {
      console.error('Unexpected Groq response:', data);
      return res.status(502).json({ error: 'Groq returned no content.' });
    }
    res.json({ summary });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg = err.response?.data?.error?.message || err.message || 'Internal server error.';
    console.error('Summarize error:', status, msg, err.response?.data);
    res.status(status >= 400 && status < 600 ? 502 : 500).json({ error: msg });
  }
});

// ── /transcribe ───────────────────────────────────────────────────────────────
const transcribeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB (Groq Whisper limit)
});

// Simple per-IP rate limiter for transcribe
const transcribeHits = new Map();
function transcribeRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60_000;
  const max = 40;
  const entry = transcribeHits.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  transcribeHits.set(ip, entry);
  if (entry.count > max) {
    return res.status(429).json({ error: 'Too many transcribe requests.' });
  }
  next();
}

app.post('/transcribe', transcribeRateLimit, transcribeUpload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded.' });
  }
  if (!GROQ_KEY) {
    return res.status(503).json({ error: 'GROQ_KEY not configured on server.' });
  }

  try {
    const mime = req.file.mimetype || 'audio/webm';
    const ext =
      mime.includes('mp4')  ? 'm4a' :
      mime.includes('ogg')  ? 'ogg' :
      mime.includes('wav')  ? 'wav' :
      mime.includes('mpeg') ? 'mp3' :
      'webm';

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || `chunk.${ext}`,
      contentType: mime,
      knownLength: req.file.buffer.length,
    });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (req.body.language) form.append('language', req.body.language);

    const { data } = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${GROQ_KEY}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120_000,
      }
    );

    res.json({ text: (data.text || '').trim() });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg =
      err.response?.data?.error?.message ||
      (typeof err.response?.data === 'string' ? err.response.data : null) ||
      err.message ||
      'Transcription failed.';
    console.error('Transcribe error:', status, msg, err.response?.data);
    res.status(status >= 400 && status < 600 ? 502 : 500).json({ error: msg });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    groq: !!GROQ_KEY,
    livekit: !!GROQ_KEY && LIVEKIT_API_KEY !== 'devkey',
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Server running on http://localhost:${PORT}`);
  console.log(`    GROQ:    ${GROQ_KEY ? '✅ configured' : '❌ missing'}`);
  console.log(`    LiveKit: ${LIVEKIT_API_KEY !== 'devkey' ? '✅ configured' : '⚠️  using devkey'}`);
});