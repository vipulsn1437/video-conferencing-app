import React, { useState, useEffect, useCallback } from 'react';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';
import SidePanel from './components/SidePanel';
import MicDetector from './components/MicDetector';
import ParticipantCount from './components/ParticipantCount';
import ParticipantList from './components/ParticipantList';
import './App.css';
import useTranscript from './useTranscript';
import useSharedTranscript from './useSharedTranscript';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import AuthScreen from './components/AuthScreen';
import AvatarPlaceholder from './components/AvatarPlaceholder';
import { auth } from './firebase';

async function authedFetch(url, options = {}) {
  const token = await auth.currentUser?.getIdToken();
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

const SERVER = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
const LIVEKIT_URL = process.env.REACT_APP_LIVEKIT_URL || 'ws://localhost:7880';

function generateRoomId() {
  const seg = () => Math.random().toString(36).slice(2, 6);
  return `meet-${seg()}-${seg()}`;
}

function App() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [user, setUser] = useState(undefined);

  // ── State ─────────────────────────────────────────────────────────────────
  const [token, setToken]                       = useState(null);
  const [username, setUsername]                 = useState('');
  const [room, setRoom]                         = useState('');
  const [joined, setJoined]                     = useState(false);
  const [activeTab, setActiveTab]               = useState('transcript');
  const [timer, setTimer]                       = useState('00:00:00');
  const [meetingStartTime, setMeetingStartTime] = useState(null);
  const [transcriptLines, setTranscriptLines]   = useState([]);
  const [interimText, setInterimText]           = useState('');
  const [isMicOn, setIsMicOn]                   = useState(false);
  const [summary, setSummary]                   = useState('');
  const [isGenerating, setIsGenerating]         = useState(false);
  const [isListening, setIsListening]           = useState(true);
  const [isJoining, setIsJoining]               = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [joinError, setJoinError]               = useState('');
  const [participants, setParticipants]         = useState([]);
  const [isHost, setIsHost]                     = useState(false);

  // ── Join screen mode ──────────────────────────────────────────────────────
  const [mode, setMode]                   = useState('create');
  const [generatedRoom, setGeneratedRoom] = useState(() => generateRoomId());
  const [joinInput, setJoinInput]         = useState('');
  const [copyLabel, setCopyLabel]         = useState('Copy link');

  // ── Auth effects ──────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(auth, u => setUser(u ?? null));
  }, []);

  useEffect(() => {
  if (user?.displayName && !username) {
    setUsername(user.displayName);
  }
}, [user, username]);

  useEffect(() => {
    if (user === null) {
      setJoined(false);
      setToken(null);
      setRoom('');
      setUsername('');
      setTranscriptLines([]);
      setSummary('');
      setTimer('00:00:00');
      setMeetingStartTime(null);
      setActiveTab('transcript');
      setInterimText('');
      setJoinError('');
      setIsMicOn(false);
      setParticipantCount(0);
      setParticipants([]);
      setIsHost(false);
      setMode('create');
      setGeneratedRoom(generateRoomId());
      setJoinInput('');
    }
  }, [user]);

  const toggleListening = useCallback(() => setIsListening(prev => !prev), []);

  // ── Shared transcript (Firebase) ──────────────────────────────────────────
  const handleNewLine = useCallback((line) => {
    setTranscriptLines(prev => {
      if (prev.some(l => l.speaker === line.speaker && l.text === line.text)) return prev;
      return [...prev, line];
    });
  }, []);

  const { saveTranscriptLine } = useSharedTranscript(
    joined ? room : null,
    handleNewLine,
    useCallback((startMs) => setMeetingStartTime(startMs), [])
  );

  // ── Local speech recognition ──────────────────────────────────────────────
  useTranscript(
    username,
    useCallback((line) => saveTranscriptLine(line), [saveTranscriptLine]),
    useCallback((interim) => setInterimText(interim), []),
    isMicOn && isListening
  );

  // ── Meeting timer (synced to shared startedAt) ────────────────────────────
  useEffect(() => {
    if (!joined || !meetingStartTime) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000);
      const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      setTimer(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [joined, meetingStartTime]);

  // ── Join room ─────────────────────────────────────────────────────────────
  const joinRoom = async () => {
    const trimmedName = username.trim();

    let roomName;
    if (mode === 'create') {
      roomName = generatedRoom;
    } else {
      let raw = joinInput.trim();
      const match = raw.match(/[?&]room=([^&]+)/);
      if (match) raw = decodeURIComponent(match[1]);
      roomName = raw;
    }

    if (!trimmedName) { setJoinError('Please enter your name.'); return; }
    if (!roomName)    { setJoinError('Please enter a room ID or link.'); return; }

    setJoinError('');
    setIsJoining(true);
    setTranscriptLines([]);
    setSummary('');
    setTimer('00:00:00');
    setMeetingStartTime(null);

    try {
     const res = await authedFetch(
  `${SERVER}/token?username=${encodeURIComponent(trimmedName)}&room=${encodeURIComponent(roomName)}&create=${mode === 'create'}&photoURL=${encodeURIComponent(user?.photoURL || '')}`
);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Server error');
      }
      const data = await res.json();
      setToken(data.token);
      setRoom(roomName);
      setIsHost(!!data.isHost);
      setJoined(true);
    } catch (err) {
      setJoinError(err.message || 'Could not connect to server. Is the backend running?');
    } finally {
      setIsJoining(false);
    }
  };

  // ── Copy share link ───────────────────────────────────────────────────────
  const copyShareLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(generatedRoom)}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopyLabel('Copied!');
    setTimeout(() => setCopyLabel('Copy link'), 2000);
  };

  // ── Switch mode ───────────────────────────────────────────────────────────
  const switchMode = (m) => {
    setMode(m);
    setJoinError('');
  };

  // ── Generate summary ──────────────────────────────────────────────────────
  const generateSummary = async () => {
    if (transcriptLines.length === 0) return alert('No transcript yet — speak first!');
    setIsGenerating(true);
    const transcript = transcriptLines.map(l => `${l.speaker}: ${l.text}`).join('\n');
    try {
      const res = await fetch(`${SERVER}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Server error');
      }
      const data = await res.json();
      setSummary(data.summary);
      setActiveTab('summary');
    } catch (err) {
      alert(`Error generating summary: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Host actions ──────────────────────────────────────────────────────────
 const muteAllParticipants = useCallback(async () => {
  try {
    const res = await authedFetch(`${SERVER}/host/mute-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
  } catch (err) {
    alert(`Error muting participants: ${err.message}`);
  }
}, [room]);

const muteParticipant = useCallback(async (targetIdentity) => {
  try {
    const res = await authedFetch(`${SERVER}/host/mute-participant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room,
        target: targetIdentity,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
  } catch (err) {
    alert(`Error muting participant: ${err.message}`);
  }
}, [room]);

const removeParticipant = useCallback(async (targetIdentity) => {
  if (!window.confirm(`Remove ${targetIdentity} from the meeting?`)) return;

  try {
    const res = await authedFetch(`${SERVER}/host/remove-participant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room,
        target: targetIdentity,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
  } catch (err) {
    alert(`Error removing participant: ${err.message}`);
  }
}, [room]);

  // ── Downloads ─────────────────────────────────────────────────────────────
  const downloadTranscript = useCallback(() => {
    const text = transcriptLines.map(l => `[${l.time}] ${l.speaker}: ${l.text}`).join('\n');
    triggerDownload(text, 'transcript.txt');
  }, [transcriptLines]);

  const downloadSummary = useCallback(() => {
    triggerDownload(summary, 'summary.txt');
  }, [summary]);

  // ── Leave room ────────────────────────────────────────────────────────────
  const leaveRoom = useCallback(() => {
    setJoined(false);
    setToken(null);
    setRoom('');
    setTranscriptLines([]);
    setSummary('');
    setTimer('00:00:00');
    setMeetingStartTime(null);
    setActiveTab('transcript');
    setInterimText('');
    setIsMicOn(false);
    setParticipantCount(0);
    setParticipants([]);
    setIsHost(false);
    setGeneratedRoom(generateRoomId());
    setIsListening(true);
  }, []);

  // ── Auth gates ────────────────────────────────────────────────────────────
  if (user === undefined) return (
    <div className="join-screen">
      <div style={{ color: '#444', fontSize: 14 }}>Loading…</div>
    </div>
  );

  if (!user) return <AuthScreen />;

  // ── Join screen ───────────────────────────────────────────────────────────
  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <div className="join-signout-row">
            <span className="join-user-email">{user.email}</span>
            <button className="join-signout-btn" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
          <div className="join-logo">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
              stroke="#1D9E75" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <h1>Video Conference</h1>
          <p className="join-note">Best experienced in Google Chrome</p>

          <div className="join-tabs">
            <button
              className={`join-tab ${mode === 'create' ? 'active' : ''}`}
              onClick={() => switchMode('create')}
            >
              Create meeting
            </button>
            <button
              className={`join-tab ${mode === 'join' ? 'active' : ''}`}
              onClick={() => switchMode('join')}
            >
              Join meeting
            </button>
          </div>

          <div className="join-form">
            <div className="input-group">
              <label className="input-label">Your Name</label>
              <input
                className="join-input"
                placeholder="e.g. Alex"
                value={username}
                onChange={e => { setUsername(e.target.value); setJoinError(''); }}
                onKeyDown={e => e.key === 'Enter' && joinRoom()}
                autoFocus
              />
            </div>

            {mode === 'create' && (
              <div className="input-group">
                <label className="input-label">Room ID — share this with others</label>
                <div className="room-id-row">
                  <input
                    className="join-input room-id-input"
                    value={generatedRoom}
                    readOnly
                  />
                  <button className="copy-link-btn" onClick={copyShareLink}>
                    {copyLabel}
                  </button>
                </div>
                <p className="room-hint">
                  Anyone with the link or room ID can join this meeting.
                </p>
              </div>
            )}

            {mode === 'join' && (
              <div className="input-group">
                <label className="input-label">Room ID or link</label>
                <input
                  className="join-input"
                  placeholder="e.g. meet-k7xp2-qn3 or paste link"
                  value={joinInput}
                  onChange={e => { setJoinInput(e.target.value); setJoinError(''); }}
                  onKeyDown={e => e.key === 'Enter' && joinRoom()}
                />
              </div>
            )}

            {joinError && <p className="join-error">{joinError}</p>}

            <button className="join-btn" onClick={joinRoom} disabled={isJoining}>
              {isJoining ? (
                <><span className="btn-spinner" /> Connecting…</>
              ) : mode === 'create' ? 'Create & join room' : 'Join room'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Meeting screen ────────────────────────────────────────────────────────
  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span className="meeting-title">Video Conference</span>
          <span className="room-badge">#{room}</span>
          {isHost && <span className="host-badge">Host</span>}
        </div>
        <div className="topbar-right">
          <span className="participant-count">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {participantCount}
          </span>
          <span className="meeting-timer">{timer}</span>
        </div>
      </div>
      <div className="main">
        <div className="video-section">
          <LiveKitRoom
            serverUrl={LIVEKIT_URL}
            token={token}
            connect={true}
            video={false}
            audio={{
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }}
            data-lk-theme="default"
            onDisconnected={leaveRoom}
          >
            <VideoConference />
            <AvatarPlaceholder />
            <MicDetector onMicChange={setIsMicOn} />
            <ParticipantCount onCount={setParticipantCount} />
            <ParticipantList onParticipants={setParticipants} />
          </LiveKitRoom>
        </div>
        <SidePanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          transcriptLines={transcriptLines}
          interimText={interimText}
          summary={summary}
          onGenerateSummary={generateSummary}
          isGenerating={isGenerating}
          onDownloadTranscript={downloadTranscript}
          onDownloadSummary={downloadSummary}
          isListening={isListening}
          onToggleListening={toggleListening}
          participants={participants}
          isHost={isHost}
          onMuteAll={muteAllParticipants}
          onMuteParticipant={muteParticipant}
          onRemoveParticipant={removeParticipant}
        />
      </div>
    </div>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────
function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default App;