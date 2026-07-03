import { useParticipants } from '@livekit/components-react';
import { useEffect } from 'react';

export default function AvatarPlaceholder() {
  const participants = useParticipants();

  useEffect(() => {
    function applyAvatars() {
      document.querySelectorAll('[data-lk-participant-name]').forEach(nameEl => {
        const tile = nameEl.closest('.lk-participant-tile');
        const placeholder = tile?.querySelector('.lk-participant-placeholder');
        if (!placeholder) return;

        const participantName = nameEl.getAttribute('data-lk-participant-name');
        const participant = participants.find(
          p => p.name === participantName || p.identity === participantName
        );

        let photoURL = '';
        try {
          photoURL = participant ? JSON.parse(participant.metadata || '{}').photoURL : '';
        } catch {}

        const svg = placeholder.querySelector('svg');
        let img = placeholder.querySelector('.lk-avatar-img');

        if (photoURL) {
          if (svg) svg.style.display = 'none';
          if (!img) {
            img = document.createElement('img');
            img.className = 'lk-avatar-img';
            img.referrerPolicy = 'no-referrer'; 
            img.onerror = () => {
              img.remove();
              if (svg) svg.style.display = '';
            };
            placeholder.appendChild(img);
          }
          if (img.src !== photoURL) img.src = photoURL;
        } else if (img) {
          img.remove();
          if (svg) svg.style.display = '';
        }
      });
    }

    applyAvatars();
   
    const observer = new MutationObserver(applyAvatars);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [participants]);

  return null;
}