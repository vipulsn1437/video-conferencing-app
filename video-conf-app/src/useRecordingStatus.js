import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

export default function useRecordingStatus(room) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState(null);

  useEffect(() => {
    if (!room) {
      setIsRecording(false);
      setRecordingUrl(null);
      return;
    }

    const unsubPublic = onSnapshot(doc(db, 'rooms', room), (snap) => {
      const data = snap.data();
      setIsRecording(!!data?.isRecording);
    });

    // This subscription will simply fail silently (permission-denied) for
    // non-host users, per the Firestore rule — that's expected, not a bug.
    const unsubPrivate = onSnapshot(
      doc(db, 'rooms', room, 'private', 'recording'),
      (snap) => {
        setRecordingUrl(snap.data()?.recordingUrl || null);
      },
      () => {
        // Non-host: permission denied is expected here.
        setRecordingUrl(null);
      }
    );

    return () => {
      unsubPublic();
      unsubPrivate();
    };
  }, [room]);

  return { isRecording, recordingUrl };
}