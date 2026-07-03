import { useEffect, useRef } from 'react';
import { useParticipants } from '@livekit/components-react';

function ParticipantCount({ onCount }) {
  const participants = useParticipants();

  
  const onCountRef = useRef(onCount);
  useEffect(() => { onCountRef.current = onCount; }, [onCount]);

  useEffect(() => {
    onCountRef.current?.(participants.length);
  }, [participants.length]);

  return null;
}

export default ParticipantCount;