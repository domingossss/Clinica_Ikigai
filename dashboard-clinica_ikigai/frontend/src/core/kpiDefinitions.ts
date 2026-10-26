/* =====================================================================
 * CLÍNICA IKIGAI - REGISTRO E DEFINIÇÃO DOS 11 KPIS (CLEAN CODE)
 * Arquivo: frontend/src/core/kpiDefinitions.ts
 * ===================================================================== */

import { KpiDefinition } from '../types';
import { formatCurrency, formatMinutes, formatPercent } from '../utils/formatters';

export const KPI_REGISTRY: Record<number, KpiDefinition> = {
  // --- GRUPO 0: PERDAS DE AGENDA ---
  0: {
    groupId: 0,
    title: 'Taxa de reagendamento',
    formatValue: m => formatPercent(m.reschedulingRate),
    getRawValue: m => m.reschedulingRate,
    preferredDirection: -1,
    unit: 'pp',
    getSubtitle: m => `${m.rescheduledCount} de ${m.totalAppointments} agendamentos`
  },
  1: {
    groupId: 0,
    title: 'Não comparecimento',
    formatValue: m => formatPercent(m.absenceRate),
    getRawValue: m => m.absenceRate,
    preferredDirection: -1,
    unit: 'pp',
    getSubtitle: m => `${m.canceledCount + m.noShowCount} consultas perdidas · cancel. ${formatPercent(m.cancellationRate)} · no-show ${formatPercent(m.noShowRate)}`
  },

  // --- GRUPO 1: USO DA AGENDA ---
  2: {
    groupId: 1,
    title: 'Ocupação da agenda',
    formatValue: m => formatPercent(m.occupancyRate),
    getRawValue: m => m.occupancyRate,
    preferredDirection: 1,
    unit: 'pp',
    getSubtitle: m => `${m.totalAppointments - m.canceledCount} de ${m.totalCapacity} horários`
  },
  3: {
    groupId: 1,
    title: 'Atraso médio',
    formatValue: m => formatMinutes(m.averageDelayMinutes),
    getRawValue: m => m.averageDelayMinutes,
    preferredDirection: -1,
    unit: 'min',
    getSubtitle: () => 'nas consultas realizadas'
  },

  // --- INFORMATIVOS (NÃO PARTICIPAM DO FAROL) ---
  4: {
    groupId: 0,
    title: 'Atendimento integrativo mais realizado',
    formatValue: m => m.topSpecialty.name,
    getRawValue: null,
    preferredDirection: 0,
    unit: '',
    getSubtitle: m => `${m.topSpecialty.completedCount} atendimentos · ${formatPercent((m.topSpecialty.completedCount / Math.max(1, m.totalCompleted)) * 100)}`
  },
  5: {
    groupId: 1,
    title: 'Perfil predominante',
    formatValue: m => `${m.predominantAgeBracket} anos`,
    getRawValue: null,
    preferredDirection: 0,
    unit: '',
    getSubtitle: m => `${formatPercent(m.predominantAgeShare)} dos pacientes · ${formatPercent(m.healthInsuranceShare)} com convênio`
  },

  // --- GRUPO 2: PACIENTE E FINANCEIRO ---
  6: {
    groupId: 2,
    title: 'Satisfação (NPS)',
    formatValue: m => `${Math.round(m.netPromoterScore)}`,
    getRawValue: m => m.netPromoterScore,
    preferredDirection: 1,
    unit: 'pts',
    getSubtitle: m => `${m.ratedEvaluationsCount} avaliações`
  },
  7: {
    groupId: 2,
    title: 'Ticket médio',
    formatValue: m => formatCurrency(m.averageTicket),
    getRawValue: m => m.averageTicket,
    preferredDirection: 1,
    unit: 'rel',
    getSubtitle: m => `${m.totalCompleted} atendimentos`
  },
  8: {
    groupId: 2,
    title: 'Taxa de retorno',
    formatValue: m => formatPercent(m.returnRate),
    getRawValue: m => m.returnRate,
    preferredDirection: 1,
    unit: 'pp',
    getSubtitle: () => 'pacientes que voltaram'
  },

  // --- GRUPO 3: CHATBOT DE IA ---
  9: {
    groupId: 3,
    title: 'Resolução sem humano',
    formatValue: m => formatPercent(m.botResolutionRate),
    getRawValue: m => m.botResolutionRate,
    preferredDirection: 1,
    unit: 'pp',
    getSubtitle: m => `${m.botCompletedWithoutHuman} de ${m.botAppointmentsCount} agendamentos do bot`
  },
  10: {
    groupId: 3,
    title: 'Conversão em agendamento',
    formatValue: m => formatPercent(m.botConversionRate),
    getRawValue: m => m.botConversionRate,
    preferredDirection: 1,
    unit: 'pp',
    getSubtitle: m => `${m.botAppointmentsCount} de ${m.totalChatbotConversations} conversas`
  }
};
