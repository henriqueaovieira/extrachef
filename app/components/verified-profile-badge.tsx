'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/app/components/ui';

export default function VerifiedProfileBadge() {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; container: Element } | null>(null);
  const show = () => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (bounds) setPosition({
      left: Math.max(8, Math.min(bounds.right - 224, window.innerWidth - 232)),
      top: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 112)),
      container: buttonRef.current?.closest('dialog[open]') ?? document.body,
    });
  };
  const close = () => { setPinned(false); setPosition(null); };
  useEffect(() => {
    if (!pinned) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [pinned]);
  return (
    <span className="relative z-10 ml-1 inline-flex shrink-0 align-middle pointer-events-auto">
      <Button variant="ghost"
        ref={buttonRef}
        type="button"
        aria-label="Perfil Verificado"
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pinned) close();
          else { setPinned(true); show(); }
        }}
        onMouseEnter={show}
        onMouseLeave={() => { if (!pinned) setPosition(null); }}
        onFocus={show}
        onKeyDown={(event) => { if (event.key === 'Escape' && position) { event.preventDefault(); event.stopPropagation(); close(); } }}
        onBlur={close}
        className="size-11 shrink-0 rounded-full p-0 text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m8 12 3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
      <span id={id} className="sr-only">A identidade deste profissional foi validada pelo ExtraChef. Não certifica qualificação ou disponibilidade.</span>
      {position && createPortal(
        <span role="tooltip" style={{
          left: `min(${position.left}px, max(8px, calc(100vw - 232px)))`,
          top: position.top,
          transform: `translateY(min(0px, calc(100dvh - ${position.top}px - 100% - 8px)))`,
        }} className="pointer-events-none fixed z-[100] w-56 max-w-[calc(100vw-1rem)] break-words rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal text-gray-700 shadow-lg">
          <strong className="mb-1 block text-sm text-gray-950">Perfil Verificado</strong>
          A identidade deste profissional foi validada pelo ExtraChef.
          {' '}Não certifica qualificação ou disponibilidade.
        </span>, position.container,
      )}
    </span>
  );
}
