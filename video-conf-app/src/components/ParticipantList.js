import { useEffect, useRef } from 'react';
import { useParticipants, useLocalParticipant } from '@livekit/components-react';

function ParticipantList({ onParticipants }) {
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  const onParticipantsRef = useRef(onParticipants);
  useEffect(() => { onParticipantsRef.current = onParticipants; }, [onParticipants]);

  useEffect(() => {
    const list = participants.map(p => {
      let photoURL = '';
      try { photoURL = JSON.parse(p.metadata || '{}').photoURL; } catch {}

      const isLocal = p.identity === localParticipant?.identity;

      return {
        identity:   p.identity,
        name:       p.name || p.identity,
        photoURL,
        isMicOn:    isLocal ? isMicrophoneEnabled : p.isMicrophoneEnabled,
        isCameraOn: isLocal ? isCameraEnabled     : p.isCameraEnabled,
        isSpeaking: p.isSpeaking,
        isLocal,
      };
    });

    onParticipantsRef.current?.(list);
  }, [participants, isMicrophoneEnabled, isCameraEnabled, localParticipant]);

  return null;
}

export default ParticipantList;