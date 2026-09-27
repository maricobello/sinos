// Exploração (temporária) dos relatórios Power BI "Publicar na Web": páginas, visuais,
// esquema do modelo e amostra de linhas de cada visual. Só leitura, poucas requisições.
const REPORTS = [
  "eyJrIjoiMzQ1NWQ5YTItMGNkZS00N2FjLTk1N2EtYjkyNDEyMTY5MTlmIiwidCI6ImQ3YzNlNTA2LWVmODUtNDM4Ni04ZTU0LTJkZmNkYzgwMTdkMCJ9",
  "eyJrIjoiNjk2NzUyNmEtNGZkMy00NDZhLWI4ZjgtMzEyMzhiMDA4NGRkIiwidCI6ImQ3YzNlNTA2LWVmODUtNDM4Ni04ZTU0LTJkZmNkYzgwMTdkMCJ9",
];
const UA = "SIN-OS/1.0 (+https://github.com/maricobello/sinos)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function decodeDsr(result) {
  const data = result?.data;
  const sel = data?.descriptor?.Select ?? [];
  const ds = data?.dsr?.DS?.[0];
  if (!ds) return { cols: [], rows: [] };
  const dicts = ds.ValueDicts ?? {};
  const ph = (ds.PH ?? []).find((p) => p.DM0) ?? {};
  const dm = ph.DM0 ?? [];
  const schema = dm[0]?.S ?? [];
  const nameOf = (n) => sel.find((s) => s.Value === n)?.Name ?? n;
  const cols = schema.map((s) => nameOf(s.N));
  let prev = [];
  const rows = dm.map((row) => {
    const C = row.C ?? [];
    const R = row.R ?? 0;
    const N = row["Ø"] ?? 0;
    let ci = 0;
    const vals = schema.map((s, i) => {
      if (R & (1 << i)) return prev[i];
      if (N & (1 << i)) return null;
      let v = C[ci++];
      if (s.DN && typeof v === "number") v = dicts[s.DN]?.[v];
      return v;
    });
    prev = vals;
    return vals;
  });
  return { cols, rows, restart: !!ds.RT, complete: ds.IC };
}

for (const r of REPORTS) {
  const { k, t } = JSON.parse(Buffer.from(r, "base64").toString());
  console.log(`\n==================== relatório ${k} (tenant ${t})`);
  const route = await j(`https://api.powerbi.com/public/routing/cluster/${t}`);
  const api = route.FixedClusterUri.replace("-redirect", "-api").replace(/\/$/, "");
  console.log("cluster:", api);
  const H = { "X-PowerBI-ResourceKey": k };
  const me = await j(`${api}/public/reports/${k}/modelsAndExploration?preferReadOnlySession=true`, { headers: H });
  const model = me.models?.[0];
  const ex = me.exploration;
  console.log("modelo:", model?.id, model?.dbName, "| relatório:", ex?.report?.objectId ?? me.exploration?.report?.displayName, "| atualizado:", model?.LastRefreshTime ?? model?.lastRefreshTime);
  try {
    const cs = await j(`${api}/public/reports/conceptualschema`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ modelIds: [model.id], userPreferredLocale: "pt-BR" }) });
    for (const e of cs.schemas?.[0]?.schema?.Entities ?? []) {
      if (e.Hidden) continue;
      console.log(`  tabela ${e.Name}: ${(e.Properties ?? []).filter((p) => !p.Hidden).map((p) => `${p.Name}${p.Measure ? "(m)" : ""}`).join(", ").slice(0, 400)}`);
    }
  } catch (e) {
    console.log("  esquema indisponível:", e.message.slice(0, 200));
  }
  let queried = 0;
  for (const sec of ex?.sections ?? []) {
    console.log(`\n-- página: ${sec.displayName}`);
    for (const vc of sec.visualContainers ?? []) {
      let cfg;
      try {
        cfg = JSON.parse(vc.config);
      } catch {
        continue;
      }
      const sv = cfg.singleVisual;
      if (!sv?.prototypeQuery) continue;
      const q = sv.prototypeQuery;
      const sel = (q.Select ?? []).map((s) => s.Name).join(" | ");
      const title = sv.vcObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value ?? "";
      console.log(`   [${sv.visualType}] ${title} :: ${sel}`);
      if (queried >= 14 || ["slicer", "card", "textbox", "image", "shape"].includes(sv.visualType) && (q.Select ?? []).length < 1) continue;
      const body = {
        version: "1.0.0",
        queries: [
          {
            Query: {
              Commands: [
                {
                  SemanticQueryDataShapeCommand: {
                    Query: q,
                    Binding: { Primary: { Groupings: [{ Projections: q.Select.map((_, i) => i) }] }, DataReduction: { DataVolume: 3, Primary: { Top: { Count: 2000 } } }, Version: 1 },
                    ExecutionMetricsKind: 1,
                  },
                },
              ],
            },
            QueryId: "",
            ApplicationContext: { DatasetId: model.dbName, Sources: [{ ReportId: ex.report?.objectId ?? "", VisualId: cfg.name }] },
          },
        ],
        cancelQueries: [],
        modelId: model.id,
      };
      try {
        await sleep(400);
        const res = await j(`${api}/public/reports/querydata?synchronous=true`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        queried++;
        const d = decodeDsr(res.results?.[0]?.result);
        console.log(`      linhas: ${d.rows.length}${d.restart ? " (há mais)" : ""} · colunas: ${d.cols.join(" | ")}`);
        for (const row of d.rows.slice(0, 3)) console.log("        ", JSON.stringify(row).slice(0, 300));
        if (d.rows.length > 3) console.log("         …", JSON.stringify(d.rows[d.rows.length - 1]).slice(0, 300));
      } catch (e) {
        console.log("      consulta falhou:", e.message.slice(0, 200));
      }
    }
  }
}
