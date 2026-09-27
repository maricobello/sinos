// Exploração (temporária) 2: colunas brutas do PLD horário nos dois relatórios públicos.
const REPORTS = {
  dia: "eyJrIjoiMzQ1NWQ5YTItMGNkZS00N2FjLTk1N2EtYjkyNDEyMTY5MTlmIiwidCI6ImQ3YzNlNTA2LWVmODUtNDM4Ni04ZTU0LTJkZmNkYzgwMTdkMCJ9",
  hist: "eyJrIjoiNjk2NzUyNmEtNGZkMy00NDZhLWI4ZjgtMzEyMzhiMDA4NGRkIiwidCI6ImQ3YzNlNTA2LWVmODUtNDM4Ni04ZTU0LTJkZmNkYzgwMTdkMCJ9",
};
const UA = "SIN-OS/1.0 (+https://github.com/maricobello/sinos)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function raw(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json, text/html", ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}
const j = async (u, i) => JSON.parse(await raw(u, i));
function decode(result) {
  const sel = result?.data?.descriptor?.Select ?? [];
  const ds = result?.data?.dsr?.DS?.[0];
  if (!ds) return { cols: [], rows: [], err: JSON.stringify(result).slice(0, 400) };
  const dicts = ds.ValueDicts ?? {};
  const dm = (ds.PH ?? []).find((p) => p.DM0)?.DM0 ?? [];
  const schema = dm[0]?.S ?? [];
  let prev = [];
  const rows = dm.map((row) => {
    const C = row.C ?? [], R = row.R ?? 0, N = row["Ø"] ?? 0;
    let ci = 0;
    const v = schema.map((s, i) => (R & (1 << i) ? prev[i] : N & (1 << i) ? null : ((x) => (s.DN && typeof x === "number" ? dicts[s.DN]?.[x] : x))(C[ci++])));
    prev = v;
    return v;
  });
  return { cols: schema.map((s) => sel.find((x) => x.Value === s.N)?.Name ?? s.N), types: schema.map((s) => s.T), rows, rt: !!ds.RT };
}
const col = (src, p) => ({ Column: { Expression: { SourceRef: { Source: src } }, Property: p }, Name: `${src}.${p}` });
const agg = (src, p, f) => ({ Aggregation: { Expression: { Column: { Expression: { SourceRef: { Source: src } }, Property: p } }, Function: f }, Name: `f${f}(${src}.${p})` });
const ge = (src, p, lit) => ({ Condition: { Comparison: { ComparisonKind: 2, Left: { Column: { Expression: { SourceRef: { Source: src } }, Property: p } }, Right: { Literal: { Value: lit } } } } });

async function ctx(r) {
  const { k } = JSON.parse(Buffer.from(r, "base64").toString());
  const html = await raw(`https://app.powerbi.com/view?r=${r}`);
  const api = /resolvedClusterUri\s*=\s*['"]([^'"]+)['"]/.exec(html)[1].replace("-redirect", "-api").replace(/\/$/, "");
  const me = await j(`${api}/public/reports/${k}/modelsAndExploration?preferReadOnlySession=true`, { headers: { "X-PowerBI-ResourceKey": k } });
  return { k, api, model: me.models[0], reportId: me.exploration?.report?.objectId ?? "" };
}
async function query(c, entity, select, where = [], count = 5000) {
  const q = { Version: 2, From: [{ Name: "p", Entity: entity, Type: 0 }], Select: select, ...(where.length ? { Where: where } : {}) };
  const body = {
    version: "1.0.0",
    queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: q, Binding: { Primary: { Groupings: [{ Projections: select.map((_, i) => i) }] }, DataReduction: { DataVolume: 4, Primary: { Window: { Count: count } } }, Version: 1 }, ExecutionMetricsKind: 1 } }] }, QueryId: "", ApplicationContext: { DatasetId: c.model.dbName, Sources: [{ ReportId: c.reportId }] } }],
    cancelQueries: [],
    modelId: c.model.id,
  };
  await sleep(500);
  const res = await j(`${c.api}/public/reports/querydata?synchronous=true`, { method: "POST", headers: { "X-PowerBI-ResourceKey": c.k, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { res, d: decode(res.results?.[0]?.result) };
}
const show = (label, { d }, n = 8) => {
  console.log(`\n## ${label}: ${d.rows?.length ?? 0} linhas${d.rt ? " (+ mais)" : ""} · ${d.cols?.join(" | ")} · tipos ${JSON.stringify(d.types)}${d.err ? " · ERRO " + d.err : ""}`);
  for (const r of (d.rows ?? []).slice(0, n)) console.log("  ", JSON.stringify(r));
  if ((d.rows ?? []).length > n) console.log("   …", JSON.stringify(d.rows[d.rows.length - 1]));
};

const since = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
for (const [name, r] of Object.entries(REPORTS)) {
  console.log(`\n==================== ${name}`);
  const c = await ctx(r);
  console.log("modelo", c.model.id, "atualizado", c.model.LastRefreshTime ?? c.model.lastRefreshTime);
  try {
    show("modificado", await query(c, name === "dia" ? "DataModified" : "PLD_Horario_DataModified", [col("p", "DATA_MODIFIED")]));
  } catch (e) { console.log("modificado falhou", e.message.slice(0, 200)); }
  if (name === "dia") {
    try { show("FLAG_PERIODO x datas", await query(c, "PLD_Horario", [col("p", "FLAG_PERIODO"), agg("p", "DATA", 3), agg("p", "DATA", 4), agg("p", "PLD_HORA", 5)])); } catch (e) { console.log("flag falhou", e.message.slice(0, 300)); }
  }
  try { show("faixa de datas", await query(c, "PLD_Horario", [agg("p", "DATA", 3), agg("p", "DATA", 4), agg("p", "HORA", 3), agg("p", "HORA", 4)])); } catch (e) { console.log("faixa falhou", e.message.slice(0, 300)); }
  try { show("submercados", await query(c, "PLD_Horario", [col("p", "ID_SUBMERCADO"), col("p", "SUBMERCADO")])); } catch (e) { console.log("sub falhou", e.message.slice(0, 300)); }
  try {
    const out = await query(c, "PLD_Horario", [col("p", "DATA"), col("p", "HORA"), col("p", "ID_SUBMERCADO"), agg("p", "PLD_HORA", 3), agg("p", "PLD_HORA", 4)], [ge("p", "DATA", `datetime'${since}T00:00:00'`)]);
    show(`bruto desde ${since}`, out, 6);
    const days = {};
    for (const row of out.d.rows) { const d = new Date(row[0]).toISOString().slice(0, 10); days[d] = (days[d] ?? 0) + 1; }
    console.log("   linhas por dia:", JSON.stringify(days), "· min≠max:", out.d.rows.filter((x) => Number(x[3]) !== Number(x[4])).length);
    if (name === "dia") console.log("FIXTURE_JSON " + JSON.stringify(out.res.results[0].result).slice(0, 40000));
  } catch (e) { console.log("bruto falhou", e.message.slice(0, 300)); }
}
