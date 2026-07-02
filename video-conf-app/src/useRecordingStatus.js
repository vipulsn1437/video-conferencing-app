import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

export default function useRecordingStatus(room) {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    if (!room) {
      setIsRecording(false);
      return;
    }
    const unsub = onSnapshot(doc(db, 'rooms', room), (snap) => {
      setIsRecording(!!snap.data()?.isRecording);
    });
    return () => unsub();
  }, [room]);

  return isRecording;
}