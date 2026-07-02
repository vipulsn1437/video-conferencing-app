import { useEffect, useRef, useCallback } from 'react';

const SERVER = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
const CHUNK_MS = 6000;
const LANE_OFFSET_MS = CHUNK_MS / 2;
const ENABLE_DUAL_LANE = true;
const MIN_BLOB_BYTES = 3000;
const SILENCE_RMS_THRESHOLD = 0.011;
const MIN_VOICED_RATIO = 0.15;
const MAX_OVERLAP_WORDS = 12;
const DEBUG_AUDIO = true; // set false once tuned — logs voiced ratio per chunk

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

function isTooSimilar(a, b) {
  if (!a || !b) return false;
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

const HALLUCINATIONS = new Set([
  'thank you', 'thanks for watching', 'bye', 'you', 'thank you for watching',
  'thanks for watching!', 'please subscribe', 'subscribe', 'i', 'okay', 'ok',
  'activate windows', 'go to settings to activate windows',
  'video conference', 'vca', 'share screen', 'camera', 'chat', 'microphone',
  'chat microphone and video', 'chat microphone leave', 'leave', 'sigh',
  'previous words spoken', 'precious words spoken', 'hello hello hello',
  'video conferencing', 'and summaries', 'please read the description',
]);

const WEATHER_WORDS = ['weather', 'humidity', 'thunderstorm', 'precipitation', 'celsius', 'clouds', 'winds', 'forecast'];
function looksLikeWeatherReport(text) {
  const lower = text.toLowerCase();
  const hits = WEATHER_WORDS.filter(w => lower.includes(w)).length;
  return hits >= 2;
}

function normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '');
}

