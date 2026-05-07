// Plugin marketplace hero illustration — a friendly cover banner.
// Pure inline SVG, no external assets.
export function PluginHero({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ph-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.06" />
          <stop offset="50%" stopColor="hsl(270 60% 55%)" stopOpacity="0.04" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="ph-robot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.95" />
          <stop offset="100%" stopColor="hsl(270 60% 55%)" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="ph-card1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.10" />
        </linearGradient>
        <linearGradient id="ph-card2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#6ee7b7" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="ph-card3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="ph-card4" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f472b6" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fbcfe8" stopOpacity="0.06" />
        </linearGradient>
      </defs>

      {/* Background */}
      <rect width="640" height="160" rx="16" fill="url(#ph-bg)" />

      {/* Robot character group */}
      <g transform="translate(52, 28)">
        {/* Head */}
        <rect x="18" y="4" width="44" height="38" rx="10" fill="url(#ph-robot)" />
        {/* Eyes */}
        <circle cx="33" cy="21" r="5" fill="hsl(var(--primary-foreground))" />
        <circle cx="47" cy="21" r="5" fill="hsl(var(--primary-foreground))" />
        <circle cx="34" cy="20" r="2" fill="white" />
        <circle cx="48" cy="20" r="2" fill="white" />
        {/* Blush */}
        <ellipse cx="26" cy="28" rx="5" ry="2.5" fill="#f472b6" opacity="0.3" />
        <ellipse cx="54" cy="28" rx="5" ry="2.5" fill="#f472b6" opacity="0.3" />
        {/* Smile */}
        <path d="M32 30 Q40 36 48 30" stroke="hsl(var(--primary-foreground))" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        {/* Antenna */}
        <line x1="40" y1="2" x2="40" y2="-10" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
        <circle cx="40" cy="-13" r="4" fill="hsl(var(--primary))" opacity="0.7" />
        <circle cx="40" cy="-13" r="2" fill="white" opacity="0.6" />

        {/* Body */}
        <rect x="24" y="44" width="32" height="28" rx="6" fill="url(#ph-robot)" />
        {/* Chest detail */}
        <rect x="34" y="50" width="12" height="8" rx="2" fill="hsl(var(--primary-foreground))" opacity="0.15" />

        {/* Arms */}
        <path d="M24 52 L8 50 L2 58" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
        <circle cx="24" cy="52" r="3.5" fill="hsl(var(--primary))" opacity="0.4" />
        {/* Waving hand with spark */}
        <circle cx="2" cy="58" r="5" fill="hsl(var(--primary))" opacity="0.12" />
        <circle cx="2" cy="58" r="2.5" fill="hsl(var(--primary))" opacity="0.3" />

        {/* Right arm holding a plugin card */}
        <path d="M56 54 L68 46" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <circle cx="56" cy="54" r="3.5" fill="hsl(var(--primary))" opacity="0.4" />
      </g>

      {/* Speech bubble */}
      <g transform="translate(148, 20)">
        <rect x="0" y="0" width="110" height="32" rx="10" fill="hsl(var(--surface))" stroke="hsl(var(--border))" strokeWidth="0.8" />
        <path d="M16 32 L22 40 L28 32" fill="hsl(var(--surface))" stroke="hsl(var(--border))" strokeWidth="0.8" />
        <text x="55" y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="hsl(var(--foreground))" fontFamily="system-ui, sans-serif">Plugins!</text>
      </g>

      {/* Floating plugin cards — right side */}
      <g transform="translate(360, 18)">
        {/* Card 1 — purple, largest */}
        <rect x="0" y="0" width="110" height="52" rx="8" fill="url(#ph-card1)" stroke="#a78bfa" strokeWidth="0.6" strokeOpacity="0.3" />
        <rect x="10" y="10" width="24" height="24" rx="4" fill="#a78bfa" opacity="0.2" />
        <rect x="40" y="10" width="55" height="5" rx="2" fill="#a78bfa" opacity="0.25" />
        <rect x="40" y="18" width="35" height="3" rx="1.5" fill="#a78bfa" opacity="0.15" />
        <rect x="10" y="40" width="70" height="3" rx="1.5" fill="#a78bfa" opacity="0.12" />
      </g>
      <g transform="translate(480, 46)">
        {/* Card 2 — green, medium */}
        <rect x="0" y="0" width="85" height="42" rx="7" fill="url(#ph-card2)" stroke="#34d399" strokeWidth="0.6" strokeOpacity="0.25" />
        <circle cx="14" cy="14" r="6" fill="#34d399" opacity="0.18" />
        <rect x="26" y="10" width="44" height="4" rx="2" fill="#34d399" opacity="0.2" />
        <rect x="26" y="16.5" width="28" height="2.5" rx="1.25" fill="#34d399" opacity="0.12" />
        <rect x="8" y="32" width="50" height="2.5" rx="1.25" fill="#34d399" opacity="0.1" />
      </g>
      <g transform="translate(370, 80)">
        {/* Card 3 — amber, small */}
        <rect x="0" y="0" width="72" height="38" rx="6" fill="url(#ph-card3)" stroke="#fbbf24" strokeWidth="0.5" strokeOpacity="0.25" />
        <rect x="8" y="8" width="20" height="12" rx="2.5" fill="#fbbf24" opacity="0.18" />
        <rect x="32" y="8" width="28" height="3" rx="1.5" fill="#fbbf24" opacity="0.15" />
        <rect x="32" y="13.5" width="18" height="2.5" rx="1.25" fill="#fbbf24" opacity="0.1" />
      </g>
      <g transform="translate(460, 100)">
        {/* Card 4 — pink, tiny */}
        <rect x="0" y="0" width="60" height="32" rx="5" fill="url(#ph-card4)" stroke="#f472b6" strokeWidth="0.5" strokeOpacity="0.2" />
        <rect x="6" y="6" width="12" height="12" rx="2" fill="#f472b6" opacity="0.16" />
        <rect x="22" y="8" width="28" height="2.5" rx="1.25" fill="#f472b6" opacity="0.12" />
        <rect x="22" y="12.5" width="16" height="2" rx="1" fill="#f472b6" opacity="0.08" />
      </g>

      {/* Sparkles & decorative dots */}
      <g opacity="0.5">
        <circle cx="290" cy="28" r="2" fill="hsl(var(--primary))" />
        <circle cx="330" cy="65" r="1.5" fill="#a78bfa" />
        <circle cx="295" cy="90" r="1.5" fill="#34d399" />
        <circle cx="565" cy="22" r="2" fill="hsl(var(--primary))" />
        <circle cx="555" cy="70" r="1.5" fill="#fbbf24" />
        <circle cx="580" cy="120" r="2" fill="hsl(var(--primary))" />
      </g>
      {/* Star sparkles */}
      <g opacity="0.45">
        <path d="M270 45 L271.5 42 L273 45 L276 46 L273 47 L271.5 50 L270 47 L267 46 Z" fill="hsl(var(--primary))" />
        <path d="M540 88 L541.2 86 L542.4 88 L544.6 88.6 L542.4 89.2 L541.2 91.2 L540 89.2 L537.8 88.6 Z" fill="#a78bfa" />
      </g>
    </svg>
  );
}
