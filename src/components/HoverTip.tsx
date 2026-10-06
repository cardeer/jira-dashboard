import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TipState {
  content: ReactNode;
  rect: DOMRect;
}

/**
 * Instant tooltip (the native `title` tooltip waits ~1s). Spread `bind(() => content)` onto any
 * element and render `tip` once. Content is built lazily, only when hovered or focused.
 */
export function useHoverTip() {
  const [tip, setTip] = useState<TipState | null>(null);

  // Positions are viewport-based, so any scroll makes them stale: just hide.
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [tip]);

  const bind = (content: () => ReactNode) => {
    const show = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) =>
      setTip({ content: content(), rect: e.currentTarget.getBoundingClientRect() });
    return { onMouseEnter: show, onFocus: show, onMouseLeave: () => setTip(null), onBlur: () => setTip(null) };
  };

  return { bind, tip: tip && <HoverTip {...tip} /> };
}

const GAP = 8;

function HoverTip({ content, rect }: TipState) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure, then place above the anchor (or below if there's no room), kept inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, GAP), window.innerWidth - width - GAP);
    const top = rect.top - height - GAP >= GAP ? rect.top - height - GAP : rect.bottom + GAP;
    setPos({ left, top });
  }, [rect, content]);

  return createPortal(
    <div
      ref={ref}
      className="hover-tip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {content}
    </div>,
    document.body,
  );
}