function stripOverlap(newRawText, referenceRawText, maxOverlapWords = MAX_OVERLAP_WORDS) {
  if (!referenceRawText) return newRawText;
  const refWords = referenceRawText.trim().split(/\s+/);
  const newWords = newRawText.trim().split(/\s+/);
  if (refWords.length === 0 || newWords.length === 0) return newRawText;

  const refNorm = refWords.map(normalizeWord);
  const newNorm = newWords.map(normalizeWord);

  const maxCheck = Math.min(maxOverlapWords, refNorm.length, newNorm.length);
  let bestOverlap = 0;

  for (let len = maxCheck; len >= 2; len--) {
    const refTail = refNorm.slice(refNorm.length - len).join(' ');
    const newHead = newNorm.slice(0, len).join(' ');
    if (refTail === newHead) {
      bestOverlap = len;
      break;
    }
  }

  if (bestOverlap === 0) return newRawText;
  return newWords.slice(bestOverlap).join(' ');
}

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
  const isMounted      = useRef(true);
  const isStoppingRef  = useRef(false);
  const mimeTypeRef    = useRef('');
  const lastFinalText  = useRef('');
  const referenceTextRef = useRef('');

  const audioCtxRef   = useRef(null);
  const analyserRef   = useRef(null);
  const rmsIntervalRef = useRef(null);
  const laneRmsBuffers = useRef({ A: [], B: [] });

  const seqCounterRef        = useRef(0);
  const nextSeqToProcessRef  = useRef(0);
  const pendingResultsRef    = useRef(new Map());

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
        laneRmsBuffers.current.A.push(rms);
        laneRmsBuffers.current.B.push(rms);
      }, 100);
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

  const consumeVoicedCheck = useCallback((lane) => {
    const samples = laneRmsBuffers.current[lane];
    laneRmsBuffers.current[lane] = [];
    if (samples.length === 0) return true;
    const voicedCount = samples.filter(rms => rms > SILENCE_RMS_THRESHOLD).length;
    const ratio = voicedCount / samples.length;
    const maxRms = samples.length ? Math.max(...samples) : 0;

    if (DEBUG_AUDIO) {
      console.log(
        `[audio ${lane}] voicedRatio=${ratio.toFixed(2)} (need ${MIN_VOICED_RATIO}) maxRms=${maxRms.toFixed(4)} → ${ratio >= MIN_VOICED_RATIO ? 'SEND' : 'SKIP'}`
      );
    }

    return ratio >= MIN_VOICED_RATIO;
  }, []);

  const processQueue = useCallback(() => {
    while (pendingResultsRef.current.has(nextSeqToProcessRef.current)) {
      const seq = nextSeqToProcessRef.current;
      const raw = pendingResultsRef.current.get(seq);
      pendingResultsRef.current.delete(seq);
      nextSeqToProcessRef.current += 1;

      if (DEBUG_AUDIO) console.log(`[transcribe seq ${seq}] raw:`, JSON.stringify(raw));

      if (!raw || !raw.trim()) continue;

      const bare = raw.toLowerCase().replace(/[.!?]/g, '').trim();
      if (HALLUCINATIONS.has(bare)) continue;
      if (looksLikeWeatherReport(raw)) continue;

      const stripped = stripOverlap(raw, referenceTextRef.current);
      referenceTextRef.current = raw;

      if (!stripped.trim()) continue;

      const cleaned = cleanText(stripped);
      if (cleaned.length < 3) continue;

      const cleanedBare = cleaned.toLowerCase().replace(/[.!?]/g, '').trim();
      if (HALLUCINATIONS.has(cleanedBare)) continue;

      if (isTooSimilar(cleaned, lastFinalText.current)) continue;
      lastFinalText.current = cleaned;

      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      onNewLineRef.current?.({
        id: `${Date.now()}-${Math.random()}`,
        speaker: usernameRef.current,
        text: cleaned,
        time,
      });
    }
  }, []);

  const sendChunk = useCallback(async (blob, hadVoice, seq) => {
    if (!hadVoice || !blob || blob.size < MIN_BLOB_BYTES) {
      pendingResultsRef.current.set(seq, '');
      processQueue();
      return;
    }

    onInterimRef.current?.('Transcribing…');

    try {
      const ext = mimeTypeRef.current.includes('mp4') ? 'mp4'
        : mimeTypeRef.current.includes('ogg') ? 'ogg'
        : 'webm';

      const form = new FormData();
      form.append('audio', blob, `chunk.${ext}`);

      const res = await fetch(`${SERVER}/transcribe`, { method: 'POST', body: form });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Transcription failed');
      }

      const data = await res.json();
      pendingResultsRef.current.set(seq, (data.text || '').trim());
    } catch (err) {
      console.debug('Transcription error:', err.message);
      pendingResultsRef.current.set(seq, '');
    } finally {
      if (isMounted.current) onInterimRef.current?.('');
      processQueue();
    }
  }, [processQueue]);

  const runLane = useCallback((lane) => {
    if (!isMounted.current || !streamRef.current || isStoppingRef.current) return;

    const mimeType = mimeTypeRef.current;
    let recorder;
    try {
      recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    } catch (err) {
      console.warn(`MediaRecorder init failed (lane ${lane}):`, err.message);
      return;
    }

    const seq = seqCounterRef.current++;
    const localChunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) localChunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(localChunks, { type: mimeType || 'audio/webm' });
      const hadVoice = consumeVoicedCheck(lane);
      if (!isStoppingRef.current) {
        sendChunk(blob, hadVoice, seq);
        runLane(lane);
      }
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, CHUNK_MS);
  }, [sendChunk, consumeVoicedCheck]);

  useEffect(() => {
    isMounted.current = true;
    isStoppingRef.current = false;

    let laneBTimer = null;

    async function setup() {
      if (!isActive) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        console.warn('getUserMedia not supported on this browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        if (!isMounted.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        mimeTypeRef.current = pickMimeType();
        startRmsSampling(stream);

        runLane('A');
        if (ENABLE_DUAL_LANE) {
          laneBTimer = setTimeout(() => {
            if (isMounted.current && !isStoppingRef.current) runLane('B');
          }, LANE_OFFSET_MS);
        }
      } catch (err) {
        console.warn('Mic access error:', err.message);
      }
    }

    setup();

    return () => {
      isStoppingRef.current = true;
      clearTimeout(laneBTimer);
      stopRmsSampling();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      onInterimRef.current?.('');
    };
  }, [isActive, runLane, startRmsSampling, stopRmsSampling]);
};

export default useTranscript;