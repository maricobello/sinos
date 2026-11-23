import type { DayMatrix } from "../market/brazil";
import { naiveForecast } from "../quant/lear";
import { mean, quantile } from "../quant/stats";
import type { LoggedForecast } from "./track-record";

/**
 * Histórico de acerto das previsões PUBLICADAS (o que a tela mostrou), dia a dia, e o refino que
 * aprende com esse histórico. Tudo fora da amostra: cada dia é conferido contra o PLD que aconteceu
 * depois, e o refino de um dia só usa erros de dias anteriores a ele (walk-forward).
 */

const EPS = 1e-6;
const inside = (v: number, lo: number, hi: number) => v >= lo - EPS && v <= hi + EPS;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Ponto e banda "crus" do modelo (antes do refino), para aprender sem se realimentar do próprio ajuste. */
export const baseDe = (x: LoggedForecast) => ({ point: x.base ?? x.point, lo: x.baseLo ?? x.lo, hi: x.baseHi ?? x.hi });

export interface DiaConferido {
  date: string;
  issuedAt: number;
  /** Média do dia: prevista (publicada), realizada e a faixa de 90% publicada. */
  prev: number;
  real: number;
  dayLo: number;
  dayHi: number;
  dayHit: boolean;
  /** MAE horário da publicada e do ingênuo semanal no mesmo dia (R$/MWh). */
  mae: number;
  maeNaive: number;
  /** 1 − MAE/MAE ingênuo (positivo = melhor que o ingênuo). null quando o ingênuo acertou tudo. */
  skill: number | null;
  /** Viés: média de (real − previsto) nas 24 h. Positivo = previsão abaixo do realizado. */
  bias: number;
  /** Fração das 24 h em que o realizado ficou dentro da banda horária publicada. */
  hourCoverage: number;
  /** Fração das horas realizadas no piso. */
  floorShare: number;
  /** A previsão publicada já tinha o refino pelo histórico aplicado. */
  refined: boolean;
  /** Erro por hora (real − publicada), para o perfil por hora. */
  err: number[];
}

/** Confere cada previsão gravada com o PLD realizado (só dias completos, não interpolados). */
export function conferirDias(items: LoggedForecast[], dm: DayMatrix, floor = 0): DiaConferido[] {
  const at = new Map(dm.dates.map((d, i) => [d, i]));
  const imputed = new Set(dm.imputed);
  const out: DiaConferido[] = [];
  for (const x of [...items].sort((a, b) => a.date.localeCompare(b.date))) {
    const i = at.get(x.date);
    if (i === undefined || i < 7 || imputed.has(x.date) || x.point.length !== 24) continue;
    const a = dm.rows[i];
    const nv = naiveForecast(dm.rows.slice(0, i), dm.dows[i]);
    const err = a.map((v, h) => v - x.point[h]);
    const mae = mean(err.map(Math.abs));
    const maeNaive = mean(a.map((v, h) => Math.abs(v - nv[h])));
    const real = mean(a);
    out.push({
      date: x.date,
      issuedAt: x.issuedAt,
      prev: r2(mean(x.point)),
      real: r2(real),
      dayLo: x.dayLo,
      dayHi: x.dayHi,
      dayHit: inside(real, x.dayLo, x.dayHi),
      mae: r2(mae),
      maeNaive: r2(maeNaive),
      skill: maeNaive > EPS ? r4(1 - mae / maeNaive) : null,
      bias: r2(mean(err)),
      hourCoverage: r4(a.filter((v, h) => inside(v, x.lo[h], x.hi[h])).length / 24),
      floorShare: r4(a.filter((v) => floor > 0 && v <= floor + 0.01).length / 24),
      refined: !!x.base,
      err: err.map(r2),
    });
  }
  return out;
}

export interface ResumoHistorico {
  dias: number;
  desde: string | null;
  ate: string | null;
  mae: number | null;
  maeNaive: number | null;
  /** Skill agregado: 1 − ΣMAE/ΣMAE ingênuo. */
  skill: number | null;
  /** Dias em que a publicada errou menos que o ingênuo (entre os dias com diferença). */
  venceIngenuo: number | null;
  coberturaHora: number | null;
  coberturaDia: number | null;
  vies: number | null;
  /** Por mês: dias, MAE, skill e cobertura. */
  meses: { mes: string; dias: number; mae: number; maeNaive: number; skill: number | null; coberturaHora: number }[];
  /** Média móvel de 30 dias (ou desde o início) do skill e da cobertura, para ver a evolução. */
  movel: { date: string; skill: number | null; mae: number; coberturaHora: number }[];
  /** Erro médio (viés) e erro absoluto médio por hora do dia. */
  porHora: { hora: number; vies: number; mae: number }[];
}

