/* =====================================================================
 * CLÍNICA IKIGAI - UTILITÁRIOS DE FORMATAÇÃO E INTERNACIONALIZAÇÃO
 * Arquivo: frontend/src/utils/formatters.ts
 * ===================================================================== */

import { KpiDefinition, PeriodMetrics } from '../types';

/** Formata número com 1 casa decimal e vírgula no padrão brasileiro */
export const formatNumber = (value: number, decimals = 1): string => {
  return value.toFixed(decimals).replace('.', ',');
};

/** Formata valor percentual: 12.34 -> "12,3%" */
export const formatPercent = (value: number): string => {
  return `${formatNumber(value, 1)}%`;
};

/** Formata valor monetário em reais: 250 -> "R$ 250" */
export const formatCurrency = (value: number): string => {
  return `R$ ${Math.round(value).toLocaleString('pt-BR')}`;
};

/** Formata minutos de atraso: 7.2 -> "7 min" */
export const formatMinutes = (value: number): string => {
  return `${Math.round(value)} min`;
};

/** Formata valor baseado na unidade do indicador */
export const formatKpiUnitValue = (unit: string, value: number): string => {
  switch (unit) {
    case 'pp':
      return `${formatNumber(value, 1)}%`;
    case 'min':
      return `${Math.round(value)} min`;
    case 'rel':
      return formatCurrency(value);
    case 'pts':
      return `${Math.round(value)} pts`;
    default:
      return formatNumber(value, 1);
  }
};

/**
 * Calcula e formata a variação (delta) entre o período atual e o anterior
 * Gera a tag HTML com a seta correspondente e classe de cor (up, dn, flat)
 */
export const formatDeltaHtml = (
  kpi: KpiDefinition,
  currentMetrics: PeriodMetrics,
  previousMetrics: PeriodMetrics
): string => {
  if (!kpi.getRawValue) return '';

  const currentValue = kpi.getRawValue(currentMetrics);
  const previousValue = kpi.getRawValue(previousMetrics);

  const delta = kpi.unit === 'rel'
    ? ((currentValue - previousValue) / Math.max(1e-9, previousValue)) * 100
    : currentValue - previousValue;

  const isFlat = Math.abs(delta) < 0.05;
  const isPositive = kpi.preferredDirection * delta > 0;
  const colorClass = isFlat ? 'flat' : isPositive ? 'up' : 'dn';
  const unitSuffix = kpi.unit === 'rel' ? '%' : ` ${kpi.unit}`;
  const arrow = delta >= 0 ? '▲' : '▼';

  return `<div class="d ${colorClass}">${arrow} ${formatNumber(Math.abs(delta), 1)}${unitSuffix} vs anterior</div>`;
};
