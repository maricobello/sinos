import "server-only";
import { cached } from "./cache";
import { getBrazilBundle, getPld } from "./data";
import { avaliarRefino, aplicarRefino } from "./audit/forecast-history";
import { loadForecastHistory, logForecast } from "./forecast-log";
import { limitsFor, toDayMatrix } from "./market/brazil";
import { brtHour } from "./sources/time";
import { bessStudy, type BessParams } from "./market/bess-study";
import { buildForecast, type ForecastInternal } from "./market/forecast";
import type { Sub } from "./sources/types";

/** Previsão cacheada por submercado; recalcula quando chega PLD novo ou a cada 30 min. */
export async function getForecast(sub: Sub, horizonDays = 7): Promise<{ fc: ForecastInternal; simulated: boolean; fallback: string | null }> {
  const br = await getBrazilBundle();
  const pld = br.pld.data;
  if (!pld) throw new Error(br.pld.error ?? "PLD indisponível");
  const lastTs = pld.ts[pld.ts.length - 1];
  const { value } = await cached(`fc:${sub}:${horizonDays}:${lastTs}:${br.pld.simulated}`, 30 * 60_000, async () => {
    const fc = buildForecast(pld, sub, horizonDays, 1000);
    if (br.pld.simulated) return fc;
    // refino pelo histórico das previsões publicadas: só entra se melhorou fora da amostra
    try {
      const hist = await Promise.race([loadForecastHistory(sub), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
      if (!hist?.length) return fc;
      const y = new Date(Date.now() - 3 * 3600_000).getUTCFullYear();
      const clip: [number, number] = [Math.min(limitsFor(y).min, limitsFor(y - 1).min), Math.max(limitsFor(y).maxHourly, limitsFor(y - 1).maxHourly)];
      return aplicarRefino(fc, avaliarRefino(hist, toDayMatrix(pld, sub), clip), brtHour, clip);
    } catch {
      return fc;
    }
  });
  // registro das previsões publicadas (auditoria), só com PLD real. Espera no máximo 3 s: na
  // Vercel o trabalho depois da resposta pode não terminar. Depois da 1ª vez no dia, é instantâneo.
  if (!br.pld.simulated) await Promise.race([logForecast(value), new Promise((r) => setTimeout(r, 3000))]);
  return { fc: value, simulated: br.pld.simulated, fallback: br.pld.fallback ?? null };
}

/** Estudo BESS no PLD real, cacheado por (último PLD, parâmetros). */
export async function getBessStudy(params: BessParams) {
  const pld = await getPld(params.days + 30);
  if (!pld.data) throw new Error(pld.error ?? "PLD indisponível");
  const last = pld.data.ts[pld.data.ts.length - 1];
  const { value } = await cached(`bess:${last}:${JSON.stringify(params)}`, 15 * 60_000, () => bessStudy(pld.data!, params));
  return { study: value, pld };
}

export const SUB_PARAM = (v: string | null): Sub => (v === "S" || v === "NE" || v === "N" ? v : "SE");

export function jsonResponse(data: unknown, sMaxAge = 60, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 5}` },
  });
}

export function errorResponse(e: unknown, status = 502) {
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status, headers: { "Cache-Control": "no-store" } });
}
