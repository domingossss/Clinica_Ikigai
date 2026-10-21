/* =====================================================================
 * CLÍNICA IKIGAI - COMPONENTE: CARDS INFORMATIVOS E TABELA DE METAS
 * Arquivo: frontend/src/components/informativeCards.ts
 * ===================================================================== */

import { PeriodMetrics } from '../types';
import { KPI_REGISTRY } from '../core/kpiDefinitions';
import {
  MACRO_AREAS,
  TRAFFIC_LIGHT_THRESHOLDS
} from '../core/trafficLight';
import { formatKpiUnitValue } from '../utils/formatters';

export const renderInformativeCards = (
  container: HTMLElement,
  currentMetrics: PeriodMetrics
): void => {
  // Filtra indicadores informativos que não possuem regras de semáforo rígidas
  const informativeKpis = Object.entries(KPI_REGISTRY)
    .map(([idStr, def]) => ({ id: Number(idStr), def }))
    .filter(({ id }) => !(id in TRAFFIC_LIGHT_THRESHOLDS));

  container.innerHTML = informativeKpis.map(({ id, def }) => `
    <button class="k" data-kpi-id="${id}" aria-label="Abrir análise: ${def.title}">
      <div class="t">${def.title}</div>
      <div class="v">${def.formatValue(currentMetrics)}</div>
      <div class="s">${def.getSubtitle(currentMetrics)}</div>
      <div class="go">Abrir análise</div>
    </button>
  `).join('');
};

/** Renderiza a tabela de detalhamento de metas, pesos e regras do semáforo */
export const renderRulesTable = (tableElement: HTMLElement): void => {
  const rowsHtml = MACRO_AREAS.flatMap(macro =>
    macro.subKpis.map(([kpiId, weight], idx) => {
      const kpi = KPI_REGISTRY[kpiId];
      const rule = TRAFFIC_LIGHT_THRESHOLDS[kpiId];
      if (!rule) return '';

      const unit = kpi.unit;
      const okVal = formatKpiUnitValue(unit, rule.okThreshold);
      const badVal = formatKpiUnitValue(unit, rule.badThreshold);

      const greenText = rule.direction < 0 ? `≤ ${okVal}` : `≥ ${okVal}`;
      const yellowText = rule.direction < 0 ? `${okVal} a ${badVal}` : `${badVal} a ${okVal}`;
      const redText = rule.direction < 0 ? `> ${badVal}` : `< ${badVal}`;

      return `
        <tr>
          <td>${idx === 0 ? `<b>${macro.name}</b>` : ''}</td>
          <td>${kpi.title}</td>
          <td>${Math.round(weight * 100)}%</td>
          <td>${greenText}</td>
          <td>${yellowText}</td>
          <td>${redText}</td>
        </tr>
      `;
    })
  ).join('');

  tableElement.innerHTML = `
    <thead>
      <tr>
        <th>Área</th>
        <th>Indicador</th>
        <th>Peso</th>
        <th>Verde</th>
        <th>Amarelo</th>
        <th>Vermelho</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  `;
};
