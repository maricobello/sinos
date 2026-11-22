import {
  ArrowLeftRight,
  BatteryCharging,
  BookOpen,
  CalendarRange,
  CloudSun,
  Flame,
  Gauge,
  Globe,
  Handshake,
  Receipt,
  ScrollText,
  ShieldCheck,
  SolarPanel,
  TrendingUp,
  Wallet,
  Waypoints,
  Wind,
  Zap,
} from "lucide-react";

/** Módulo do app: rota, nome, ícone e as duas cores do azulejo (gradiente) que o identifica. */
export interface Modulo {
  href: string;
  label: string;
  Icon: typeof Gauge;
  tile: [string, string];
}

export const NAV: { group: string; items: Modulo[] }[] = [
  {
    group: "Mercado",
    items: [
      { href: "/", label: "Sala de Comando", Icon: Gauge, tile: ["#3b82f6", "#1d4ed8"] },
      { href: "/sin", label: "SIN · Brasil", Icon: Zap, tile: ["#38bdf8", "#0369a1"] },
      { href: "/rede", label: "Rede elétrica", Icon: Waypoints, tile: ["#818cf8", "#4338ca"] },
      { href: "/termicas", label: "Térmicas & encargos", Icon: Flame, tile: ["#fb923c", "#c2410c"] },
      { href: "/renovaveis", label: "Renováveis & corte", Icon: Wind, tile: ["#34d399", "#047857"] },
      { href: "/previsao", label: "Previsão", Icon: TrendingUp, tile: ["#a78bfa", "#6d28d9"] },
      { href: "/planejamento", label: "Planejamento (SDDP)", Icon: CalendarRange, tile: ["#60a5fa", "#1e40af"] },
      { href: "/mercado-livre", label: "Mercado livre", Icon: Handshake, tile: ["#2dd4bf", "#0f766e"] },
      { href: "/arbitragem", label: "Arbitragem", Icon: ArrowLeftRight, tile: ["#f472b6", "#be185d"] },
    ],
  },
  {
    group: "Ativos",
    items: [
      { href: "/bess", label: "BESS", Icon: BatteryCharging, tile: ["#4ade80", "#15803d"] },
      { href: "/carteira", label: "Carteira", Icon: Wallet, tile: ["#22d3ee", "#0e7490"] },
      { href: "/gd", label: "Geração distribuída", Icon: SolarPanel, tile: ["#facc15", "#ca8a04"] },
      { href: "/tarifas", label: "Tarifas & tributos", Icon: Receipt, tile: ["#fbbf24", "#b45309"] },
    ],
  },
  {
    group: "Contexto",
    items: [
      { href: "/global", label: "Mercados globais", Icon: Globe, tile: ["#93c5fd", "#2563eb"] },
      { href: "/clima", label: "Clima & hidrologia", Icon: CloudSun, tile: ["#7dd3fc", "#0284c7"] },
    ],
  },
  {
    group: "Sistema",
    items: [
      { href: "/auditoria", label: "Agente auditor", Icon: ShieldCheck, tile: ["#4ade80", "#166534"] },
      { href: "/modelos", label: "Modelos & APIs", Icon: BookOpen, tile: ["#c4b5fd", "#5b21b6"] },
      { href: "/metodologia", label: "Metodologia", Icon: ScrollText, tile: ["#cbd5e1", "#475569"] },
    ],
  },
];

export const MODULOS: (Modulo & { group: string })[] = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));

/** Módulo da rota atual (a raiz só casa com "/"). */
export const moduloDe = (path: string | null | undefined) => (path ? MODULOS.find((n) => (n.href === "/" ? path === "/" : path === n.href || path.startsWith(`${n.href}/`))) : undefined);
