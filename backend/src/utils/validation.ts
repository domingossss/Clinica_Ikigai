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

/**
 * ============================================================================
 * REGRAS DE VINCULAÇÃO PROFISSIONAL X PROCEDIMENTO (IK-80)
 * ============================================================================
 */

export interface VinculoProfissionalProcedimento {
  id_profissional?: number;
  profissional_id?: number;
  id_procedimento?: number;
  procedimento_id?: number;
  servico_id?: number;
}

/**
 * CA01 & CA02: Valida se um profissional possui vínculo ativo para realizar o procedimento informado.
 */
export function validarVinculoProfissionalProcedimento(
  profissionalId: number,
  procedimentoId: number,
  vinculos: VinculoProfissionalProcedimento[]
): boolean {
  if (!profissionalId || !procedimentoId || !Array.isArray(vinculos)) {
    return false;
  }

  return vinculos.some(v => {
    const profId = v.id_profissional ?? v.profissional_id;
    const procId = v.id_procedimento ?? v.procedimento_id ?? v.servico_id;
    return Number(profId) === Number(profissionalId) && Number(procId) === Number(procedimentoId);
  });
}

/**
 * CA03: Filtra apenas profissionais elegíveis que realizam o procedimento selecionado.
 */
export function filtrarProfissionaisPorProcedimento<T extends { id: number }>(
  profissionais: T[],
  procedimentoId: number,
  vinculos: VinculoProfissionalProcedimento[]
): T[] {
  if (!procedimentoId || !Array.isArray(profissionais)) return [];
  return profissionais.filter(prof =>
    validarVinculoProfissionalProcedimento(prof.id, procedimentoId, vinculos)
  );
}

/**
 * Filtra apenas procedimentos que um determinado profissional está habilitado a realizar.
 */
export function filtrarProcedimentosPorProfissional<T extends { id: number }>(
  procedimentos: T[],
  profissionalId: number,
  vinculos: VinculoProfissionalProcedimento[]
): T[] {
  if (!profissionalId || !Array.isArray(procedimentos)) return [];
  return procedimentos.filter(proc =>
    validarVinculoProfissionalProcedimento(profissionalId, proc.id, vinculos)
  );
}

/**
 * ============================================================================
 * CONSULTA DE AGENDA DO PROFISSIONAL (IK-81)
 * ============================================================================
 */

export interface PeriodoAgenda {
  dataInicio: string;
  dataFim: string;
}

export interface ResumoAgendaProfissional {
  total: number;
  confirmados: number;
  agendados: number;
  concluidos: number;
  em_atendimento: number;
  recepcao: number;
  reagendados: number;
  bloqueios_total?: number;
}

/**
 * CA01 & CA03: Valida se um período de datas para consulta de agenda é válido.
 */
export function validarPeriodoAgenda(dataInicio: string, dataFim: string): { valido: boolean; motivo?: string } {
  if (!dataInicio || !dataFim) {
    return { valido: false, motivo: 'Data de início e data de fim são obrigatórias.' };
  }

  const regexData = /^\d{4}-\d{2}-\d{2}$/;
  if (!regexData.test(dataInicio) || !regexData.test(dataFim)) {
    return { valido: false, motivo: 'Formato de data inválido. Use YYYY-MM-DD.' };
  }

  const dInicio = new Date(dataInicio + 'T00:00:00');
  const dFim = new Date(dataFim + 'T00:00:00');

  if (isNaN(dInicio.getTime()) || isNaN(dFim.getTime())) {
    return { valido: false, motivo: 'Data inválida.' };
  }

  if (dInicio > dFim) {
    return { valido: false, motivo: 'A data inicial não pode ser posterior à data final.' };
  }

  return { valido: true };
}

/**
 * CA03: Calcula o intervalo da semana operacional (Segunda a Sexta) para uma data de referência.
 */
