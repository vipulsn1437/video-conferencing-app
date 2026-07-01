import { useEffect, useRef } from 'react';
import { useParticipants } from '@livekit/components-react';

function ParticipantCount({ onCount }) {
  const participants = useParticipants();

  // Stable ref — avoids stale closure if onCount identity changes
  const onCountRef = useRef(onCount);
  useEffect(() => { onCountRef.current = onCount; }, [onCount]);

  useEffect(() => {
    onCountRef.current?.(participants.length);
  }, [participants.length]);

  return null;
}

export default ParticipantCount;