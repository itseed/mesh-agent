export function IconLoader({ size = 80, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
    >
      <style>{`
        @keyframes spin-cw  { from { transform: rotate(0deg);   } to { transform: rotate(360deg);  } }
        @keyframes spin-ccw { from { transform: rotate(0deg);   } to { transform: rotate(-360deg); } }
        @keyframes dot-pulse { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
        @keyframes hub-pulse { 0%,100% { transform:scale(1);    } 50% { transform:scale(1.18); } }
        .ring-outer { transform-origin:60px 60px; animation:spin-ccw 8s linear infinite; }
        .ring-mid   { transform-origin:60px 60px; animation:spin-cw  5s linear infinite; }
        .hub-rings  { transform-origin:60px 60px; animation:hub-pulse 2s ease-in-out infinite; }
        .dot-1 { animation:dot-pulse 2s ease-in-out infinite; animation-delay:0s;    }
        .dot-2 { animation:dot-pulse 2s ease-in-out infinite; animation-delay:0.25s; }
        .dot-3 { animation:dot-pulse 2s ease-in-out infinite; animation-delay:0.5s;  }
        .dot-4 { animation:dot-pulse 2s ease-in-out infinite; animation-delay:0.75s; }
        .dot-5 { animation:dot-pulse 2s ease-in-out infinite; animation-delay:1.0s;  }
        .dot-6 { animation:dot-pulse 2s ease-in-out infinite; animation-delay:1.25s; }
        .dot-7 { animation:dot-pulse 2s ease-in-out infinite; animation-delay:1.5s;  }
        .dot-8 { animation:dot-pulse 2s ease-in-out infinite; animation-delay:1.75s; }
      `}</style>

      {/* static cross lines */}
      <line x1="60" y1="16" x2="60" y2="104" stroke="#58a6ff" strokeWidth="0.8" opacity="0.25" />
      <line x1="16" y1="60" x2="104" y2="60" stroke="#58a6ff" strokeWidth="0.8" opacity="0.25" />
      <line x1="28" y1="28" x2="92" y2="92" stroke="#58a6ff" strokeWidth="0.8" opacity="0.25" />
      <line x1="92" y1="28" x2="28" y2="92" stroke="#58a6ff" strokeWidth="0.8" opacity="0.25" />

      {/* outer ring — spins CCW */}
      <circle
        className="ring-outer"
        cx="60"
        cy="60"
        r="44"
        fill="none"
        stroke="#58a6ff"
        strokeWidth="1"
        opacity="0.2"
      />

      {/* mid ring — spins CW */}
      <circle
        className="ring-mid"
        cx="60"
        cy="60"
        r="27"
        fill="none"
        stroke="#58a6ff"
        strokeWidth="1.5"
        opacity="0.5"
      />

      {/* colored dots — staggered blink */}
      <circle className="dot-1" cx="60" cy="16" r="5" fill="#58a6ff" />
      <circle className="dot-2" cx="104" cy="60" r="5" fill="#3fb950" />
      <circle className="dot-3" cx="60" cy="104" r="5" fill="#d2a8ff" />
      <circle className="dot-4" cx="16" cy="60" r="5" fill="#f0883e" />
      <circle className="dot-5" cx="92" cy="28" r="4" fill="#3fb950" opacity="0.8" />
      <circle className="dot-6" cx="92" cy="92" r="4" fill="#d2a8ff" opacity="0.8" />
      <circle className="dot-7" cx="28" cy="92" r="4" fill="#f78166" opacity="0.8" />
      <circle className="dot-8" cx="28" cy="28" r="4" fill="#58a6ff" opacity="0.8" />

      {/* hub — pulses */}
      <g className="hub-rings">
        <circle
          cx="60"
          cy="60"
          r="10"
          fill="none"
          stroke="#58a6ff"
          strokeWidth="2.5"
          opacity="0.95"
        />
        <circle cx="60" cy="60" r="8" fill="#58a6ff" />
        <circle cx="60" cy="60" r="3.5" fill="#0d1117" />
      </g>
    </svg>
  );
}
