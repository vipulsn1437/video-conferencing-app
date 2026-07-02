import { useEffect, useRef, useCallback } from 'react';
import { db } from './firebase';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
} from 'firebase/firestore';

const useSharedTranscript = (room, onNewLine, onMeetingStart) => {
  const onNewLineRef = useRef(onNewLine);
  const onMeetingStartRef = useRef(onMeetingStart);
  useEffect(() => { onNewLineRef.current = onNewLine; }, [onNewLine]);
  useEffect(() => { onMeetingStartRef.current = onMeetingStart; }, [onMeetingStart]);

  const seenIds = useRef(new Set());

  useEffect(() => {
    if (!room) return;

    seenIds.current = new Set();

    // ── Init room startedAt ──────────────────────────────────────────────────
    const initRoom = async () => {
      const roomRef  = doc(db, 'rooms', room);
      const roomSnap = await getDoc(roomRef);

      if (!roomSnap.exists()) {
        await setDoc(roomRef, { startedAt: serverTimestamp() });
        onMeetingStartRef.current?.(Date.now()); // approximate for creator
      } else {
        const startedAt = roomSnap.data().startedAt?.toMillis();
        if (startedAt) onMeetingStartRef.current?.(startedAt);
      }
    };

    initRoom().catch(console.error);

    // ── Transcript listener ──────────────────────────────────────────────────
    const q = query(
      collection(db, 'rooms', room, 'transcript'),
      orderBy('timestamp')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== 'added') return;

          const docId = change.doc.id;
          if (seenIds.current.has(docId)) return;
          seenIds.current.add(docId);

          const data = change.doc.data();
          if (!data.speaker || !data.text) return;

          onNewLineRef.current?.({
            id:      docId,
            speaker: data.speaker,
            text:    data.text,
            time:    data.time ?? '',
          });
        });
      },
      (err) => console.error('Firestore snapshot error:', err)
    );

    return () => unsubscribe();
  }, [room]);

  // ── Save line ──────────────────────────────────────────────────────────────
  const saveTranscriptLine = useCallback(async (line) => {
    if (!room) return;
    if (!line?.speaker || !line?.text?.trim()) return;

    try {
      await addDoc(collection(db, 'rooms', room, 'transcript'), {
        speaker:   line.speaker,
        text:      line.text.trim(),
        time:      line.time ?? '',
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to save transcript line:', err);
    }
  }, [room]);

  return { saveTranscriptLine };
};

export default useSharedTranscript;