// A friendly "Hello" illustration for the plugins page.
// Pure SVG — no external assets needed.
export function PluginHero({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Background glow */}
      <defs>
        <radialGradient id="ph-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.12" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ph-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.9" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <ellipse cx="160" cy="70" rx="140" ry="50" fill="url(#ph-glow)" />

      {/* Speech bubble: Hello! */}
      <g transform="translate(88, 8)">
        <rect x="0" y="0" width="72" height="26" rx="8" fill="hsl(var(--surface))" stroke="hsl(var(--border))" strokeWidth="0.8" />
        <path d="M12 26 L16 32 L20 26" fill="hsl(var(--surface))" stroke="hsl(var(--border))" strokeWidth="0.8" />
        <text x="36" y="17" textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))" fontFamily="sans-serif">Hello!</text>
      </g>

      {/* Cute robot / mascot character */}
      <g transform="translate(100, 44)">
        {/* Antenna */}
        <line x1="16" y1="-2" x2="16" y2="-10" stroke="hsl(var(--primary))" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="16" cy="-12" r="3" fill="hsl(var(--primary))" opacity="0.8" />
        {/* Head */}
        <rect x="6" y="0" width="20" height="18" rx="5" fill="url(#ph-body)" />
        {/* Eyes */}
        <circle cx="12" cy="9" r="2.5" fill="hsl(var(--primary-foreground))" />
        <circle cx="20" cy="9" r="2.5" fill="hsl(var(--primary-foreground))" />
        <circle cx="12.5" cy="8.5" r="1" fill="white" />
        <circle cx="20.5" cy="8.5" r="1" fill="white" />
        {/* Smile */}
        <path d="M12 14 Q16 17 20 14" stroke="hsl(var(--primary-foreground))" strokeWidth="1" strokeLinecap="round" fill="none" />
        {/* Body */}
        <rect x="10" y="19" width="12" height="13" rx="3" fill="url(#ph-body)" />
        {/* Arms — waving */}
        <g transform="translate(0, 20)">
          <path d="M10 0 L2 3 L0 8" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
          <circle cx="10" cy="0" r="2.5" fill="hsl(var(--primary))" opacity="0.5" />
        </g>
        <g transform="translate(22, 22)">
          <path d="M0 0 L37 2 L42 8" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="42" cy="8" r="4" fill="hsl(var(--primary)/0.15)" stroke="hsl(var(--primary))" strokeWidth="1" />
          <circle cx="0" cy="0" r="2.5" fill="hsl(var(--primary))" opacity="0.5" />
        </g>
        {/* Feet */}
        <ellipse cx="12" cy="33" rx="5" ry="2.5" fill="hsl(var(--primary))" opacity="0.4" />
        <ellipse cx="20" cy="33" rx="5" ry="2.5" fill="hsl(var(--primary))" opacity="0.4" />
      </g>

      {/* Floating plugin puzzle pieces / cards */}
      {/* Card 1 — purple */}
      <g transform="translate(210, 82)">
        <rect x="0" y="0" width="36" height="24" rx="4" fill="hsl(270 60% 50% / 0.15)" stroke="hsl(270 50% 60% / 0.5)" strokeWidth="0.8" />
        <rect x="4" y="4" width="12" height="4" rx="1.5" fill="hsl(270 50% 60% / 0.4)" />
        <rect x="4" y="10" width="18" height="2.5" rx="1" fill="hsl(270 50% 60% / 0.25)" />
        <rect x="4" y="14" width="10" height="2.5" rx="1" fill="hsl(270 50% 60% / 0.2)" />
      </g>
      {/* Card 2 — green */}
      <g transform="translate(180, 42)">
        <rect x="0" y="0" width="30" height="20" rx="3.5" fill="hsl(160 60% 45% / 0.12)" stroke="hsl(160 50% 55% / 0.45)" strokeWidth="0.7" />
        <circle cx="6" cy="6" r="2.5" fill="hsl(160 50% 55% / 0.35)" />
        <rect x="10" y="4.5" width="14" height="2" rx="1" fill="hsl(160 50% 55% / 0.2)" />
        <rect x="4" y="12" width="16" height="2" rx="1" fill="hsl(160 50% 55% / 0.15)" />
      </g>
      {/* Card 3 — orange */}
      <g transform="translate(55, 62)">
        <rect x="0" y="0" width="28" height="22" rx="3.5" fill="hsl(30 80% 55% / 0.1)" stroke="hsl(30 70% 60% / 0.4)" strokeWidth="0.7" />
        <rect x="4" y="4" width="10" height="5" rx="1.2" fill="hsl(30 70% 60% / 0.3)" />
        <rect x="16" y="4" width="8" height="2" rx="1" fill="hsl(30 70% 60% / 0.15)" />
        <rect x="16" y="7.5" width="6" height="2" rx="1" fill="hsl(30 70% 60% / 0.1)" />
        <rect x="4" y="14" width="18" height="2" rx="1" fill="hsl(30 70% 60% / 0.12)" />
      </g>

      {/* Sparkles */}
      <g opacity="0.6">
        <path d="M250 38 L252 34 L254 38 L258 39 L254 40 L252 44 L250 40 L246 39 Z" fill="hsl(var(--primary))" />
        <path d="M60 28 L61.5 25 L63 28 L66 29 L63 30 L61.5 33 L60 30 L57 29 Z" fill="hsl(var(--primary))" />
      </g>
    </svg>
  );
}
