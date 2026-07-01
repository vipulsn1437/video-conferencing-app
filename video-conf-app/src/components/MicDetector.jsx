import { useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';

function MicDetector({ onMicChange }) {
  const { isMicrophoneEnabled } = useLocalParticipant();

  // Stable ref — avoids stale closure if onMicChange identity changes
  const onMicChangeRef = useRef(onMicChange);
  useEffect(() => { onMicChangeRef.current = onMicChange; }, [onMicChange]);

  useEffect(() => {
    onMicChangeRef.current?.(isMicrophoneEnabled);
  }, [isMicrophoneEnabled]);

  return null;
}

export default MicDetector;