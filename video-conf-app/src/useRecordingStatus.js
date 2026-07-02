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
    const unsub = onSnapshot(doc(db, 'rooms', room), (snap) => {
      const data = snap.data();
      setIsRecording(!!data?.isRecording);
      setRecordingUrl(data?.recordingUrl || null);
    });
    return () => unsub();
  }, [room]);

  return { isRecording, recordingUrl };
}