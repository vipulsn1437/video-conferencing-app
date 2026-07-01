import { useEffect, useRef } from 'react';

/**
 * Server-side transcription hook.
 * Records the local LiveKit mic track in fixed-length chunks via MediaRecorder,
 * uploads each chunk to POST /transcribe (Groq Whisper), and invokes onNewLine()
 * with the returned text.
 *
 * Works on desktop AND mobile because it reuses the SAME mic stream LiveKit
 * already opened — no second getUserMedia call → no Chrome / WebRTC conflict.
 */
const useServerTranscript = ({
  audioTrack,          // MediaStreamTrack from LiveKit local mic
  isActive,
  username,
  serverUrl,
  onNewLine,
  chunkDurationMs = 5000,
  language,            // optional ISO code, e.g. 'en'
}) => {
  const onNewLineRef = useRef(onNewLine);
  const usernameRef  = useRef(username);
  const activeRef    = useRef(isActive);
  const mountedRef   = useRef(true);
  const recorderRef  = useRef(null);
  const stopTimerRef = useRef(null);
  const lastTextRef  = useRef('');

  useEffect(() => { onNewLineRef.current = onNewLine; }, [onNewLine]);
  useEffect(() => { usernameRef.current  = username;  }, [username]);
  useEffect(() => { activeRef.current    = isActive;  }, [isActive]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isActive || !audioTrack) return;
    if (typeof MediaRecorder === 'undefined') {
      console.warn('MediaRecorder not supported in this browser.');
      return;
    }

    const stream = new MediaStream([audioTrack]);

    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    const mimeType =
      candidates.find(t => MediaRecorder.isTypeSupported?.(t)) || '';

    let cancelled = false;

    const recordChunk = () => {
      if (cancelled || !mountedRef.current || !activeRef.current) return;

      let mr;
      try {
        mr = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch (err) {
        console.error('MediaRecorder init failed:', err);
        return;
      }
      recorderRef.current = mr;

      const chunks = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mr.onstop = async () => {
        // Immediately start next chunk so we don't miss speech
        if (!cancelled && mountedRef.current && activeRef.current) {
          recordChunk();
        }

        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        if (blob.size < 3_000) return; // likely silence

        try {
          const form = new FormData();
          const ext = mimeType.includes('mp4') ? 'm4a'
                    : mimeType.includes('ogg') ? 'ogg'
                    : 'webm';
          form.append('audio', blob, `chunk.${ext}`);
          if (language) form.append('language', language);

          const res = await fetch(`${serverUrl}/transcribe`, {
            method: 'POST',
            body: form,
          });
          if (!res.ok) {
            console.warn('Transcribe request failed:', res.status);
            return;
          }
          const data = await res.json();
          const text = (data.text || '').trim();
          if (!text) return;

          // Filter common Whisper hallucinations on silence / noise
          const cleaned = text.replace(/\s+/g, ' ').trim();
          const lowered = cleaned.toLowerCase().replace(/[.!?…]+$/, '');
          const HALLUCINATIONS = new Set([
            'you', 'thank you', 'thanks for watching',
            'thank you for watching', 'thanks', 'bye', '.', '',
            'subtitles by the amara.org community',
          ]);
          if (HALLUCINATIONS.has(lowered)) return;
          if (cleaned.split(/\s+/).length < 2 && cleaned.length < 6) return;
          if (cleaned === lastTextRef.current) return;
          lastTextRef.current = cleaned;

          const time = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });

          onNewLineRef.current?.({
            id: `${Date.now()}-${Math.random()}`,
            speaker: usernameRef.current,
            text: cleaned,
            time,
          });
        } catch (err) {
          console.warn('Transcribe upload failed:', err);
        }
      };

      try {
        mr.start();
        stopTimerRef.current = setTimeout(() => {
          if (mr.state !== 'inactive') {
            try { mr.stop(); } catch (_) {}
          }
        }, chunkDurationMs);
      } catch (err) {
        console.error('MediaRecorder start failed:', err);
      }
    };

    recordChunk();

    return () => {
      cancelled = true;
      clearTimeout(stopTimerRef.current);
      const mr = recorderRef.current;
      if (mr && mr.state !== 'inactive') {
        try { mr.stop(); } catch (_) {}
      }
      recorderRef.current = null;
    };
  }, [isActive, audioTrack, serverUrl, chunkDurationMs, language]);
};

export default useServerTranscript;