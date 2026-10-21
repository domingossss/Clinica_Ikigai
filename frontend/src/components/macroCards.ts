/* =====================================================================
 * CLÍNICA IKIGAI - COMPONENTE: CARTÕES DA VISÃO MACRO (CLEAN CODE)
 * Arquivo: frontend/src/components/macroCards.ts
 * ===================================================================== */

import { PeriodMetrics } from '../types';
import { KPI_REGISTRY } from '../core/kpiDefinitions';
import {
  calculateMacroAreaScore,
  formatMetaDescription,
  MACRO_AREAS,
  TRAFFIC_LIGHT_ICONS,
  TRAFFIC_LIGHT_NAMES
} from '../core/trafficLight';
import { formatDeltaHtml } from '../utils/formatters';

export const renderMacroCards = (
  container: HTMLElement,
  currentMetrics: PeriodMetrics,
  previousMetrics: PeriodMetrics
): void => {
  const evaluatedAreas = MACRO_AREAS.map(macro => ({
    macro,
    ...calculateMacroAreaScore(macro, currentMetrics)
  }));

  // Identifica a área com menor pontuação que precisa de atenção
  const lowestScoringArea = [...evaluatedAreas].sort((a, b) => a.score - b.score)[0];

  container.innerHTML = evaluatedAreas.map(area => {
    const isWorstArea = lowestScoringArea === area && area.status < 2;
    const warningBadge = isWorstArea ? ' · <strong>área que mais pesa</strong>' : '';

    const subKpisHtml = area.subKpis.map(sub => {
      const kpi = KPI_REGISTRY[sub.kpiIndex];
      const deltaHtml = formatDeltaHtml(kpi, currentMetrics, previousMetrics);

      return `
        <button class="sub s${sub.status}" data-kpi-id="${sub.kpiIndex}">
          <i class="dot">${TRAFFIC_LIGHT_ICONS[sub.status]}</i>
          <span class="sn">
            ${kpi.title}
            <em>peso ${Math.round(sub.weight * 100)}%</em>
            <small>${formatMetaDescription(sub.kpiIndex)}</small>
          </span>
          <b>${kpi.formatValue(currentMetrics)}</b>
          ${deltaHtml}
        </button>
      `;
    }).join('');

    return `
      <article class="mac s${area.status}">
        <header>
          <h3>${area.macro.name}</h3>
          <span class="badge s${area.status}">
            <i>${TRAFFIC_LIGHT_ICONS[area.status]}</i>
            ${TRAFFIC_LIGHT_NAMES[area.status]}
          </span>
        </header>
        <div class="sc">
          <b>${area.score}</b>
          <span>/100 nota da área</span>
        </div>
        <p>${area.macro.description}${warningBadge}</p>
        <div class="subs">
          ${subKpisHtml}
        </div>
      </article>
    `;
  }).join('');
};
