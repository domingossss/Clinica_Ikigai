/**
 * Tipos permitidos de atendimento na Clínica Ikigai
 */
export type TipoAtendimento = 'Consulta' | 'Retorno' | 'Procedimento';

/**
 * Matriz de regras de dias de atendimento da clínica
 * Atendimentos permitidos apenas de Segunda a Sexta-feira.
 * Sábado e Domingo permanecem fechados.
 */
export const REGRAS_DIA_SEMANA: Record<number, TipoAtendimento[]> = {
  1: ['Consulta', 'Retorno', 'Procedimento'], // Segunda-feira
  2: ['Consulta', 'Retorno', 'Procedimento'], // Terça-feira
  3: ['Consulta', 'Retorno', 'Procedimento'], // Quarta-feira
  4: ['Consulta', 'Retorno', 'Procedimento'], // Quinta-feira
  5: ['Consulta', 'Retorno', 'Procedimento'], // Sexta-feira
  6: [],                                      // Sábado (Fechado)
  0: [],                                      // Domingo (Fechado)
};

export const HORARIO_EXPEDIENTE = {
  HORA_INICIO: '08:00',
  HORA_FIM: '18:00',
  MINUTOS_INICIO: 8 * 60,   // 480
  MINUTOS_FIM: 18 * 60,     // 1080
};

/**
 * Valida se um determinado agendamento respeita o dia de funcionamento:
 * Apenas Segunda a Sexta-feira (dias 1 a 5).
 * 
 * @param data Data do agendamento solicitado
 * @param tipo Tipo de atendimento ('Consulta', 'Retorno' ou 'Procedimento')
 * @returns boolean true se for de Segunda a Sexta, false para Sábado ou Domingo
 */
export function validarRegraAgendamento(data: Date, tipo?: string): boolean {
  if (!data || isNaN(data.getTime())) {
    return false;
  }

  // Se a data for meia-noite (00:00), ajustamos para meio-dia (12:00) para evitar
  // que o fuso horário America/Sao_Paulo (UTC-3) recue o dia da semana ao formatar.
  const dataAjustada = new Date(data.getTime());
  if (dataAjustada.getHours() === 0 && dataAjustada.getMinutes() === 0) {
    dataAjustada.setHours(12);
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short'
  });
  const weekdayShort = formatter.format(dataAjustada);

  const mapShortToDay: Record<string, number> = {
    'Sun': 0,
    'Mon': 1,
    'Tue': 2,
    'Wed': 3,
    'Thu': 4,
    'Fri': 5,
    'Sat': 6
  };

  const diaSemana = mapShortToDay[weekdayShort] ?? dataAjustada.getDay();

  // Apenas de Segunda a Sexta-feira (dias 1 a 5)
  if (diaSemana < 1 || diaSemana > 5) {
    return false;
  }

  return true;
}

/**
 * Valida se o horário de início e a duração da consulta respeitam a janela das 08:00 às 18:00.
 */
export function validarHorarioExpediente(horarioInicio: string, duracaoMinutos: number = 0): { valido: boolean; motivo?: string } {
  if (!horarioInicio) {
    return { valido: false, motivo: 'Horário de início não informado.' };
  }

  const [hStr, mStr] = horarioInicio.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  if (isNaN(h) || isNaN(m)) {
    return { valido: false, motivo: 'Formato de horário inválido.' };
  }

  const inicioMins = h * 60 + m;

  if (inicioMins < HORARIO_EXPEDIENTE.MINUTOS_INICIO) {
    return {
      valido: false,
      motivo: `Horário inválido: a clínica inicia os atendimentos às ${HORARIO_EXPEDIENTE.HORA_INICIO}.`
    };
  }

  if (inicioMins >= HORARIO_EXPEDIENTE.MINUTOS_FIM) {
    return {
      valido: false,
      motivo: `Horário inválido: os atendimentos encerram às ${HORARIO_EXPEDIENTE.HORA_FIM}.`
    };
  }

  if (duracaoMinutos > 0 && (inicioMins + duracaoMinutos > HORARIO_EXPEDIENTE.MINUTOS_FIM)) {
    return {
      valido: false,
      motivo: `Horário inválido: com a duração de ${duracaoMinutos} min, o atendimento ultrapassa o horário de encerramento das ${HORARIO_EXPEDIENTE.HORA_FIM}.`
    };
  }

  return { valido: true };
}

/**
 * Retorna o nome do dia da semana formatado em português.
 * Útil para logs e mensagens do WhatsApp.
 */
export function obterNomeDiaSemana(diaSemana: number): string {
  const dias = [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado'
  ];
  return dias[diaSemana] || 'Desconhecido';
}

/**
 * Converte string de horário "HH:MM" ou "HH:MM:SS" em minutos a partir da meia-noite
 */
export function converterHorarioParaMinutos(horario: string): number {
  const [h, m] = horario.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Converte minutos a partir da meia-noite em formato "HH:MM:00"
 */
export function converterMinutosParaHorario(minutos: number): string {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0');
  const m = (minutos % 60).toString().padStart(2, '0');
  return `${h}:${m}:00`;
}

/**
 * Verifica se dois intervalos de horário se sobrepõem (Overlap).
 * Ocorre conflito se: InicioA < FimB E InicioB < FimA
 */
export function verificarSobreposicao(inicioA: string, fimA: string, inicioB: string, fimB: string): boolean {
  const startA = converterHorarioParaMinutos(inicioA);
  const endA = converterHorarioParaMinutos(fimA);
  const startB = converterHorarioParaMinutos(inicioB);
  const endB = converterHorarioParaMinutos(fimB);

  return startA < endB && startB < endA;
}

/**
 * Calcula o horário de término com duração e buffer opcional (padrão 15 min de respiro operacional)
 */
export function calcularHorarioTermino(horarioInicio: string, duracaoMinutos: number, bufferMinutos: number = 15): string {
  const inicioMins = converterHorarioParaMinutos(horarioInicio);
  const fimMins = inicioMins + duracaoMinutos + bufferMinutos;
  return converterMinutosParaHorario(fimMins);
}

/**
 * Valida se um período de bloqueio é válido (dentro do expediente das 08h às 18h e início < término)
 */
export function validarPeriodoBloqueio(horarioInicio: string, horarioFim: string): { valido: boolean; motivo?: string } {
  if (!horarioInicio || !horarioFim) {
    return { valido: false, motivo: 'Horários de início e término são obrigatórios.' };
  }

  const iniMins = converterHorarioParaMinutos(horarioInicio);
  const fimMins = converterHorarioParaMinutos(horarioFim);

  if (iniMins >= fimMins) {
    return { valido: false, motivo: 'O horário de término deve ser posterior ao horário de início.' };
  }

  if (iniMins < HORARIO_EXPEDIENTE.MINUTOS_INICIO) {
    return { valido: false, motivo: `Horário de início não pode ser anterior a ${HORARIO_EXPEDIENTE.HORA_INICIO}.` };
  }

  if (fimMins > HORARIO_EXPEDIENTE.MINUTOS_FIM) {
    return { valido: false, motivo: `Horário de término não pode ultrapassar ${HORARIO_EXPEDIENTE.HORA_FIM}.` };
  }

  return { valido: true };
}
