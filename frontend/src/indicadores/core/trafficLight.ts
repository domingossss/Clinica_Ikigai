/* =====================================================================
 * CLÍNICA IKIGAI - SISTEMA DO SEMÁFORO (FAROL) E NOTAS MACRO (CLEAN CODE)
 * Arquivo: frontend/src/core/trafficLight.ts
 * ===================================================================== */

import { type MacroAreaDefinition, type MacroAreaScore, type PeriodMetrics, type TrafficLightStatus, type TrafficLightThreshold } from '../types';
import { KPI_REGISTRY } from './kpiDefinitions';
import { formatKpiUnitValue } from '../utils/formatters';

export const TRAFFIC_LIGHT_NAMES: Record<TrafficLightStatus, string> = {
  3: 'Sem dados',
  0: 'Vermelho',
  1: 'Amarelo',
  2: 'Verde'
};

export const TRAFFIC_LIGHT_ICONS: Record<TrafficLightStatus, string> = {
  3: '—',
  0: '✕',
  1: '!',
  2: '✓'
};

/** Metas e limites do Semáforo (Farol) para os KPIs monitorados */
export const TRAFFIC_LIGHT_THRESHOLDS: Record<number, TrafficLightThreshold> = {
  0: { okThreshold: 8, badThreshold: 12, direction: -1 },   // Taxa de reagendamento (<= 8% ok, > 12% crítico)
  1: { okThreshold: 15, badThreshold: 20, direction: -1 },  // Não comparecimento (<= 15% ok, > 20% crítico)
  2: { okThreshold: 80, badThreshold: 70, direction: 1 },   // Ocupação da agenda (>= 80% ok, < 70% crítico)
  3: { okThreshold: 10, badThreshold: 15, direction: -1 },  // Atraso médio (<= 10 min ok, > 15 min crítico)
  6: { okThreshold: 50, badThreshold: 30, direction: 1 },   // NPS (>= 50 pts ok, < 30 pts crítico)
  7: { okThreshold: 250, badThreshold: 220, direction: 1 }, // Ticket médio (>= R$ 250 ok, < R$ 220 crítico)
  8: { okThreshold: 40, badThreshold: 30, direction: 1 },   // Taxa de retorno (>= 40% ok, < 30% crítico)
  9: { okThreshold: 80, badThreshold: 65, direction: 1 },   // Resolução sem humano (>= 80% ok, < 65% crítico)
  10: { okThreshold: 75, badThreshold: 60, direction: 1 }   // Conversão chatbot (>= 75% ok, < 60% crítico)
};

/** Definição das 4 Macro Áreas Operacionais com seus respectivos pesos */
export const MACRO_AREAS: MacroAreaDefinition[] = [
  {
    name: 'Perdas de agenda',
    description: 'Consultas perdidas e remarcações',
    subKpis: [[1, 0.6], [0, 0.4]] // 60% Não comparecimento, 40% Reagendamento
  },
  {
    name: 'Uso da agenda',
    description: 'Quanto da agenda é aproveitada e com que pontualidade',
    subKpis: [[2, 0.6], [3, 0.4]] // 60% Ocupação, 40% Atraso médio
  },
  {
    name: 'Paciente e financeiro',
    description: 'Satisfação, fidelização e valor por atendimento',
    subKpis: [[6, 0.4], [8, 0.3], [7, 0.3]] // 40% NPS, 30% Retorno, 30% Ticket
  },
  {
    name: 'Chatbot de IA',
    description: 'Quanto o bot resolve e converte sem ajuda humana',
    subKpis: [[9, 0.5], [10, 0.5]] // 50% Resolução, 50% Conversão
  }
];

export const hasKpiData = (id: number, metrics: PeriodMetrics): boolean => {
  if (id === 3) return metrics.completedAppointments.some(a => a.delayMeasured);
  if (id === 6) return metrics.ratedEvaluationsCount > 0;
  if (id === 2) return metrics.totalCapacity > 0;
  if (id === 9 || id === 10) return metrics.totalChatbotConversations > 0;
  if ([3, 7, 8].includes(id)) return metrics.totalCompleted > 0;
  return metrics.totalAppointments > 0;
};

