import { describe, expect, it } from "vitest";
import { aplicarRefino, avaliarRefino, conferirDias, REFINO, resumir, type Refino } from "../src/lib/audit/forecast-history";
import { snapshotForecast, type LoggedForecast } from "../src/lib/audit/track-record";
import type { DayMatrix } from "../src/lib/market/brazil";

const date = (i: number) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
const matrix = (rows: number[][]): DayMatrix => ({ dates: rows.map((_, i) => date(i)), dows: rows.map((_, i) => new Date(`${date(i)}T12:00:00Z`).getUTCDay()), rows, imputed: [] });
const entry = (i: number, point: number[], half = 10): LoggedForecast => ({
  date: date(i),
  issuedAt: 0,
  basedOn: date(i - 1),
  point,
  lo: point.map((v) => v - half),
  hi: point.map((v) => v + half),
  dayLo: Math.min(...point) - half,
  dayHi: Math.max(...point) + half,
  mcLo: null,
  mcHi: null,
});
// realizado com perfil horário fixo e um pouco de ruído determinístico
const real = (i: number) => Array.from({ length: 24 }, (_, h) => 200 + 40 * Math.sin((h / 24) * 2 * Math.PI) + ((i * 7 + h * 3) % 5) - 2);

describe("histórico de acerto das previsões publicadas", () => {
  it("confere dia a dia: MAE, ingênuo, viés, cobertura e acerto da faixa", () => {
    const rows = Array.from({ length: 40 }, (_, i) => real(i));
    const items = Array.from({ length: 30 }, (_, k) => entry(k + 10, rows[k + 10].map((v) => v - 6)));
    const dias = conferirDias(items, matrix(rows));
    expect(dias).toHaveLength(30);
    expect(dias[0].bias).toBeCloseTo(6, 6);
    expect(dias[0].mae).toBeCloseTo(6, 6);
    expect(dias[0].hourCoverage).toBe(1);
    expect(dias[0].dayHit).toBe(true);
    const r = resumir(dias);
    expect(r.dias).toBe(30);
    expect(r.vies).toBeCloseTo(6, 6);
    expect(r.porHora).toHaveLength(24);
    expect(r.porHora[5].vies).toBeCloseTo(6, 6);
    expect(r.movel.at(-1)?.mae).toBeCloseTo(6, 6);
    expect(r.meses.map((m) => m.mes)).toEqual(["2026-09", "2026-10"]);
  });

  it("dias interpolados ou sem realizado ficam de fora", () => {
    const rows = Array.from({ length: 20 }, (_, i) => real(i));
    const m = { ...matrix(rows), imputed: [date(12)] };
    const items = [entry(11, rows[11]), entry(12, rows[12]), entry(25, rows[0])];
    expect(conferirDias(items, m).map((d) => d.date)).toEqual([date(11)]);
  });
});

describe("refino pelo histórico (walk-forward)", () => {
  it("aprende um viés por hora persistente e liga a correção quando melhora fora da amostra", () => {
    const rows = Array.from({ length: 60 }, (_, i) => real(i));
    // modelo sempre 30 abaixo na ponta (18h–21h) e certo no resto
    const items = Array.from({ length: 45 }, (_, k) => entry(k + 12, rows[k + 12].map((v, h) => (h >= 18 && h <= 21 ? v - 30 : v)), 50));
    const r = avaliarRefino(items, matrix(rows));
    expect(r.avaliados).toBe(45 - REFINO.minTreino);
    expect(r.pontoAtivo).toBe(true);
    expect(r.ganho!).toBeGreaterThan(0.2);
    expect(r.vies[19]).toBeGreaterThan(10);
    expect(Math.abs(r.vies[3])).toBeLessThan(2);
  });

  it("não liga nada com poucos dias", () => {
    const rows = Array.from({ length: 30 }, (_, i) => real(i));
    const items = Array.from({ length: 10 }, (_, k) => entry(k + 12, rows[k + 12].map((v) => v - 20)));
    const r = avaliarRefino(items, matrix(rows));
    expect(r.pontoAtivo).toBe(false);
    expect(r.bandaAtiva).toBe(false);
    expect(r.motivo).toMatch(/aprendendo/);
  });

  it("não liga a correção do ponto quando o erro é só ruído sem viés", () => {
    const rows = Array.from({ length: 60 }, (_, i) => real(i));
    const items = Array.from({ length: 45 }, (_, k) => entry(k + 12, rows[k + 12].map((v, h) => v + ((k + h) % 2 ? 15 : -15)), 50));
    const r = avaliarRefino(items, matrix(rows));
    expect(r.pontoAtivo).toBe(false);
  });

  it("alarga a banda quando ela cobre bem menos que 90%", () => {
    const rows = Array.from({ length: 60 }, (_, i) => real(i));
    // erro de 4 a 8 (sinal alternado), meia-banda de 5: a banda cobre só ~40% das horas
    const items = Array.from({ length: 45 }, (_, k) => entry(k + 12, rows[k + 12].map((v, h) => v + ((k + h) % 2 ? 1 : -1) * (4 + (h % 5))), 5));
    const r = avaliarRefino(items, matrix(rows));
    expect(r.coberturaBase!).toBeLessThan(0.6);
    expect(r.escala).toBeGreaterThan(1.2);
    expect(r.bandaAtiva).toBe(true);
    expect(r.coberturaRefinada!).toBeGreaterThan(r.coberturaBase!);
  });

  it("aprende do modelo cru quando o publicado já estava refinado", () => {
    const rows = Array.from({ length: 60 }, (_, i) => real(i));
    const items = Array.from({ length: 45 }, (_, k) => {
      const base = rows[k + 12].map((v) => v - 20);
      return { ...entry(k + 12, rows[k + 12]), base, baseLo: base.map((v) => v - 50), baseHi: base.map((v) => v + 50) };
    });
    const r = avaliarRefino(items, matrix(rows));
    expect(r.vies[10]).toBeCloseTo(10, 6); // metade (encolhimento) do viés de 20 do modelo cru
    expect(r.pontoAtivo).toBe(true);
  });
});

