import "server-only";
import { appendLog, snapshotForecast, type LoggedForecast } from "./audit/track-record";
import type { ForecastInternal } from "./market/forecast";
import type { Sub } from "./sources/types";
import { readDoc, saveDoc } from "./store";

/**
 * Registro das previsões publicadas, em dois níveis:
 *  - `forecast_log/{sub}`: os últimos 90 dias (usado pela auditoria dos modelos);
 *  - `forecast_archive/{sub}-{ano}`: o arquivo permanente, um documento por ano (≈ 1 KB por dia,
 *    ≈ 400 KB por ano, abaixo do limite de 1 MiB do Firestore). Nada é apagado: é a bagagem do modelo.
 * Lê sempre fresco antes de acrescentar (outra instância pode ter gravado o mesmo dia).
 */
const COLLECTION = "forecast_log";
const ARCHIVE = "forecast_archive";
/** Primeiro ano com previsões gravadas (o registro começou em out/2026). */
export const ARCHIVE_FIRST_YEAR = 2026;
type Log = { sub: Sub; items: LoggedForecast[] };
const done = new Set<string>();

const archiveId = (sub: Sub, year: number) => `${sub}-${year}`;

/** Acrescenta ao arquivo do ano; na primeira gravação do ano, semeia com o que já está no registro recente. */
async function archive(sub: Sub, entry: LoggedForecast, recent: LoggedForecast[]): Promise<void> {
  const year = Number(entry.date.slice(0, 4));
  const doc = await readDoc<Log>(ARCHIVE, archiveId(sub, year));
  let items = doc?.items ?? recent.filter((x) => x.date.startsWith(`${year}-`));
  if (!items.some((x) => x.date === entry.date)) items = [...items, entry];
  items = [...new Map(items.map((x) => [x.date, x])).values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!doc || items.length !== doc.items.length) await saveDoc(ARCHIVE, archiveId(sub, year), { sub, items });
}

/** Grava a previsão do primeiro dia previsto, se for a primeira daquele dia. Nunca lança. */
export async function logForecast(fc: ForecastInternal): Promise<void> {
  const key = `${fc.sub}:${fc.firstForecastDate}`;
  if (done.has(key)) return;
  done.add(key);
  try {
    const log = (await readDoc<Log>(COLLECTION, fc.sub)) ?? { sub: fc.sub, items: [] };
    const entry = snapshotForecast(fc);
    const items = appendLog(log.items, entry);
    if (items) await saveDoc(COLLECTION, fc.sub, { sub: fc.sub, items });
    await archive(fc.sub, entry, log.items);
  } catch {
    done.delete(key);
  }
}

export async function loadForecastLog(sub: Sub): Promise<LoggedForecast[]> {
  return ((await readDoc<Log>(COLLECTION, sub).catch(() => null)) ?? { items: [] }).items;
}

/** Histórico completo: todos os anos do arquivo + o registro recente (sem duplicar dias). */
export async function loadForecastHistory(sub: Sub, now = Date.now()): Promise<LoggedForecast[]> {
  const last = new Date(now - 3 * 3600_000).getUTCFullYear();
  const years = Array.from({ length: Math.max(1, last - ARCHIVE_FIRST_YEAR + 1) }, (_, i) => ARCHIVE_FIRST_YEAR + i);
  const docs = await Promise.all([loadForecastLog(sub), ...years.map((y) => readDoc<Log>(ARCHIVE, archiveId(sub, y)).then((d) => d?.items ?? [], () => []))]);
  const byDate = new Map<string, LoggedForecast>();
  // o arquivo vale primeiro; o recente preenche o que ainda não foi arquivado
  for (const items of [...docs.slice(1), docs[0]]) for (const x of items) if (!byDate.has(x.date)) byDate.set(x.date, x);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
