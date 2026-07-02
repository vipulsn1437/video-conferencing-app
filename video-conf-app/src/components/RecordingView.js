import React from 'react';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';
import AvatarPlaceholder from './AvatarPlaceholder';

const LIVEKIT_URL = process.env.REACT_APP_LIVEKIT_URL || 'ws://localhost:7880';

function RecordingView() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    return <div style={{ width: '100vw', height: '100vh', background: '#0a0a0f' }} />;
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0a0f', overflow: 'hidden' }}>
      <LiveKitRoom
        serverUrl={LIVEKIT_URL}
        token={token}
        connect={true}
        video={false}
        audio={false}
        data-lk-theme="default"
      >
        <VideoConference />
        <AvatarPlaceholder />
      </LiveKitRoom>
    </div>
  );
}

export default RecordingView;