/* =====================================================================
 * CLÍNICA IKIGAI - MOTOR DE CÁLCULO DE KPIS (CLEAN CODE)
 * Arquivo: frontend/src/core/metricsEngine.ts
 * ===================================================================== */

import { Appointment, PeriodMetrics, SpecialtySummary, SpecialtyTuple } from '../types';
import { AGE_BRACKETS, calculateCapacity } from '../utils/dateUtils';

/** Calcula a média de uma lista com base em uma função extratora */
export const calculateAverage = <T>(list: T[], extractor: (item: T) => number): number => {
  if (list.length === 0) return 0;
  const sum = list.reduce((accum, item) => accum + extractor(item), 0);
  return sum / list.length;
};

/**
 * Calcula todas as métricas operacionais, clínicas e de IA para o período selecionado
 * Substitui com clareza semântica a função M() minificada do código original.
 */
export const calculatePeriodMetrics = (
  allAppointments: Appointment[],
  abandonedSessions: number[],
  specialties: SpecialtyTuple[],
  startDayOffset: number,
  endDayOffset: number,
  specialtyFilterIndex: number
): PeriodMetrics => {
  // Proporção de capacidade estimada da especialidade
  const specialtyShare = specialtyFilterIndex < 0
    ? 1
    : (specialties[specialtyFilterIndex]?.[2] ?? 100) / 100;

  // Filtra agendamentos no intervalo [startDayOffset, endDayOffset)
  const filteredAppointments = allAppointments.filter(app => {
    const inRange = app.dayOffset >= startDayOffset && app.dayOffset < endDayOffset;
    const matchesSpecialty = specialtyFilterIndex < 0 || app.specialtyIndex === specialtyFilterIndex;
    return inRange && matchesSpecialty;
  });

  const totalAppointments = Math.max(1, filteredAppointments.length);
  const completedAppointments = filteredAppointments.filter(app => app.status === 'R');
  const canceledCount = filteredAppointments.filter(app => app.status === 'C').length;
  const noShowCount = filteredAppointments.filter(app => app.status === 'N').length;
  const rescheduledCount = filteredAppointments.filter(app => app.status === 'M').length;

  // Pesquisa de Satisfação (NPS)
  const ratedAppointments = completedAppointments.filter(app => app.npsRating !== null);
  const promotersCount = ratedAppointments.filter(app => (app.npsRating ?? 0) >= 9).length;
  const detractorsCount = ratedAppointments.filter(app => (app.npsRating ?? 0) <= 6).length;
  const netPromoterScore = ratedAppointments.length > 0
    ? ((promotersCount - detractorsCount) / ratedAppointments.length) * 100
    : 0;

  // Chatbot de IA
  const botAppointments = filteredAppointments.filter(app => app.isChatbotOrigin);
  const botCompletedWithoutHuman = botAppointments.filter(app => app.status === 'R' && !app.isEscalatedToHuman).length;

  // Capacidade e Ocupação
  const totalCapacity = Math.round(calculateCapacity(startDayOffset, endDayOffset) * specialtyShare);
  const occupancyRate = totalCapacity > 0
    ? ((filteredAppointments.length - canceledCount) / totalCapacity) * 100
    : 0;

  // Conversas abandonadas no período
  let totalAbandonedSessions = 0;
  for (let d = startDayOffset; d < endDayOffset; d++) {
    totalAbandonedSessions += (abandonedSessions[d] || 0) * specialtyShare;
  }
  const totalChatbotConversations = Math.round(botAppointments.length + totalAbandonedSessions);
  const botConversionRate = totalChatbotConversations > 0
    ? (botAppointments.length / totalChatbotConversations) * 100
    : 0;
  const botResolutionRate = botAppointments.length > 0
    ? (botCompletedWithoutHuman / botAppointments.length) * 100
    : 0;

  // Desempenho por Especialidade
  const specialtySummaries: SpecialtySummary[] = specialties.map((spec, index) => {
    const specAppointments = filteredAppointments.filter(app => app.specialtyIndex === index);
    const specCompleted = specAppointments.filter(app => app.status === 'R');
    const baseCount = specAppointments.length || 1;

    const rated = specCompleted.filter(app => app.npsRating !== null);
    const proms = rated.filter(app => (app.npsRating ?? 0) >= 9).length;
    const dets = rated.filter(app => (app.npsRating ?? 0) <= 6).length;

    const rateByStatus = (status: string) =>
      (specAppointments.filter(app => app.status === status).length / baseCount) * 100;

    return {
      name: spec[0],
      totalAppointments: specAppointments.length,
      completedAppointments: specCompleted.length,
      cancellationRate: rateByStatus('C'),
      absenceRate: rateByStatus('C') + rateByStatus('N'),
      reschedulingRate: rateByStatus('M'),
      noShowRate: rateByStatus('N'),
      averageDelayMinutes: calculateAverage(specCompleted, app => app.delayMinutes),
      averageTicket: calculateAverage(specCompleted, app => app.priceCharged),
      totalRevenue: specCompleted.reduce((sum, app) => sum + app.priceCharged, 0),
      returnRate: specCompleted.length > 0
        ? (specCompleted.filter(app => app.isReturn).length / specCompleted.length) * 100
        : 0,
      npsScore: rated.length > 0 ? ((proms - dets) / rated.length) * 100 : 0,
      chatbotOriginRate: (specAppointments.filter(app => app.isChatbotOrigin).length / baseCount) * 100
    };
  }).filter(s => s.totalAppointments > 0);

  // Demografia: Faixas Etárias
  const ageDistribution = AGE_BRACKETS.map((_, idx) =>
    completedAppointments.filter(app => app.ageBracketIndex === idx).length
  );
  const maxAgeIndex = ageDistribution.indexOf(Math.max(...ageDistribution));
  const predominantAgeBracket = AGE_BRACKETS[maxAgeIndex] || '31–45';
  const predominantAgeShare = completedAppointments.length > 0
    ? (ageDistribution[maxAgeIndex] / completedAppointments.length) * 100
    : 0;

  const healthInsuranceShare = completedAppointments.length > 0
    ? (completedAppointments.filter(app => app.paymentModality === 'Convênio').length / completedAppointments.length) * 100
    : 0;

  // Liderança e Destaques
  const topSpecialtySummary = [...specialtySummaries].sort((a, b) => b.completedAppointments - a.completedAppointments)[0];
  const topSpecialty = topSpecialtySummary
    ? { name: topSpecialtySummary.name, completedCount: topSpecialtySummary.completedAppointments }
    : { name: '—', completedCount: 0 };

  const worstSpecialty = [...specialtySummaries].sort((a, b) => b.cancellationRate - a.cancellationRate)[0] || null;

  return {
    filteredAppointments,
    completedAppointments,
    specialtySummaries,
    ageDistribution,
    totalAppointments: filteredAppointments.length,
    totalCompleted: completedAppointments.length,
    canceledCount,
    noShowCount,
    rescheduledCount,
    totalCapacity,
    ratedEvaluationsCount: ratedAppointments.length,

    reschedulingRate: (rescheduledCount / totalAppointments) * 100,
    noShowRate: (noShowCount / totalAppointments) * 100,
    absenceRate: ((canceledCount + noShowCount) / totalAppointments) * 100,
    cancellationRate: (canceledCount / totalAppointments) * 100,
    occupancyRate,
    averageDelayMinutes: calculateAverage(completedAppointments, app => app.delayMinutes),

    topSpecialty,
    worstSpecialty,
    predominantAgeBracket,
    predominantAgeShare,
    healthInsuranceShare,
    netPromoterScore,
    averageTicket: calculateAverage(completedAppointments, app => app.priceCharged),
    returnRate: completedAppointments.length > 0
      ? (completedAppointments.filter(app => app.isReturn).length / completedAppointments.length) * 100
      : 0,

    botAppointmentsCount: botAppointments.length,
    botResolutionRate,
    botConversionRate,
    totalChatbotConversations,
    botCompletedWithoutHuman
  };
};