export function resumir(dias: DiaConferido[], janela = 30): ResumoHistorico {
  const n = dias.length;
  const soma = (f: (d: DiaConferido) => number, xs = dias) => xs.reduce((s, d) => s + f(d), 0);
  const skillDe = (xs: DiaConferido[]) => {
    const den = soma((d) => d.maeNaive, xs);
    return den > EPS ? r4(1 - soma((d) => d.mae, xs) / den) : null;
  };
  const comDif = dias.filter((d) => Math.abs(d.mae - d.maeNaive) > 0.005);
  const porMes = new Map<string, DiaConferido[]>();
  for (const d of dias) porMes.set(d.date.slice(0, 7), [...(porMes.get(d.date.slice(0, 7)) ?? []), d]);
  return {
    dias: n,
    desde: dias[0]?.date ?? null,
    ate: dias[n - 1]?.date ?? null,
    mae: n ? r2(soma((d) => d.mae) / n) : null,
    maeNaive: n ? r2(soma((d) => d.maeNaive) / n) : null,
    skill: n ? skillDe(dias) : null,
    venceIngenuo: comDif.length ? r4(comDif.filter((d) => d.mae < d.maeNaive).length / comDif.length) : null,
    coberturaHora: n ? r4(soma((d) => d.hourCoverage) / n) : null,
    coberturaDia: n ? r4(dias.filter((d) => d.dayHit).length / n) : null,
    vies: n ? r2(soma((d) => d.bias) / n) : null,
    meses: [...porMes.entries()].map(([mes, xs]) => ({
      mes,
      dias: xs.length,
      mae: r2(soma((d) => d.mae, xs) / xs.length),
      maeNaive: r2(soma((d) => d.maeNaive, xs) / xs.length),
      skill: skillDe(xs),
      coberturaHora: r4(soma((d) => d.hourCoverage, xs) / xs.length),
    })),
    movel: dias.map((d, i) => {
      const xs = dias.slice(Math.max(0, i + 1 - janela), i + 1);
      return { date: d.date, skill: skillDe(xs), mae: r2(soma((x) => x.mae, xs) / xs.length), coberturaHora: r4(soma((x) => x.hourCoverage, xs) / xs.length) };
    }),
    porHora: Array.from({ length: 24 }, (_, h) => ({
      hora: h,
      vies: n ? r2(soma((d) => d.err[h]) / n) : 0,
      mae: n ? r2(soma((d) => Math.abs(d.err[h])) / n) : 0,
    })),
  };
}

/* ------------------------------------------------------------------ refino */

export const REFINO = {
  /** Dias de erro usados para aprender (os mais recentes antes do dia previsto). */
  janela: 28,
  /** Mínimo de dias anteriores para estimar o viés de um dia. */
  minTreino: 14,
  /** Mínimo de dias avaliados fora da amostra para o refino poder entrar em produção. */
  minAvaliados: 14,
  /** Encolhimento do viés estimado (metade do viés: evita perseguir ruído). */
  shrink: 0.5,
  /** Ganho mínimo de MAE (walk-forward) para ligar a correção do ponto. */
  ganhoMin: 0.03,
  /** Alvo e faixa de tolerância da cobertura da banda horária. */
  alvo: 0.9,
  tolerancia: 0.05,
  escala: [0.7, 2] as [number, number],
};

/** Mediana por hora de (real − base) nos dias de treino, encolhida. */
function viesPorHora(treino: { a: number[]; p: number[] }[]): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    const e = treino.map((t) => t.a[h] - t.p[h]);
    return r2(REFINO.shrink * quantile(e, 0.5));
  });
}

/** Fator da banda para a cobertura voltar a ~90% (1 quando já está na faixa de tolerância). */
function escalaBanda(treino: { a: number[]; mid: number[]; half: number[] }[]): number {
  const z: number[] = [];
  let hit = 0;
  let tot = 0;
  for (const t of treino)
    for (let h = 0; h < 24; h++) {
      const d = Math.abs(t.a[h] - t.mid[h]);
      if (t.half[h] > EPS) z.push(d / t.half[h]);
      hit += d <= t.half[h] + EPS ? 1 : 0;
      tot++;
    }
  const cov = tot ? hit / tot : REFINO.alvo;
  if (!z.length || Math.abs(cov - REFINO.alvo) <= REFINO.tolerancia) return 1;
  return r4(Math.min(REFINO.escala[1], Math.max(REFINO.escala[0], quantile(z, REFINO.alvo))));
}

