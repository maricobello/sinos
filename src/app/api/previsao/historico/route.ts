import { avaliarRefino, conferirDias, resumir, REFINO } from "@/lib/audit/forecast-history";
import { cached } from "@/lib/cache";
import { csvResponse, toCsv } from "@/lib/csv";
import { getBrazilBundle, getPld } from "@/lib/data";
import { loadForecastHistory } from "@/lib/forecast-log";
import { limitsFor, toDayMatrix } from "@/lib/market/brazil";
import { errorResponse, jsonResponse, SUB_PARAM } from "@/lib/services";
import type { Sub } from "@/lib/sources/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** PLD realizado cobrindo todo o histórico (o painel do app traz 120 dias; além disso busca a janela maior, 1 vez por hora). */
async function panelFor(first: string) {
  const br = await getBrazilBundle();
  const p = br.pld.data;
  if (!p) throw new Error(br.pld.error ?? "PLD indisponível");
  const firstTs = Date.parse(`${first}T00:00:00-03:00`);
  if (p.ts[0] <= firstTs - 8 * 86400_000) return { panel: p, simulated: br.pld.simulated };
  const days = Math.ceil((Date.now() - firstTs) / 86400_000) + 10;
  const { value } = await cached(`pld-hist:${days}`, 3600_000, async () => {
    const r = await getPld(days);
    if (!r.data) throw new Error(r.error ?? "PLD indisponível");
    return { panel: r.data, simulated: r.simulated };
  });
  return value;
}

async function build(sub: Sub) {
  const items = await loadForecastHistory(sub);
  if (!items.length) return { sub, registradas: 0, dias: [], resumo: resumir([]), refino: null, pendentes: 0 };
  const { panel, simulated } = await panelFor(items[0].date);
  if (simulated) throw new Error("PLD simulado: o histórico só é conferido com PLD real");
  const dm = toDayMatrix(panel, sub);
  const y = new Date(Date.now() - 3 * 3600_000).getUTCFullYear();
  const clip: [number, number] = [Math.min(limitsFor(y).min, limitsFor(y - 1).min), Math.max(limitsFor(y).maxHourly, limitsFor(y - 1).maxHourly)];
  const dias = conferirDias(items, dm, limitsFor(y).min);
  return {
    sub,
    registradas: items.length,
    pendentes: items.length - dias.length,
    primeira: items[0].date,
    dias,
    resumo: resumir(dias),
    refino: avaliarRefino(items, dm, clip),
    regras: REFINO,
  };
}

/**
 * Histórico de acerto das previsões publicadas desde o início do registro (out/2026), dia a dia,
 * com resumo por mês, evolução móvel, erro por hora e o teste fora da amostra do refino.
 * `?format=csv` devolve a tabela diária completa.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sub = SUB_PARAM(url.searchParams.get("sub"));
    const data = await build(sub);
    if (url.searchParams.get("format") === "csv") {
      const header = ["data", "media_prevista", "media_realizada", "faixa90_inf", "faixa90_sup", "dentro_faixa", "mae_publicada", "mae_ingenuo", "skill", "vies", "cobertura_horaria", "fracao_piso", "refinada"];
      const rows = data.dias.map((d) => [d.date, d.prev, d.real, d.dayLo, d.dayHi, d.dayHit ? 1 : 0, d.mae, d.maeNaive, d.skill ?? "", d.bias, d.hourCoverage, d.floorShare, d.refined ? 1 : 0]);
      return csvResponse(toCsv(header, rows, `SIN OS - historico de previsoes publicadas do PLD ${sub} (D+1, primeira publicada de cada dia) x PLD realizado; gerado ${new Date().toISOString()}`), `historico-previsao-${sub}`);
    }
    return jsonResponse(data, 1800);
  } catch (e) {
    return errorResponse(e);
  }
}
