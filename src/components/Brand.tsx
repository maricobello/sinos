import { useId } from "react";

/** Marca do SIN OS: hexágono (a rede) com o raio, em gradiente azul-elétrico. SVG próprio. */
export function BrandMark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0 drop-shadow-[0_6px_14px_rgba(37,99,235,0.45)]">
      <defs>
        <linearGradient id={`bm-a${id}`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60a5fa" />
          <stop offset="0.55" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id={`bm-b${id}`} x1="12" y1="6" x2="20" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#bfdbfe" />
        </linearGradient>
      </defs>
      <path d="M16 1.8 28.3 8.9v14.2L16 30.2 3.7 23.1V8.9Z" fill={`url(#bm-a${id})`} />
      <path d="M16 1.8 28.3 8.9v14.2L16 30.2 3.7 23.1V8.9Z" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.8" />
      <path d="M17.6 6.5 10.4 17.4h4.9l-1.5 8.1 7.8-11.3h-5.1Z" fill={`url(#bm-b${id})`} />
    </svg>
  );
}

/** Azulejo do ícone de um módulo (gradiente da cor do módulo). */
export function ModuleTile({ Icon, tile, size = 40, icon = 20, className = "" }: { Icon: React.ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>; tile: [string, string]; size?: number; icon?: number; className?: string }) {
  return (
    <span className={`icon-tile ${className}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), ["--tile-a" as string]: tile[0], ["--tile-b" as string]: tile[1] }} aria-hidden>
      <Icon size={icon} strokeWidth={2} aria-hidden />
    </span>
  );
}

/**
 * Arte do cabeçalho: malha de rede elétrica (nós e linhas de transmissão) com uma curva de carga
 * passando por cima, em traço fino na cor do módulo. Desenho próprio, sem licença de terceiros.
 */
export function HeroArt({ color = "#2563eb", className = "" }: { color?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const nodes: [number, number][] = [
    [40, 92], [110, 40], [170, 104], [236, 56], [300, 118], [356, 46], [420, 96], [470, 30],
  ];
  const links: [number, number][] = [[0, 1], [1, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5], [4, 6], [5, 6], [5, 7], [6, 7]];
  return (
    <svg viewBox="0 0 500 150" className={`hero-art ${className}`} style={{ color }} aria-hidden>
      <defs>
        <linearGradient id={`ha-l${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={`ha-f${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {links.map(([a, b], i) => (
        <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeDasharray={i % 3 ? undefined : "3 4"} />
      ))}
      <path d="M0 126 C 50 122, 70 84, 120 92 S 190 136, 240 104 S 320 54, 370 74 S 450 112, 500 60 L 500 150 L 0 150 Z" fill={`url(#ha-f${id})`} />
      <path d="M0 126 C 50 122, 70 84, 120 92 S 190 136, 240 104 S 320 54, 370 74 S 450 112, 500 60" fill="none" stroke={`url(#ha-l${id})`} strokeWidth="2" strokeLinecap="round" />
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={i % 3 === 1 ? 7 : 5} fill="currentColor" fillOpacity="0.1" />
          <circle cx={x} cy={y} r={i % 3 === 1 ? 3 : 2.2} fill="currentColor" fillOpacity="0.75" />
        </g>
      ))}
    </svg>
  );
}

/** Ilustração de estado vazio: prancheta com gráfico tracejado (sem dados ainda). */
export function EmptyArt({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="text-muted">
      <rect x="10" y="8" width="44" height="50" rx="8" fill="currentColor" fillOpacity="0.07" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <rect x="23" y="4" width="18" height="8" rx="3" fill="var(--surface)" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
      <path d="M18 44 L26 34 L33 39 L46 24" fill="none" stroke="var(--accent)" strokeOpacity="0.75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3.5" />
      <circle cx="46" cy="24" r="2.6" fill="var(--accent)" />
      <path d="M18 50 H46" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