export interface Refino {
  /** Correção do ponto ligada (passou no teste fora da amostra). */
  pontoAtivo: boolean;
  /** Correção da largura da banda ligada. */
  bandaAtiva: boolean;
  /** Viés por hora a somar ao ponto (R$/MWh), aprendido nos últimos dias. */
  vies: number[];
  /** Fator da meia-largura da banda horária. */
  escala: number;
  /** Teste walk-forward: dias avaliados, MAE do modelo cru e do refinado, ganho e cobertura antes/depois. */
  avaliados: number;
  maeBase: number | null;
  maeRefinado: number | null;
  ganho: number | null;
  ganhoRecente: number | null;
  coberturaBase: number | null;
  coberturaRefinada: number | null;
  motivo: string;
}

/**
 * Teste fora da amostra do refino e o refino a usar amanhã. Para cada dia conferido, aprende viés e
 * escala só com os dias anteriores (até `janela`), aplica no modelo cru daquele dia e compara.
 */
export function avaliarRefino(items: LoggedForecast[], dm: DayMatrix, clip: [number, number] = [-Infinity, Infinity]): Refino {
  const at = new Map(dm.dates.map((d, i) => [d, i]));
  const imputed = new Set(dm.imputed);
  const dias = [...items]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => ({ x, i: at.get(x.date) }))
    .filter((d): d is { x: LoggedForecast; i: number } => d.i !== undefined && !imputed.has(d.x.date) && d.x.point.length === 24)
    .map(({ x, i }) => {
      const b = baseDe(x);
      return { a: dm.rows[i], p: b.point, mid: b.lo.map((lo, h) => (lo + b.hi[h]) / 2), half: b.lo.map((lo, h) => (b.hi[h] - lo) / 2) };
    });
  const cl = (v: number) => Math.min(clip[1], Math.max(clip[0], v));
  let eB = 0, eR = 0, nH = 0, cB = 0, cR = 0;
  const ganhos: { b: number; r: number }[] = [];
  for (let k = REFINO.minTreino; k < dias.length; k++) {
    const treino = dias.slice(Math.max(0, k - REFINO.janela), k);
    const v = viesPorHora(treino);
    const s = escalaBanda(treino.map((t) => ({ ...t, mid: t.mid.map((m, h) => m + v[h]) })));
    const d = dias[k];
    let b = 0, r = 0;
    for (let h = 0; h < 24; h++) {
      const pr = cl(d.p[h] + v[h]);
      b += Math.abs(d.a[h] - d.p[h]);
      r += Math.abs(d.a[h] - pr);
      cB += Math.abs(d.a[h] - d.mid[h]) <= d.half[h] + EPS ? 1 : 0;
      cR += Math.abs(d.a[h] - (d.mid[h] + v[h])) <= d.half[h] * s + EPS ? 1 : 0;
      nH++;
    }
    eB += b;
    eR += r;
    ganhos.push({ b, r });
  }
  const avaliados = ganhos.length;
  const treinoAtual = dias.slice(-REFINO.janela);
  const vies = treinoAtual.length >= REFINO.minTreino ? viesPorHora(treinoAtual) : new Array(24).fill(0);
  const escala = treinoAtual.length >= REFINO.minTreino ? escalaBanda(treinoAtual.map((t) => ({ ...t, mid: t.mid.map((m, h) => m + vies[h]) }))) : 1;
  const ganho = eB > EPS ? r4(1 - eR / eB) : null;
  const metade = ganhos.slice(Math.floor(avaliados / 2));
  const sb = metade.reduce((s, g) => s + g.b, 0);
  const ganhoRecente = sb > EPS ? r4(1 - metade.reduce((s, g) => s + g.r, 0) / sb) : null;
  const coberturaBase = nH ? r4(cB / nH) : null;
  const coberturaRefinada = nH ? r4(cR / nH) : null;
  const pronto = avaliados >= REFINO.minAvaliados;
  const pontoAtivo = pronto && ganho !== null && ganho >= REFINO.ganhoMin && (ganhoRecente ?? 0) > 0;
  const bandaAtiva =
    pronto && escala !== 1 && coberturaBase !== null && coberturaRefinada !== null && Math.abs(coberturaRefinada - REFINO.alvo) + 0.02 <= Math.abs(coberturaBase - REFINO.alvo);
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
  const motivo = !pronto
    ? `aprendendo: ${avaliados} de ${REFINO.minAvaliados} dias avaliados fora da amostra (precisa de ${REFINO.minTreino} dias de histórico antes de cada um)`
    : [
        pontoAtivo
          ? `correção do viés por hora LIGADA: reduziu o erro em ${pct(ganho)} nos ${avaliados} dias testados (${pct(ganhoRecente)} na metade mais recente)`
          : `correção do viés por hora desligada: ganho de ${pct(ganho)} fora da amostra (precisa de ${pct(REFINO.ganhoMin)} e ganho também na metade recente)`,
        bandaAtiva
          ? `largura da banda ×${escala.toFixed(2).replace(".", ",")}: cobertura ${pct(coberturaBase)} → ${pct(coberturaRefinada)} (alvo 90%)`
          : `banda mantida (cobertura ${pct(coberturaBase)}${escala === 1 ? ", dentro da tolerância" : ", o ajuste não aproximou dos 90%"})`,
      ].join("; ");
  return { pontoAtivo, bandaAtiva, vies, escala, avaliados, maeBase: nH ? r2(eB / nH) : null, maeRefinado: nH ? r2(eR / nH) : null, ganho, ganhoRecente, coberturaBase, coberturaRefinada, motivo };
}

