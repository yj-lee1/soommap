"use client";
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Keep the card in place while its content becomes an execution card. */
export function PlanCard({ children, className, label, phase }: { children: ReactNode; className: string; label: string; phase: string }) {
  const ref = useRef<HTMLElement>(null), previous = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const height = el.getBoundingClientRect().height, from = previous.current;
    previous.current = height;
    if (!from || Math.abs(from - height) < 4 || !el.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === 'true') return;
    const animation = el.animate([{ height: `${from}px` }, { height: `${height}px` }], { duration: 360, easing: 'cubic-bezier(.22,.8,.25,1)' });
    return () => animation.cancel();
  }, [phase]);
  return <article ref={ref} className={className} aria-label={label} data-phase={phase}>{children}</article>;
}
