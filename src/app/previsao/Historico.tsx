"use client";

import { Download } from "lucide-react";
import { useMemo } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, Disclosure, Empty, ErrorBox, Loading, Panel, Stat, Table } from "@/components/ui";
import type { DiaConferido, Refino, ResumoHistorico } from "@/lib/audit/forecast-history";
import { baseOption, C, categoryAxis, SUB_COLOR, valueAxis } from "@/lib/chart";
import { brl, num, pct, signed } from "@/lib/fmt";
import type { Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

interface Resp {
  sub: Sub;
  registradas: number;
  pendentes: number;
  primeira?: string;
  dias: DiaConferido[];
  resumo: ResumoHistorico;
  refino: Refino | null;
}

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const brAno = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesLabel = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const p100 = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : pct(v * 100, d));

/** Erro diário da publicada × ingênuo (barras) e o skill móvel de 30 dias (linha, eixo da direita). */
function evolucao(d: Resp): ChartOption {
  const color = SUB_COLOR[d.sub];
  return {
    ...baseOption(),
    tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 8, top: 48, bottom: 8, containLabel: true },
    legend: { ...baseOption().legend, data: ["Erro da previsão publicada", "Erro do ingênuo", "Ganho sobre o ingênuo (30 dias)"] },
    xAxis: categoryAxis(d.dias.map((x) => br(x.date))),
    yAxis: [
      valueAxis("MAE R$/MWh", { scale: false }),
      valueAxis("ganho %", { scale: false, position: "right", splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11, formatter: (v: number) => `${num(v, 0)}%` } }),
    ],
    series: [
      { name: "Erro da previsão publicada", type: "bar", barMaxWidth: 10, barGap: "15%", itemStyle: { color, borderRadius: [3, 3, 0, 0] }, data: d.dias.map((x) => x.mae), tooltip: { valueFormatter: (v: number) => brl(v) } },
      { name: "Erro do ingênuo", type: "bar", barMaxWidth: 10, itemStyle: { color: C.axis, borderRadius: [3, 3, 0, 0] }, data: d.dias.map((x) => x.maeNaive), tooltip: { valueFormatter: (v: number) => brl(v) } },
      {
        name: "Ganho sobre o ingênuo (30 dias)",
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        smooth: 0.3,
        lineStyle: { width: 2.5, color: C.good },
        itemStyle: { color: C.good },
        areaStyle: { color: C.goodSoft, opacity: 0.12 },
        data: d.resumo.movel.map((m) => (m.skill === null ? null : Math.round(m.skill * 1000) / 10)),
        tooltip: { valueFormatter: (v: number | null) => (v === null ? "—" : `${num(v, 1)}%`) },
      },
    ],
  };
}

/** Média do dia: prevista, realizada e a faixa de 90% publicada, dia a dia. */
function calibracao(d: Resp): ChartOption {
  const color = SUB_COLOR[d.sub];
  const x = d.dias.map((v) => br(v.date));
  return {
    ...baseOption(),
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => brl(v) },
    legend: { ...baseOption().legend, data: ["Realizado", "Previsto (publicado)", "Faixa 90% publicada"] },
    xAxis: categoryAxis(x, { boundaryGap: false }),
    yAxis: valueAxis("R$/MWh (média do dia)"),
    series: [
      { name: "Faixa 90% publicada-base", type: "line", data: d.dias.map((v) => v.dayLo), stack: "f", lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
      { name: "Faixa 90% publicada", type: "line", data: d.dias.map((v) => Math.max(0, v.dayHi - v.dayLo)), stack: "f", lineStyle: { opacity: 0, color }, itemStyle: { color, opacity: 0.4 }, areaStyle: { color, opacity: 0.13 }, showSymbol: false, silent: true, tooltip: { show: false } },
      { name: "Previsto (publicado)", type: "line", data: d.dias.map((v) => v.prev), showSymbol: false, lineStyle: { width: 2, color, type: [5, 3] }, itemStyle: { color } },
      {
        name: "Realizado",
        type: "line",
        data: d.dias.map((v) => ({ value: v.real, itemStyle: { color: v.dayHit ? C.ink2 : C.critical } })),
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, color: C.ink2 },
        itemStyle: { color: C.ink2 },
      },
    ],
  };
}