describe("aplicação do refino na previsão", () => {
  const ts = Array.from({ length: 48 }, (_, i) => Date.parse("2026-11-20T00:00:00-03:00") + i * 3600_000);
  const hourOf = (t: number) => new Date(t - 3 * 3600_000).getUTCHours();
  const fc = () => ({
    horizon: {
      ts,
      point: ts.map(() => 100),
      lear: ts.map(() => 100),
      qraNextDay: { taus: [], quantiles: [] },
      aciLo: ts.map(() => 90),
      aciHi: ts.map(() => 110),
      mc: { p05: ts.map(() => 80), p25: ts.map(() => 95), p50: ts.map(() => 100), p75: ts.map(() => 105), p95: ts.map(() => 120) },
      dailyMean: [
        { date: "2026-11-20", point: 100, lear: 100, p05: 90, p95: 110 },
        { date: "2026-11-21", point: 100, lear: 100, p05: 90, p95: 110 },
      ],
    },
    paths: [ts.map(() => 100)],
    refino: undefined as Refino | undefined,
    refinoBase: undefined as { point: number[]; lo: number[]; hi: number[] } | undefined,
    firstForecastDate: "2026-11-20",
    generatedAt: 0,
    lastObservedDate: "2026-11-19",
  });
  const base = { avaliados: 20, maeBase: 1, maeRefinado: 1, ganho: 0.1, ganhoRecente: 0.1, coberturaBase: 0.9, coberturaRefinada: 0.9, motivo: "" };

  it("desligado: não mexe na previsão", () => {
    const out = aplicarRefino(fc(), { ...base, pontoAtivo: false, bandaAtiva: false, vies: new Array(24).fill(5), escala: 1.5 }, hourOf, [57, 1611]);
    expect(out.horizon.point[0]).toBe(100);
    expect(out.refinoBase).toBeUndefined();
    expect(out.refino?.pontoAtivo).toBe(false);
  });

  it("ligado: soma o viés da hora, escala a banda, respeita o piso e grava o modelo cru no registro", () => {
    const vies = new Array(24).fill(0);
    vies[19] = 12;
    vies[3] = -60;
    const out = aplicarRefino(fc(), { ...base, pontoAtivo: true, bandaAtiva: true, vies, escala: 2 }, hourOf, [57, 1611]);
    expect(out.horizon.point[19]).toBe(112);
    expect(out.horizon.point[43]).toBe(112);
    expect(out.horizon.point[3]).toBe(57); // 100 − 60 = 40 → piso
    expect(out.horizon.aciLo[0]).toBe(80);
    expect(out.horizon.aciHi[0]).toBe(120);
    expect(out.paths[0][19]).toBe(112);
    expect(out.horizon.dailyMean[0].point).toBeCloseTo(100 + (12 - 60) / 24, 2);
    const snap = snapshotForecast(out);
    expect(snap.point[19]).toBe(112);
    expect(snap.base?.[19]).toBe(100);
    expect(snap.baseLo?.[0]).toBe(90);
  });
});
