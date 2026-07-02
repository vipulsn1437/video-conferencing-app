import { useEffect, useRef, useCallback } from 'react';

const SERVER = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
const CHUNK_MS = 4000;              // length of each recorded chunk
const MIN_BLOB_BYTES = 3000;        // skip near-empty chunks
const SILENCE_RMS_THRESHOLD = 0.012; // below this = "silence" (tune if needed)
const MIN_VOICED_RATIO = 0.15;      // fraction of chunk that must be "loud enough" to bother sending

// ── Text post-processor ───────────────────────────────────────────────────────
function cleanText(text) {
  return text
    .trim()
    .replace(/^./, c => c.toUpperCase())
    .replace(/([^.!?])$/, '$1.')
    .replace(/\bi\b/g, 'I')
    .replace(/\bcant\b/g, "can't")
    .replace(/\bdont\b/g, "don't")
    .replace(/\bwont\b/g, "won't")
    .replace(/\bisnt\b/g, "isn't")
    .replace(/\barent\b/g, "aren't")
    .replace(/\bwouldnt\b/g, "wouldn't")
    .replace(/\bcouldnt\b/g, "couldn't")
    .replace(/\bim\b/g, "I'm")
    .replace(/\bive\b/g, "I've")
    .replace(/\bill\b/g, "I'll")
    .replace(/\b(um+|uh+|er+|ah+|hmm+)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Duplicate detector ────────────────────────────────────────────────────────
function isTooSimilar(a, b) {
  if (!a || !b) return false;
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

// ── Whisper "stock phrase" hallucinations on silence/noise ────────────────────
const HALLUCINATIONS = new Set([
  'thank you', 'thanks for watching', 'bye', 'you', 'thank you for watching',
  'thanks for watching!', 'please subscribe', 'subscribe', 'i', 'okay', 'ok',
]);

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

const useTranscript = (username, onNewLine, onInterim, isActive) => {
  const streamRef      = useRef(null);
  const recorderRef    = useRef(null);
  const chunkTimer     = useRef(null);
  const isMounted      = useRef(true);
  const isStoppingRef  = useRef(false);
  const mimeTypeRef    = useRef('');
  const lastFinalText  = useRef('');

  // ── Web Audio analysis (for silence detection) ────────────────────────────
  const audioCtxRef  = useRef(null);
  const analyserRef  = useRef(null);
  const rmsSamplesRef = useRef([]);
  const rmsIntervalRef = useRef(null);

  const onNewLineRef = useRef(onNewLine);
  const onInterimRef = useRef(onInterim);
  const usernameRef  = useRef(username);

  useEffect(() => { onNewLineRef.current = onNewLine; }, [onNewLine]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);
  useEffect(() => { usernameRef.current  = username;  }, [username]);

  const startRmsSampling = useCallback((stream) => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.fftSize);
      rmsIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        rmsSamplesRef.current.push(rms);
      }, 100); // sample every 100ms
    } catch (err) {
      console.warn('Audio analysis setup failed (will send all chunks):', err.message);
    }
  }, []);

  const stopRmsSampling = useCallback(() => {
    clearInterval(rmsIntervalRef.current);
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // Returns true if the just-recorded window had enough voiced audio to bother sending
  const consumeVoicedCheck = useCallback(() => {
    const samples = rmsSamplesRef.current;
    rmsSamplesRef.current = [];
    if (samples.length === 0) return true; // analysis unavailable — fail open, send anyway

    const voicedCount = samples.filter(rms => rms > SILENCE_RMS_THRESHOLD).length;
    const ratio = voicedCount / samples.length;
    return ratio >= MIN_VOICED_RATIO;
  }, []);

  const sendChunk = useCallback(async (blob, hadVoice) => {
    if (!blob || blob.size < MIN_BLOB_BYTES) return;
    if (!hadVoice) {
      console.debug('Skipped chunk — no voice activity detected.');
      return;
    }

    onInterimRef.current?.('Transcribing…');

    try {
      const ext = mimeTypeRef.current.includes('mp4') ? 'mp4'
        : mimeTypeRef.current.includes('ogg') ? 'ogg'
        : 'webm';

      const form = new FormData();
      form.append('audio', blob, `chunk.${ext}`);

      const res = await fetch(`${SERVER}/transcribe`, {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Transcription failed');
      }

      const data = await res.json();
      const raw = (data.text || '').trim();

      if (!isMounted.current) return;
      onInterimRef.current?.('');

      if (!raw || raw.length < 2) return;

      const bare = raw.toLowerCase().replace(/[.!?]/g, '').trim();
      if (HALLUCINATIONS.has(bare)) return;

      const cleaned = cleanText(raw);
      if (cleaned.length < 3) return;

      if (isTooSimilar(cleaned, lastFinalText.current)) {
        console.debug('Skipped duplicate:', cleaned);
        return;
      }
      lastFinalText.current = cleaned;

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
      if (isMounted.current) onInterimRef.current?.('');
      console.debug('Transcription error:', err.message);
    }
  }, []);

  const recordNextChunk = useCallback(() => {
    if (!isMounted.current || !streamRef.current || isStoppingRef.current) return;

    const mimeType = mimeTypeRef.current;
    let recorder;
    try {
      recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    } catch (err) {
      console.warn('MediaRecorder init failed:', err.message);
      return;
    }

    rmsSamplesRef.current = []; // reset for this window

    const localChunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) localChunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(localChunks, { type: mimeType || 'audio/webm' });
      const hadVoice = consumeVoicedCheck();
      if (!isStoppingRef.current) {
        sendChunk(blob, hadVoice);
        recordNextChunk();
      }
    };

    recorderRef.current = recorder;
    recorder.start();

    chunkTimer.current = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, CHUNK_MS);
  }, [sendChunk, consumeVoicedCheck]);

  useEffect(() => {
    isMounted.current = true;
    isStoppingRef.current = false;

    async function setup() {
      if (!isActive) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        console.warn('getUserMedia not supported on this browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isMounted.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        mimeTypeRef.current = pickMimeType();
        startRmsSampling(stream);
        recordNextChunk();
      } catch (err) {
        console.warn('Mic access error:', err.message);
      }
    }

    setup();

    return () => {
      isStoppingRef.current = true;
      clearTimeout(chunkTimer.current);
      stopRmsSampling();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch (_) {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      onInterimRef.current?.('');
    };
  }, [isActive, recordNextChunk, startRmsSampling, stopRmsSampling]);
};

export default useTranscript;