/** Viés por hora (real − previsto): onde o modelo erra para cima ou para baixo, e o que o refino corrige. */
function porHora(d: Resp): ChartOption {
  const corr = d.refino?.vies ?? [];
  return {
    ...baseOption(),
    tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: number) => brl(v) },
    legend: { ...baseOption().legend, data: ["Viés médio (real − previsto)", "Correção aprendida"] },
    xAxis: categoryAxis(d.resumo.porHora.map((h) => `${h.hora}h`)),
    yAxis: valueAxis("R$/MWh", { scale: false }),
    series: [
      {
        name: "Viés médio (real − previsto)",
        type: "bar",
        barMaxWidth: 14,
        data: d.resumo.porHora.map((h) => ({ value: h.vies, itemStyle: { color: h.vies >= 0 ? C.series[1] : C.series[0], borderRadius: h.vies >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } })),
      },
      { name: "Correção aprendida", type: "line", data: corr, showSymbol: false, step: "middle", lineStyle: { width: 2, color: C.good }, itemStyle: { color: C.good } },
    ],
  };
}

/**
 * Track record: as previsões que a tela publicou (a primeira de cada dia, D+1), gravadas no dia em
 * que saíram e conferidas contra o PLD que aconteceu. Nada é reconstruído depois: é o placar real.
 */
