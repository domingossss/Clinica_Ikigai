/* =====================================================================
 * CLÍNICA IKIGAI - UTILITÁRIOS DE DATAS E CALENDÁRIO
 * Arquivo: frontend/src/utils/dateUtils.ts
 * ===================================================================== */

export const AGE_BRACKETS = ['0–17', '18–30', '31–45', '46–60', '60+'] as const;

export const WEEKDAY_SHORT_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;

export const WEEKDAY_FULL_NAMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'] as const;

export const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
] as const;

export const MONTH_SEGMENTS = [
  'Início (dias 1–10)',
  'Meio (dias 11–20)',
  'Final (dia 21 em diante)'
] as const;

export const CLINIC_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

/** Retorna o dia da semana (0=Dom, 1=Seg... 6=Sáb) para um deslocamento em dias */
export const getDayOfWeekFromOffset = (dayOffset: number, baseDate = new Date()): number => {
  return new Date(baseDate.getTime() - dayOffset * 864e5).getDay();
};

/** Formata o nome completo do dia da semana (ex: "Segunda-feira" ou "Sábado") */
export const formatFullWeekday = (index: number): string => {
  const name = WEEKDAY_FULL_NAMES[index] || '';
  return index < 5 ? `${name}-feira` : name;
};

/** Calcula a capacidade nominal de atendimento da clínica entre dois dias */
export const calculateCapacity = (startDay: number, endDay: number, baseDate = new Date()): number => {
  let slots = 0;
  for (let d = startDay; d < endDay; d++) {
    const dow = getDayOfWeekFromOffset(d, baseDate);
    slots += (dow === 0 || dow === 6 ? 0 : 12); // Mesmo calendário operacional da agenda: segunda a sexta.
  }
  return slots;
};

/** Conta a ocorrência de cada dia da semana no intervalo de dias */
export const countDaysOfWeekInRange = (
  startDay: number,
  endDay: number,
  baseDate = new Date()
): Record<number, number> => {
  const counts: Record<number, number> = {};
  for (let d = startDay; d < endDay; d++) {
    const dow = getDayOfWeekFromOffset(d, baseDate);
    if (dow > 0) {
      counts[dow] = (counts[dow] || 0) + 1;
    }
  }
  return counts;
};