/**
 * Aplica o refino à previsão: soma o viés da hora ao ponto, às bandas, aos quantis e às trajetórias
 * (só se a correção do ponto passou no teste) e escala a meia-largura da banda horária (só se a
 * correção da banda passou). Guarda o ponto e a banda crus em `refinoBase` para o registro.
 */
export function aplicarRefino<F extends {
  horizon: { ts: number[]; point: number[]; aciLo: number[]; aciHi: number[]; mc: Record<"p05" | "p25" | "p50" | "p75" | "p95", number[]>; dailyMean: { date: string; point: number; lear: number; p05: number; p95: number }[] };
  paths: number[][];
  refino?: Refino;
  refinoBase?: { point: number[]; lo: number[]; hi: number[] };
}>(fc: F, r: Refino, hourOf: (ts: number) => number, clip: [number, number]): F {
  if (!r.pontoAtivo && !r.bandaAtiva) return { ...fc, refino: r };
  const h = fc.horizon;
  const cl = (v: number) => Math.min(clip[1], Math.max(clip[0], v));
  const dv = h.ts.map((t) => (r.pontoAtivo ? r.vies[hourOf(t)] ?? 0 : 0));
  const sc = r.bandaAtiva ? r.escala : 1;
  const point = h.point.map((v, i) => r2(cl(v + dv[i])));
  const mid = h.aciLo.map((lo, i) => (lo + h.aciHi[i]) / 2 + dv[i]);
  const half = h.aciLo.map((lo, i) => ((h.aciHi[i] - lo) / 2) * sc);
  const shift = (xs: number[]) => xs.map((v, i) => r2(cl(v + dv[i])));
  const porDia = h.dailyMean.map((_, k) => {
    const xs = dv.slice(k * 24, k * 24 + 24);
    return xs.length ? mean(xs) : 0;
  });
  return {
    ...fc,
    refino: r,
    refinoBase: { point: h.point, lo: h.aciLo, hi: h.aciHi },
    horizon: {
      ...h,
      point,
      aciLo: mid.map((m, i) => r2(cl(m - half[i]))),
      aciHi: mid.map((m, i) => r2(cl(m + half[i]))),
      mc: { p05: shift(h.mc.p05), p25: shift(h.mc.p25), p50: shift(h.mc.p50), p75: shift(h.mc.p75), p95: shift(h.mc.p95) },
      dailyMean: h.dailyMean.map((d, k) => ({ ...d, point: r2(d.point + porDia[k]), p05: r2(d.p05 + porDia[k]), p95: r2(d.p95 + porDia[k]) })),
    },
    paths: r.pontoAtivo ? fc.paths.map((p) => p.map((v, i) => cl(v + (dv[i] ?? 0)))) : fc.paths,
  };
}