export function HistoricoPrevisao({ sub }: { sub: Sub }) {
  const { data: d, error, mutate } = useApi<Resp>(`/api/previsao/historico?sub=${sub}`, 1800_000);
  const ev = useMemo(() => (d?.dias.length ? evolucao(d) : null), [d]);
  const cal = useMemo(() => (d?.dias.length ? calibracao(d) : null), [d]);
  const hr = useMemo(() => (d?.dias.length ? porHora(d) : null), [d]);
  const r = d?.resumo;
  const rf = d?.refino;

  return (
    <Panel
      title={`Histórico de acerto — ${sub}`}
      subtitle={
        r?.dias
          ? `${r.dias} dias de previsões publicadas conferidas com o PLD realizado, de ${brAno(r.desde)} a ${brAno(r.ate)}. Gravadas no dia em que saíram: nada é refeito depois.`
          : "Previsões publicadas (D+1), gravadas no dia em que saíram e conferidas com o PLD realizado"
      }
      right={
        d?.dias.length ? (
          <a href={`/api/previsao/historico?sub=${sub}&format=csv`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-2 sm:min-h-9" title="Baixar o histórico diário completo em CSV">
            <Download size={14} aria-hidden />
            Baixar histórico
          </a>
        ) : null
      }
    >
      {error && !d ? (
        <ErrorBox error={error} onRetry={() => mutate()} />
      ) : !d ? (
        <Loading height={260} label="Conferindo o histórico com o PLD realizado…" />
      ) : !d.dias.length ? (
        <Empty height={200} label={d.registradas ? `${d.registradas} previsão(ões) gravada(s), aguardando o PLD realizado para conferir.` : "Ainda não há previsões gravadas para este submercado."} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Dias no placar" value={num(r!.dias)} hint={d.pendentes ? `+${d.pendentes} aguardando o PLD` : `desde ${brAno(r!.desde)}`} swatch={SUB_COLOR[sub]} />
            <Stat
              label="Ganho sobre o ingênuo"
              value={p100(r!.skill)}
              hint={`erro médio ${brl(r!.mae)} vs ${brl(r!.maeNaive)}`}
              delta={r!.skill === null ? null : r!.skill > 0 ? "melhor que repetir a semana" : "pior que repetir a semana"}
              deltaGood={r!.skill === null ? null : r!.skill > 0}
            />
            <Stat label="Dias vencendo o ingênuo" value={p100(r!.venceIngenuo, 0)} hint="entre os dias com diferença" />
            <Stat label="Cobertura da banda horária" value={p100(r!.coberturaHora, 0)} hint="alvo 90% das horas dentro da faixa" />
            <Stat label="Viés médio" value={brl(r!.vies)} hint={r!.vies !== null && Math.abs(r!.vies) >= 1 ? (r!.vies > 0 ? "previsão abaixo do realizado" : "previsão acima do realizado") : "sem viés relevante"} />
          </div>

          {ev ? <EChart option={ev} height={300} label="Erro diário da previsão publicada e do ingênuo, e ganho móvel de 30 dias" /> : null}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-1 text-[14px] font-semibold text-ink">Média do dia: previsto × realizado</h3>
              <p className="text-[12px] text-muted">Ponto vermelho: o realizado saiu da faixa de 90% publicada ({p100(r!.coberturaDia, 0)} dos dias dentro).</p>
              {cal ? <EChart option={cal} height={260} label="Média diária prevista, realizada e faixa de 90%" /> : null}
            </div>
            <div className="min-w-0">
              <h3 className="mb-1 text-[14px] font-semibold text-ink">Onde o modelo erra: viés por hora</h3>
              <p className="text-[12px] text-muted">Laranja: previsão abaixo do realizado; azul: acima. Verde: a correção que o refino aprendeu (mediana dos erros: um viés que vem de poucos dias de pico não vira correção).</p>
              {hr ? <EChart option={hr} height={260} label="Viés por hora do dia e correção aprendida" /> : null}
            </div>
          </div>

          {rf ? (
            <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-semibold text-ink">Refino pelo histórico</h3>
                <Badge level={rf.pontoAtivo ? "good" : rf.avaliados >= 14 ? "neutral" : "warning"}>{rf.pontoAtivo ? "correção do viés ligada" : rf.avaliados >= 14 ? "viés: desligado (sem ganho)" : "aprendendo"}</Badge>
                <Badge level={rf.bandaAtiva ? "good" : "neutral"}>{rf.bandaAtiva ? `banda ×${num(rf.escala, 2)}` : "banda original"}</Badge>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-ink-2">{rf.motivo}.</p>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Dias testados fora da amostra" value={num(rf.avaliados)} hint="cada dia só usa erros anteriores a ele" />
                <Stat label="Erro do modelo cru" value={brl(rf.maeBase)} hint="R$/MWh por hora" />
                <Stat label="Erro com o refino" value={brl(rf.maeRefinado)} delta={rf.ganho === null ? null : `${signed(rf.ganho * 100, 1)}% de ganho`} deltaGood={rf.ganho === null ? null : rf.ganho > 0} />
                <Stat label="Cobertura da banda" value={`${p100(rf.coberturaBase, 0)} → ${p100(rf.coberturaRefinada, 0)}`} hint="antes → depois do ajuste (alvo 90%)" />
              </div>
            </div>
          ) : null}

          <Disclosure title="Placar por mês e dia a dia" hint="tabela completa">
            <Table
              label="Placar por mês"
              head={["Mês", "Dias", "Erro médio", "Ingênuo", "Ganho", "Cobertura horária"]}
              align={["left", "right", "right", "right", "right", "right"]}
              rows={r!.meses.map((m) => [<b key="m">{mesLabel(m.mes)}</b>, num(m.dias), brl(m.mae), brl(m.maeNaive), p100(m.skill), p100(m.coberturaHora, 0)])}
            />
            <Table
              label="Placar dia a dia"
              head={["Dia", "Previsto", "Realizado", "Faixa 90%", "Erro médio", "Ingênuo", "Ganho", "Cobertura", "Refino"]}
              align={["left", "right", "right", "right", "right", "right", "right", "right", "center"]}
              rows={[...d.dias].reverse().map((x) => [
                <b key="d">{brAno(x.date)}</b>,
                brl(x.prev),
                <span key="r" className={x.dayHit ? undefined : "font-semibold text-critical"}>{brl(x.real)}</span>,
                `${num(x.dayLo, 0)}–${num(x.dayHi, 0)}`,
                brl(x.mae),
                brl(x.maeNaive),
                <span key="s" className={x.skill === null ? "text-muted" : x.skill > 0 ? "text-good" : "text-critical"}>{p100(x.skill, 0)}</span>,
                p100(x.hourCoverage, 0),
                x.refined ? "sim" : "—",
              ])}
            />
          </Disclosure>
        </div>
      )}
    </Panel>
  );
}
