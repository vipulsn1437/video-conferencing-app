import React, { useEffect, useRef, useState } from 'react';

const MicOnIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const MicOffIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const CameraOnIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z"/>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);

const CameraOffIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h2a2 2 0 0 1 2 2v9.34"/>
  </svg>
);

const MoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.8"/>
    <circle cx="12" cy="12" r="1.8"/>
    <circle cx="12" cy="19" r="1.8"/>
  </svg>
);

const RemoveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
  </svg>
);

function ParticipantRow({ p, isHost, onRemove, onMute }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const initials = (p.name || '?').slice(0, 2).toUpperCase();

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`participant-row ${p.isSpeaking ? 'speaking' : ''}`}>
      <div className="p-avatar-wrap">
        {p.photoURL ? (
          <img src={p.photoURL} alt={p.name} className="p-avatar-img" referrerPolicy="no-referrer" />
        ) : (
          <div className="p-avatar-initials">{initials}</div>
        )}
        {p.isSpeaking && <div className="p-speaking-ring" />}
      </div>

      <div className="p-info">
        <span className="p-name">
          {p.name}
          {p.isLocal && <span className="p-you-badge"> (You)</span>}
        </span>
      </div>

      <div className="p-icons">
        {p.isMicOn    ? <MicOnIcon />    : <MicOffIcon />}
        {p.isCameraOn ? <CameraOnIcon /> : <CameraOffIcon />}

        {isHost && !p.isLocal && (
          <div className="p-menu-wrap" ref={menuRef}>
            <button
              className="p-menu-btn"
              title="Manage participant"
              onClick={() => setMenuOpen(o => !o)}
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              <div className="p-menu-dropdown">
                {p.isMicOn && (
                  <button
                    className="p-menu-item"
                    onClick={() => { onMute?.(p.identity); setMenuOpen(false); }}
                  >
                    <MicOffIcon /> Mute
                  </button>
                )}
                <button
                  className="p-menu-item danger"
                  onClick={() => { onRemove?.(p.identity); setMenuOpen(false); }}
                >
                  <RemoveIcon /> Remove from meeting
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SidePanel({
  activeTab,
  setActiveTab,
  transcriptLines = [],
  interimText = '',
  summary,
  onGenerateSummary,
  isGenerating,
  onDownloadTranscript,
  onDownloadSummary,
  participants = [],
  isHost = false,
  onMuteAll,
  onMuteParticipant,
  onRemoveParticipant,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptLines, interimText]);

  return (
    <div className="side-panel">

      {/* Tabs */}
      <div className="panel-tabs">
        <button
          className={`tab ${activeTab === 'transcript' ? 'active' : ''}`}
          onClick={() => setActiveTab('transcript')}
        >
          Transcript
        </button>
        <button
          className={`tab ${activeTab === 'people' ? 'active' : ''}`}
          onClick={() => setActiveTab('people')}
        >
          People {participants.length > 0 && <span className="tab-count">{participants.length}</span>}
        </button>
        <button
          className={`tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          Summary
        </button>
      </div>

      {/* Transcript Tab */}
      {activeTab === 'transcript' && (
        <div className="panel-body">
          <div className="listening-indicator">
            <span className="listening-dot"></span> Listening...
          </div>

          {transcriptLines.length === 0 && !interimText && (
            <p className="summary-text">Start speaking — transcript will appear here...</p>
          )}

          {transcriptLines.map((line, i) => (
            <div className="transcript-bubble" key={i}>
              <div className="t-speaker">{line.speaker}</div>
              <div className="t-text">{line.text}</div>
              <div className="t-time">{line.time}</div>
            </div>
          ))}

          {interimText && (
            <div className="transcript-bubble">
              <div className="t-text interim-text">{interimText}</div>
            </div>
          )}

          <div ref={bottomRef} />

          {transcriptLines.length > 0 && (
            <button className="download-btn" onClick={onDownloadTranscript}>
              ⬇ Download Transcript
            </button>
          )}
        </div>
      )}

      {/* People Tab */}
      {activeTab === 'people' && (
        <div className="panel-body">
          {isHost && participants.length > 0 && (
            <button className="download-btn" onClick={onMuteAll}>
              🔇 Mute all
            </button>
          )}
          {participants.length === 0 ? (
            <p className="summary-text">No participants yet.</p>
          ) : (
            participants.map(p => (
              <ParticipantRow
                key={p.identity}
                p={p}
                isHost={isHost}
                onRemove={onRemoveParticipant}
                onMute={onMuteParticipant}
              />
            ))
          )}
        </div>
      )}

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <div className="panel-body">
          {summary ? (
            <div className="summary-content">
              {summary.split('\n').map((line, i) => {
                const cleanLine = line.replace(/\*\*/g, '');
                const isHeading = cleanLine.startsWith('1.') ||
                                  cleanLine.startsWith('2.') ||
                                  cleanLine.startsWith('3.') ||
                                  cleanLine.startsWith('Key') ||
                                  cleanLine.startsWith('Decision') ||
                                  cleanLine.startsWith('Action');
                return cleanLine.trim() ? (
                  <p key={i} className={`summary-line ${isHeading ? 'summary-heading' : ''}`}>
                    {cleanLine}
                  </p>
                ) : null;
              })}
            </div>
          ) : (
            <p className="summary-text">Click the button below to generate AI summary.</p>
          )}
          <button
            className="generate-btn"
            onClick={onGenerateSummary}
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating...' : '✨ Generate Summary'}
          </button>
          {summary && (
            <button className="download-btn" onClick={onDownloadSummary}>
              ⬇ Download Summary
            </button>
          )}
        </div>
      )}

    </div>
  );
}

export default SidePanel;