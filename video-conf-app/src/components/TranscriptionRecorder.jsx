import { useLocalParticipant } from '@livekit/components-react';
import useServerTranscript from '../useServerTranscript';

/**
 * Bridges LiveKit's local microphone track to the server-transcription hook.
 * Must be rendered INSIDE a <LiveKitRoom> so useLocalParticipant() works.
 */
function TranscriptionRecorder({
  isActive,
  username,
  serverUrl,
  onNewLine,
  chunkDurationMs = 5000,
  language,
}) {
  const { microphoneTrack, isMicrophoneEnabled } = useLocalParticipant();

  const audioTrack =
    microphoneTrack?.track?.mediaStreamTrack ??
    microphoneTrack?.audioTrack?.mediaStreamTrack ??
    null;

  useServerTranscript({
    audioTrack,
    isActive: isActive && isMicrophoneEnabled && !!audioTrack,
    username,
    serverUrl,
    onNewLine,
    chunkDurationMs,
    language,
  });

  return null;
}

export default TranscriptionRecorder;