export function calculateThresholdStatus(kpiIndex: number, value: number, hasData = true): TrafficLightStatus {
  if (!hasData || !Number.isFinite(value)) return 3;
  const t = TRAFFIC_LIGHT_THRESHOLDS[kpiIndex];
  if (!t) return 2;
  return t.direction < 0 ? value <= t.okThreshold ? 2 : value <= t.badThreshold ? 1 : 0 : value >= t.okThreshold ? 2 : value >= t.badThreshold ? 1 : 0;
}

/** Avalia o status do farol (0, 1 ou 2) para um KPI específico */
export const calculateKpiStatus = (kpiIndex: number, metrics: PeriodMetrics): TrafficLightStatus => {
  const threshold = TRAFFIC_LIGHT_THRESHOLDS[kpiIndex];
  if (!hasKpiData(kpiIndex, metrics)) return 3;
  if (!threshold) return 2; // Sem meta configurada considera Verde

  const kpi = KPI_REGISTRY[kpiIndex];
  const val = kpi?.getRawValue ? kpi.getRawValue(metrics) : 0;

  if (threshold.direction < 0) {
    if (val <= threshold.okThreshold) return 2;
    if (val <= threshold.badThreshold) return 1;
    return 0;
  } else {
    if (val >= threshold.okThreshold) return 2;
    if (val >= threshold.badThreshold) return 1;
    return 0;
  }
};

/** Calcula a distância (gap) relativa entre o valor atual e os limites da meta */
export const calculateKpiGap = (kpiIndex: number, metrics: PeriodMetrics): number => {
  const threshold = TRAFFIC_LIGHT_THRESHOLDS[kpiIndex];
  if (!threshold) return 0;

  const kpi = KPI_REGISTRY[kpiIndex];
  const val = kpi?.getRawValue ? kpi.getRawValue(metrics) : 0;

  return threshold.direction < 0
    ? (val - threshold.okThreshold) / (threshold.badThreshold - threshold.okThreshold)
    : (threshold.okThreshold - val) / (threshold.okThreshold - threshold.badThreshold);
};

/** Formata o texto descritivo da meta para o tooltip / detalhe */
export const formatMetaDescription = (kpiIndex: number): string => {
  const threshold = TRAFFIC_LIGHT_THRESHOLDS[kpiIndex];
  if (!threshold) return '';
  const kpi = KPI_REGISTRY[kpiIndex];
  const unit = kpi?.unit ?? '';

  const okFormatted = formatKpiUnitValue(unit, threshold.okThreshold);
  const badFormatted = formatKpiUnitValue(unit, threshold.badThreshold);
  const okOp = threshold.direction < 0 ? '≤' : '≥';
  const badOp = threshold.direction < 0 ? '>' : '<';

  return `Meta ${okOp} ${okFormatted} · crítico ${badOp} ${badFormatted}`;
};

/**
 * Calcula a pontuação e o status de uma Macro Área, aplicando a Regra de Veto Mandatória
 */
export const calculateMacroAreaScore = (
  macroArea: MacroAreaDefinition,
  metrics: PeriodMetrics
): MacroAreaScore => {
  const subKpis = macroArea.subKpis.map(([kpiIndex, weight]) => ({
    kpiIndex,
    weight,
    status: calculateKpiStatus(kpiIndex, metrics),
    gap: calculateKpiGap(kpiIndex, metrics)
  }));

  // Pontuação ponderada: Verde = 100, Amarelo = 50, Vermelho = 0
  const scoreMultipliers: Record<TrafficLightStatus, number> = { 0: 0, 1: 50, 2: 100, 3: 0 };
  const pesoDisponivel = subKpis.filter(sub => sub.status !== 3).reduce((n, sub) => n + sub.weight, 0);
  const rawScore = pesoDisponivel > 0 ? Math.round(subKpis.reduce((n, sub) => n + sub.weight * scoreMultipliers[sub.status], 0) / pesoDisponivel) : 0;

  let status: TrafficLightStatus = !pesoDisponivel ? 3 : rawScore >= 75 ? 2 : rawScore >= 30 ? 1 : 0;

  // Regra de Veto: Se QUALQUER indicador for Vermelho, a área não pode ser Verde (máximo Amarelo)
  if (subKpis.some(sub => sub.status === 0)) {
    status = Math.min(status, 1) as TrafficLightStatus;
  }

  return {
    subKpis,
    score: rawScore,
    status
  };
};
