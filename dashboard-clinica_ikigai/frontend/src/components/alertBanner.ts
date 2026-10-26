/* =====================================================================
 * CLÍNICA IKIGAI - COMPONENTE: BANNER DE ALERTA DINÂMICO (CLEAN CODE)
 * Arquivo: frontend/src/components/alertBanner.ts
 * ===================================================================== */

import { PeriodMetrics } from '../types';
import { KPI_REGISTRY } from '../core/kpiDefinitions';
import { calculateMacroAreaScore, formatMetaDescription, MACRO_AREAS, TRAFFIC_LIGHT_ICONS } from '../core/trafficLight';

export const renderAlertBanner = (
  container: HTMLElement,
  currentMetrics: PeriodMetrics
): void => {
  const macroScores = MACRO_AREAS.map(macro => ({
    macro,
    ...calculateMacroAreaScore(macro, currentMetrics)
  }));

  // Avalia penalidade de cada indicador para identificar o maior foco de atenção
  const allSubKpisWithPenalty = macroScores.flatMap(area =>
    area.subKpis.map(sub => {
      const penalty = sub.status === 2
        ? 0
        : (sub.status === 0 ? 1 : 0) + sub.weight * Math.max(0, sub.gap);
      return {
        ...sub,
        macroArea: area.macro,
        penalty
      };
    })
  ).sort((a, b) => b.penalty - a.penalty);

  const topPriority = allSubKpisWithPenalty[0];
  const secondaryPriorities = allSubKpisWithPenalty.filter(k => k.status < 2).slice(1, 5);

  if (!topPriority || topPriority.status === 2) {
    container.innerHTML = `
      <div class="alerta s2" role="status">
        <span class="dot">✓</span>
        <div>
          <b>Tudo dentro da meta neste período</b>
          <small>Nenhum indicador em atenção ou crítico</small>
        </div>
      </div>
    `;
    return;
  }

  const kpiDef = KPI_REGISTRY[topPriority.kpiIndex];
  if (!kpiDef) return;

  const secondaryHtml = secondaryPriorities.length > 0
    ? `
      <div class="rk">
        <span>Depois dele:</span>
        ${secondaryPriorities.map((item, index) => {
          const itemKpi = KPI_REGISTRY[item.kpiIndex];
          return `
            <button class="s${item.status}" data-kpi-id="${item.kpiIndex}">
              <i class="dot">${TRAFFIC_LIGHT_ICONS[item.status]}</i>
              ${index + 2}º ${itemKpi.title} · ${itemKpi.formatValue(currentMetrics)}
            </button>
          `;
        }).join('')}
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="alerta s${topPriority.status}" role="alert">
      <span class="dot">${TRAFFIC_LIGHT_ICONS[topPriority.status]}</span>
      <div>
        <small>Maior foco de atenção agora</small>
        <b>${kpiDef.title} <em>· ${topPriority.macroArea.name}</em></b>
        <span>${kpiDef.formatValue(currentMetrics)} · ${formatMetaDescription(topPriority.kpiIndex)}</span>
      </div>
      <button class="bk" data-kpi-id="${topPriority.kpiIndex}">Abrir análise</button>
    </div>
    ${secondaryHtml}
  `;
};
