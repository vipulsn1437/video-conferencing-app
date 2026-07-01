import { useEffect, useRef, useCallback } from 'react';

// ── Text post-processor ───────────────────────────────────────────────────────
function cleanText(text) {
  return text
    .trim()
    // Capitalize first letter
    .replace(/^./, c => c.toUpperCase())
    // Add period at end if no punctuation
    .replace(/([^.!?])$/, '$1.')
    // Fix common speech-to-text mistakes
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
    // Remove filler words (optional — comment out if you want them)
    .replace(/\b(um+|uh+|er+|ah+|hmm+)\b/gi, '')
    // Collapse multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Duplicate detector ────────────────────────────────────────────────────────
function isTooSimilar(a, b) {
  if (!a || !b) return false;
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = normalize(a);
  const nb = normalize(b);
  // Exact match
  if (na === nb) return true;
  // One contains the other (repeat detection)
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

const useTranscript = (username, onNewLine, onInterim, isActive) => {
  const recognitionRef = useRef(null);
  const isRunning      = useRef(false);
  const restartTimer   = useRef(null);
  const interimTimer   = useRef(null);
  const isMounted      = useRef(true);
  const lastFinalText  = useRef('');  // ← for duplicate detection

  const onNewLineRef = useRef(onNewLine);
  const onInterimRef = useRef(onInterim);
  const usernameRef  = useRef(username);

  useEffect(() => { onNewLineRef.current = onNewLine; }, [onNewLine]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);
  useEffect(() => { usernameRef.current  = username;  }, [username]);

  const clearTimers = useCallback(() => {
    clearTimeout(restartTimer.current);
    clearTimeout(interimTimer.current);
  }, []);

  const clearInterim = useCallback(() => {
    clearTimeout(interimTimer.current);
    onInterimRef.current?.('');
  }, []);

  useEffect(() => {
    isMounted.current = true;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('SpeechRecognition not supported.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.maxAlternatives = 3;   // ← get top 3 alternatives for best pick
    recognition.lang            = 'en-IN';

    recognitionRef.current = recognition;

    const start = () => {
      if (!isMounted.current || isRunning.current) return;
      try {
        recognition.start();
        isRunning.current = true;
      } catch (e) {}
    };

    const stop = () => {
      clearTimers();
      clearInterim();
      isRunning.current = false;
      try { recognition.stop(); } catch (_) {}
    };

    const scheduleRestart = (delay = 1500) => {
      clearTimeout(restartTimer.current);
      restartTimer.current = setTimeout(() => {
        if (isMounted.current && isActive) start();
      }, delay);
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      let bestConfidence = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];

        if (result.isFinal) {
          // ── Pick the best alternative by confidence ──────────────────────
          let bestAlt = result[0];
          for (let j = 1; j < result.length; j++) {
            if (result[j].confidence > bestAlt.confidence) {
              bestAlt = result[j];
            }
          }

          bestConfidence = bestAlt.confidence;

          // ── Confidence filter: skip very low confidence results ───────────
          // Chrome usually returns 0–1; skip if below 0.3
          if (bestConfidence > 0 && bestConfidence < 0.3) {
            console.debug('Skipped low-confidence result:', bestAlt.transcript, bestConfidence);
            continue;
          }

          finalText += bestAlt.transcript;
        } else {
          // Show best interim alternative
          interim += result[0].transcript;
        }
      }

      // ── Interim display ──────────────────────────────────────────────────
      if (interim) {
        onInterimRef.current?.(interim);
        clearTimeout(interimTimer.current);
        interimTimer.current = setTimeout(clearInterim, 3000);
      }

      // ── Final result processing ──────────────────────────────────────────
      if (finalText.trim().length > 2) {
        const cleaned = cleanText(finalText);

        // Skip empty or too-short results after cleaning
        if (cleaned.length < 3) return;

        // Skip duplicates / repeated phrases
        if (isTooSimilar(cleaned, lastFinalText.current)) {
          console.debug('Skipped duplicate:', cleaned);
          clearInterim();
          return;
        }

        lastFinalText.current = cleaned;
        clearInterim();

        const time = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        onNewLineRef.current?.({
          id: `${Date.now()}-${Math.random()}`,
          speaker: usernameRef.current,
          text: cleaned,
          time,
          confidence: bestConfidence, // pass along for optional UI display
        });
      }
    };

    recognition.onerror = (e) => {
      isRunning.current = false;
      if (e.error === 'aborted' || e.error === 'not-allowed') return;
      if (isMounted.current && isActive) {
        scheduleRestart(e.error === 'no-speech' ? 500 : 2000);
      }
    };

    recognition.onend = () => {
      isRunning.current = false;
      if (isMounted.current && isActive) scheduleRestart();
    };

    if (isActive) {
      scheduleRestart(800);
    } else {
      stop();
    }

    return () => {
      isMounted.current = false;
      stop();
    };
  }, [isActive, clearInterim, clearTimers]);
};

export default useTranscript;