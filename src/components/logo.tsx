import { cn } from "@/lib/utils";

/**
 * The Media Buyer mark: an eight-pointed star (two squares, the Islamic khatam) with a rising
 * line through it — the ads go up only when the truth says so. Drawn in the theme's accent and
 * second accent, so it follows every theme.
 */
export function MediaBuyerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-8", className)} aria-hidden="true">
      <g transform="translate(24 24)">
        <rect x="-15" y="-15" width="30" height="30" rx="3" className="fill-accent" />
        <rect x="-15" y="-15" width="30" height="30" rx="3" transform="rotate(45)" className="fill-accent" />
        <circle r="10.5" className="fill-surface-1" />
      </g>
      <path d="M16 29 L22 23 L26 26 L32 18" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-2" />
      <circle cx="32" cy="18" r="2.4" className="fill-accent-2" />
    </svg>
  );
}