export function calcularIntervaloSemana(dataReferencia: string): PeriodoAgenda {
  const d = new Date(dataReferencia + 'T12:00:00');
  const day = d.getDay(); // 0: Dom, 1: Seg, ..., 5: Sex, 6: Sab

  // Distância até a segunda-feira
  // Se for domingo (0), segunda anterior é -6 dias; se sábado (6), -5 dias; caso contrário, 1 - day
  const diffSegunda = day === 0 ? -6 : (day === 6 ? -5 : 1 - day);
  const segunda = new Date(d);
  segunda.setDate(d.getDate() + diffSegunda);

  // Sexta-feira = segunda + 4 dias
  const sexta = new Date(segunda);
  sexta.setDate(segunda.getDate() + 6);

  const formatar = (dt: Date) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const dia = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${dia}`;
  };

  return {
    dataInicio: formatar(segunda),
    dataFim: formatar(sexta)
  };
}

/**
 * CA02: Calcula o resumo numérico de compromissos por status.
 */
export function calcularResumoAgenda(
  agendamentos: Array<{ status: string }>,
  bloqueiosTotal: number = 0
): ResumoAgendaProfissional {
  return {
    total: agendamentos.length,
    confirmados: agendamentos.filter(a => a.status === 'Confirmado').length,
    agendados: agendamentos.filter(a => a.status === 'Agendado').length,
    concluidos: agendamentos.filter(a => a.status === 'Concluído' || a.status === 'Realizado').length,
    em_atendimento: agendamentos.filter(a => a.status === 'Em Atendimento').length,
    recepcao: agendamentos.filter(a => a.status === 'Na Recepção').length,
    reagendados: agendamentos.filter(a => a.status === 'Reagendado').length,
    bloqueios_total: bloqueiosTotal
  };
}



/**
 * IK-14: Valida a configuração de jornada e intervalos do profissional (CA04)
 */
export function validarJornadaProfissional(
  horarioInicio: string,
  horarioFim: string,
  intervaloInicio?: string | null,
  intervaloFim?: string | null
): { valido: boolean; motivo?: string } {
  if (!horarioInicio || !horarioFim) {
    return { valido: false, motivo: 'Horário de início e término são obrigatórios.' };
  }

  if (![horarioInicio, horarioFim, intervaloInicio, intervaloFim].every(h => h == null || /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(h))) {
    return { valido: false, motivo: 'Horário inválido. Use HH:MM.' };
  }
  if (Boolean(intervaloInicio) !== Boolean(intervaloFim)) {
    return { valido: false, motivo: 'Informe os dois horários do intervalo.' };
  }
  const ini = converterHorarioParaMinutos(horarioInicio);
  const fim = converterHorarioParaMinutos(horarioFim);

  if (ini >= fim) {
    return { valido: false, motivo: 'O horário de início da jornada deve ser anterior ao horário de término.' };
  }

  if (intervaloInicio && intervaloFim) {
    const intIni = converterHorarioParaMinutos(intervaloInicio);
    const intFim = converterHorarioParaMinutos(intervaloFim);

    if (intIni >= intFim) {
      return { valido: false, motivo: 'O início do intervalo/almoço deve ser anterior ao término do intervalo.' };
    }

    if (intIni < ini || intFim > fim) {
      return { valido: false, motivo: 'O intervalo deve estar contido dentro do horário de jornada do profissional.' };
    }
  }

  return { valido: true };
}

/**
 * IK-83: Valida configuração de exceção de disponibilidade (CA04)
 */
export function validarExcecaoDisponibilidade(
  data: string,
  tipo: string,
  horarioInicio?: string | null,
  horarioFim?: string | null
): { valido: boolean; motivo?: string } {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return { valido: false, motivo: 'Formato de data inválido. Use YYYY-MM-DD.' };
  }

  const date = new Date(data + 'T12:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== data) return { valido: false, motivo: 'Data inexistente.' };
  if (!['Fechado', 'Horario_Especial'].includes(tipo)) return { valido: false, motivo: 'Tipo de exceção inválido.' };
  if (tipo === 'Horario_Especial') {
    if (!horarioInicio || !horarioFim) {
      return { valido: false, motivo: 'Horários de início e término são obrigatórios para exceção de Horário Especial.' };
    }
    const horarioValido = /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/;
    if (!horarioValido.test(horarioInicio) || !horarioValido.test(horarioFim)) return { valido: false, motivo: 'Horário especial inválido.' };
    const ini = converterHorarioParaMinutos(horarioInicio);
    const fim = converterHorarioParaMinutos(horarioFim);
    if (ini >= fim) {
      return { valido: false, motivo: 'O horário especial de início deve ser anterior ao término.' };
    }
  }

  return { valido: true };
}

// Uma única definição de expediente para consulta, gravação e indicadores.
export interface JornadaDia {
  ativo: number | boolean;
  horario_inicio: string;
  horario_fim: string;
  intervalo_inicio?: string | null;
  intervalo_fim?: string | null;
}
export interface ExcecaoDia {
  tipo_excecao: string;
  horario_inicio?: string | null;
  horario_fim?: string | null;
}
export type JanelaAgenda = [number, number];

export function resolverJanelasAgenda(data: string, jornada?: JornadaDia, excecao?: ExcecaoDia): JanelaAgenda[] {
  const dia = new Date(data + 'T12:00:00Z').getUTCDay();
  let ativo = jornada ? Boolean(jornada.ativo) : dia > 0 && dia < 6;
  let inicio = jornada?.horario_inicio || '08:00';
  let fim = jornada?.horario_fim || '18:00';
  if (excecao?.tipo_excecao === 'Fechado') return [];
  if (excecao?.tipo_excecao === 'Horario_Especial') {
    ativo = true;
    inicio = excecao.horario_inicio || '';
    fim = excecao.horario_fim || '';
  }
  if (!ativo || !inicio || !fim) return [];
  const ini = converterHorarioParaMinutos(inicio);
  const end = converterHorarioParaMinutos(fim);
  if (!Number.isFinite(ini) || !Number.isFinite(end) || ini >= end) return [];
  const intervaloInicio = jornada ? jornada.intervalo_inicio : '12:00';
  const intervaloFim = jornada ? jornada.intervalo_fim : '13:00';
  return subtrairIntervalos([[ini, end]], intervaloInicio && intervaloFim
    ? [[converterHorarioParaMinutos(intervaloInicio), converterHorarioParaMinutos(intervaloFim)]] : []);
}

// A subtração une bloqueios sobrepostos implicitamente, sem descontar minutos duas vezes.
export function subtrairIntervalos(janelas: JanelaAgenda[], bloqueios: JanelaAgenda[]): JanelaAgenda[] {
  let livres = janelas.map(([i, f]) => [i, f] as JanelaAgenda);
  for (const [inicio, fim] of bloqueios) {
    livres = livres.flatMap(([i, f]): JanelaAgenda[] => {
      if (fim <= i || inicio >= f) return [[i, f]];
      const partes: JanelaAgenda[] = [];
      if (inicio > i) partes.push([i, inicio]);
      if (fim < f) partes.push([fim, f]);
      return partes;
    });
  }
  return livres;
}

export function horarioCabeNasJanelas(inicio: string, fim: string, janelas: JanelaAgenda[]): boolean {
  const ini = converterHorarioParaMinutos(inicio);
  const end = converterHorarioParaMinutos(fim);
  return ini < end && janelas.some(([i, f]) => ini >= i && end <= f);
}
