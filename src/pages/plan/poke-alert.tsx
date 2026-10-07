import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

const AUTO_DISMISS_MS = 5000;

/** Short two-tone "boop boop". Browsers may block audio until the user has interacted; that's fine. */
function playPokeSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [0, 0.16].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(i ? 880 : 660, now + t);
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.25, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.15);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* no audio */
  }
}

export function PokeAlert({ fromName, onClose }: { fromName: string; onClose: () => void }) {
  useEffect(() => {
    playPokeSound();
    navigator.vibrate?.([80, 60, 80]);
    const t = setTimeout(onClose, AUTO_DISMISS_MS);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // In a background tab, flag it in the title until the user comes back.
  useEffect(() => {
    if (!document.hidden) return;
    const prev = document.title;
    document.title = `👉 ${fromName} poked you!`;
    const back = () => {
      if (document.hidden) return;
      document.title = prev;
      document.removeEventListener('visibilitychange', back);
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [fromName]);

  return (
    <div className="poke-overlay" onClick={onClose} role="alertdialog" aria-modal="true" aria-label={`${fromName} poked you`}>
      <div className="poke-card" onClick={(e) => e.stopPropagation()}>
        <div className="relative h-28 w-48" aria-hidden>
          <span className="poke-target">😳</span>
          <span className="poke-finger">👉</span>
          <span className="poke-bang">💥</span>
        </div>
        <div className="text-center">
          <p className="text-2xl font-black tracking-tight">{fromName} poked you!</p>
          <p className="mt-1 text-sm text-muted-foreground">Hey, the team is waiting on you.</p>
        </div>
        <Button onClick={onClose} autoFocus>
          I’m here!
        </Button>
      </div>
    </div>
  );
}
