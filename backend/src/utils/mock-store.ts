import {
  validarRegraAgendamento,
  validarHorarioExpediente,
  calcularHorarioTermino,
  verificarSobreposicao,
  validarPeriodoBloqueio
} from './validation.js';

function dataHoje(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface MockProfissional {
  id: number;
  nome: string;
  especialidade: string;
  ativo: number;
}

export interface MockServico {
  id: number;
  categoria_id: number;
  categoria_nome: string;
  nome: string;
  preco: number;
  duracao_minutos: number;
}

export interface MockPaciente {
  id: string;
  nome_completo: string;
  cpf: string;
  telefone: string;
  whatsapp: string;
  etapa_tratamento: string;
}

export interface MockAgendamento {
  id: number;
  data: string;
  horario_inicio: string;
  horario_fim: string;
  status: string;
  paciente_id: string;
  paciente_nome: string;
  paciente_whatsapp: string;
  profissional_id: number;
  profissional_nome: string;
  servico_id: number;
  servico_nome: string;
  duracao_minutos: number;
}

export interface MockBloqueio {
  id: number;
  profissional_id: number;
  profissional_nome: string;
  data: string;
  horario_inicio: string;
  horario_fim: string;
  motivo: string;
}

class InMemoryStore {
  profissionais: MockProfissional[] = [
    { id: 1, nome: 'Dr. Ulisses Higo', especialidade: 'Terapeuta Ortomolecular', ativo: 1 },
    { id: 2, nome: 'Dra. Samantha Ferreira', especialidade: 'Acupunturista e Massoterapeuta', ativo: 1 }
  ];

  categorias = [
    { id: 1, nome: 'Acupuntura' },
    { id: 2, nome: 'Nutrição Integrativa' },
    { id: 3, nome: 'Psicoterapia Integrativa' },
    { id: 4, nome: 'Massoterapia' }
  ];

  servicos: MockServico[] = [
    { id: 1, categoria_id: 1, categoria_nome: 'Acupuntura', nome: 'Sessão de Acupuntura Sistêmica', preco: 220.00, duracao_minutos: 60 },
    { id: 2, categoria_id: 2, categoria_nome: 'Nutrição Integrativa', nome: 'Consulta Nutricional Integrativa Inicial', preco: 280.00, duracao_minutos: 60 },
    { id: 3, categoria_id: 3, categoria_nome: 'Psicoterapia Integrativa', nome: 'Sessão de Psicoterapia Integrativa', preco: 250.00, duracao_minutos: 50 },
    { id: 4, categoria_id: 4, categoria_nome: 'Massoterapia', nome: 'Massagem Miofascial / Terapêutica', preco: 180.00, duracao_minutos: 60 },
    { id: 5, categoria_id: 5, categoria_nome: 'Fitoterapia', nome: 'Consulta Fitoterápica com Prescrição', preco: 200.00, duracao_minutos: 45 },
    { id: 6, categoria_id: 6, categoria_nome: 'Naturopatia', nome: 'Avaliação e Conduta Naturopática', preco: 300.00, duracao_minutos: 60 }
  ];

  pacientes: MockPaciente[] = [
    { id: 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d01', nome_completo: 'Carlos Eduardo Souza', cpf: '123.456.789-01', telefone: '(11) 98888-7777', whatsapp: '(11) 98888-7777', etapa_tratamento: 'Em Tratamento' },
    { id: 'd2b1d8c5-3c7e-5f2b-9d0f-6a7b8c9d0e12', nome_completo: 'Mariana Costa', cpf: '234.567.890-12', telefone: '(11) 97777-6666', whatsapp: '(11) 97777-6666', etapa_tratamento: 'Avaliação' },
    { id: 'e3c2e9d6-4d8f-6a3c-0e1a-7b8c9d0e1f23', nome_completo: 'Roberto Santos', cpf: '345.678.901-23', telefone: '(11) 96666-5555', whatsapp: '(11) 96666-5555', etapa_tratamento: 'Retorno' }
  ];

  agendamentos: MockAgendamento[] = [];
  bloqueios: MockBloqueio[] = [];
  profissionalProcedimentos: Array<{ profissional_id: number; procedimento_id: number }> = [
    { profissional_id: 1, procedimento_id: 1 },
    { profissional_id: 1, procedimento_id: 2 },
    { profissional_id: 2, procedimento_id: 1 },
    { profissional_id: 2, procedimento_id: 4 }
  ];
  nextAgendamentoId = 100;
  nextBloqueioId = 50;

  constructor() {
    const hoje = dataHoje();
    // Agendamentos iniciais para teste imediato
    this.agendamentos = [
      {
        id: 1,
        data: hoje,
        horario_inicio: '09:00',
        horario_fim: '10:15',
        status: 'Confirmado',
        paciente_id: this.pacientes[0].id,
        paciente_nome: this.pacientes[0].nome_completo,
        paciente_whatsapp: this.pacientes[0].whatsapp,
        profissional_id: 1,
        profissional_nome: 'Dr. Ulisses Higo',
        servico_id: 1,
        servico_nome: 'Sessão de Acupuntura Sistêmica',
        duracao_minutos: 60
      },
      {
        id: 2,
        data: hoje,
        horario_inicio: '10:30',
        horario_fim: '11:45',
        status: 'Na Recepção',
        paciente_id: this.pacientes[1].id,
        paciente_nome: this.pacientes[1].nome_completo,
        paciente_whatsapp: this.pacientes[1].whatsapp,
        profissional_id: 2,
        profissional_nome: 'Dra. Samantha Ferreira',
        servico_id: 4,
        servico_nome: 'Massagem Miofascial / Terapêutica',
        duracao_minutos: 60
      },
      {
        id: 3,
        data: hoje,
        horario_inicio: '14:00',
        horario_fim: '15:15',
        status: 'Agendado',
        paciente_id: this.pacientes[2].id,
        paciente_nome: this.pacientes[2].nome_completo,
        paciente_whatsapp: this.pacientes[2].whatsapp,
        profissional_id: 1,
        profissional_nome: 'Dr. Ulisses Higo',
        servico_id: 2,
        servico_nome: 'Consulta Nutricional Integrativa Inicial',
        duracao_minutos: 60
      }
    ];

    // Bloqueio inicial para teste imediato
    this.bloqueios = [
      {
        id: 1,
        profissional_id: 1,
        profissional_nome: 'Dr. Ulisses Higo',
        data: hoje,
        horario_inicio: '12:00',
        horario_fim: '13:00',
        motivo: 'Almoço / Intervalo'
      }
    ];
  }

  getAgendamentosDia(data: string) {
    return this.agendamentos.filter(a => a.data === data && a.status !== 'Cancelado');
  }

  getBloqueios(data?: string, profissional_id?: number) {
    return this.bloqueios.filter(b => {
      if (data && b.data !== data) return false;
      if (profissional_id && b.profissional_id !== Number(profissional_id)) return false;
      return true;
    });
  }

  reagendarAgendamento(id: number, data: string, horario_inicio: string, _motivo?: string) {
    const ag = this.agendamentos.find(a => a.id === Number(id));
    if (!ag) {
      throw new Error('Agendamento não encontrado.');
    }
    if (ag.status === 'Cancelado') {
      throw new Error('Atendimentos cancelados não podem ser reagendados.');
    }

    const dataObj = new Date(data + 'T00:00:00');
    if (!validarRegraAgendamento(dataObj)) {
      throw new Error('Reagendamento bloqueado: a clínica não atende aos finais de semana.');
    }

    const checagem = validarHorarioExpediente(horario_inicio, ag.duracao_minutos);
    if (!checagem.valido) {
      throw new Error(checagem.motivo || 'Horário fora do expediente.');
    }

    const horario_fim = calcularHorarioTermino(horario_inicio, ag.duracao_minutos, 15).substring(0, 5);

    // Conflito com agendamentos
    const conflitoAg = this.agendamentos.find(other =>
      other.id !== ag.id &&
      other.profissional_id === ag.profissional_id &&
      other.data === data &&
      other.status !== 'Cancelado' &&
      verificarSobreposicao(horario_inicio, horario_fim, other.horario_inicio, other.horario_fim)
    );
    if (conflitoAg) {
      throw new Error(`Conflito de agenda: coincide com agendamento #${conflitoAg.id} (${conflitoAg.paciente_nome}).`);
    }

    // Conflito com bloqueios
    const conflitoBl = this.bloqueios.find(bl =>
      bl.profissional_id === ag.profissional_id &&
      bl.data === data &&
      verificarSobreposicao(horario_inicio, horario_fim, bl.horario_inicio, bl.horario_fim)
    );
    if (conflitoBl) {
      throw new Error(`Conflito de agenda: o período coincide com um bloqueio (${conflitoBl.motivo}).`);
    }

    ag.data = data;
    ag.horario_inicio = horario_inicio;
    ag.horario_fim = horario_fim;
    ag.status = 'Reagendado';

    return ag;
  }

  criarBloqueio(profissional_id: number, data: string, horario_inicio: string, horario_fim: string, motivo: string) {
    const dataObj = new Date(data + 'T00:00:00');
    if (!validarRegraAgendamento(dataObj)) {
      throw new Error('Bloqueio desnecessário: a clínica já permanece fechada aos finais de semana.');
    }

    const validacao = validarPeriodoBloqueio(horario_inicio, horario_fim);
    if (!validacao.valido) {
      throw new Error(validacao.motivo || 'Período de bloqueio inválido.');
    }

    const prof = this.profissionais.find(p => p.id === Number(profissional_id));
    if (!prof) {
      throw new Error('Profissional não cadastrado.');
    }

    // Conflito com agendamentos existentes (CA04)
    const agConflitante = this.agendamentos.find(ag =>
      ag.profissional_id === Number(profissional_id) &&
      ag.data === data &&
      ag.status !== 'Cancelado' &&
      verificarSobreposicao(horario_inicio, horario_fim, ag.horario_inicio, ag.horario_fim)
    );
    if (agConflitante) {
      throw new Error(`Conflito detectado: já existe o agendamento #${agConflitante.id} (${agConflitante.paciente_nome}, das ${agConflitante.horario_inicio} às ${agConflitante.horario_fim}) neste período.`);
    }

    // Conflito com outro bloqueio
    const blConflitante = this.bloqueios.find(bl =>
      bl.profissional_id === Number(profissional_id) &&
      bl.data === data &&
      verificarSobreposicao(horario_inicio, horario_fim, bl.horario_inicio, bl.horario_fim)
    );
    if (blConflitante) {
      throw new Error('Já existe um bloqueio cadastrado para este profissional neste período.');
    }

    const novoBloqueio: MockBloqueio = {
      id: ++this.nextBloqueioId,
      profissional_id: Number(profissional_id),
      profissional_nome: prof.nome,
      data,
      horario_inicio,
      horario_fim,
      motivo: motivo || 'Horário Bloqueado'
    };

    this.bloqueios.push(novoBloqueio);
    return novoBloqueio;
  }

  removerBloqueio(id: number) {
    const idx = this.bloqueios.findIndex(b => b.id === Number(id));
    if (idx === -1) {
      throw new Error('Bloqueio não encontrado.');
    }
    this.bloqueios.splice(idx, 1);
    return true;
  }

  // ==========================================================================
  // MÉTODOS DE VINCULAÇÃO PROFISSIONAL X PROCEDIMENTO (IK-80)
  // ==========================================================================

  vincularProcedimentosAoProfissional(profissionalId: number, procedimentoIds: number[]) {
    const prof = this.profissionais.find(p => p.id === Number(profissionalId));
    if (!prof) {
      throw new Error('Profissional não cadastrado.');
    }

    // Validar procedimentos
    for (const procId of procedimentoIds) {
      const existe = this.servicos.some(s => s.id === Number(procId));
      if (!existe) {
        throw new Error(`Procedimento #${procId} não cadastrado.`);
      }
    }

    // Remove vínculos anteriores
    this.profissionalProcedimentos = this.profissionalProcedimentos.filter(
      v => v.profissional_id !== Number(profissionalId)
    );

    // Insere novos vínculos
    for (const procId of procedimentoIds) {
      this.profissionalProcedimentos.push({
        profissional_id: Number(profissionalId),
        procedimento_id: Number(procId)
      });
    }

    return this.obterProcedimentosDoProfissional(profissionalId);
  }

  obterProcedimentosDoProfissional(profissionalId: number) {
    const prof = this.profissionais.find(p => p.id === Number(profissionalId));
    if (!prof) {
      throw new Error('Profissional não cadastrado.');
    }

    const vinculos = this.profissionalProcedimentos.filter(
      v => v.profissional_id === Number(profissionalId)
    );
    const procIds = new Set(vinculos.map(v => v.procedimento_id));

    return this.servicos.map(s => ({
      ...s,
      vinculado: procIds.has(s.id)
    }));
  }

  obterProfissionaisPorProcedimento(procedimentoId: number) {
    const proc = this.servicos.find(s => s.id === Number(procedimentoId));
    if (!proc) {
      throw new Error('Procedimento não cadastrado.');
    }

    const profIds = new Set(
      this.profissionalProcedimentos
        .filter(v => v.procedimento_id === Number(procedimentoId))
        .map(v => v.profissional_id)
    );

    return this.profissionais.filter(p => p.ativo === 1 && profIds.has(p.id));
  }

  verificarVinculo(profissionalId: number, procedimentoId: number): boolean {
    return this.profissionalProcedimentos.some(
      v => v.profissional_id === Number(profissionalId) && v.procedimento_id === Number(procedimentoId)
    );
  }

  // ==========================================================================
  // CONSULTA DE AGENDA DO PROFISSIONAL (IK-81)
  // ==========================================================================

  getAgendaProfissional(profissionalId: number, dataInicio: string, dataFim?: string) {
    const prof = this.profissionais.find(p => p.id === Number(profissionalId));
    if (!prof) {
      throw new Error('Profissional não cadastrado.');
    }

    const fim = dataFim || dataInicio;

    const ags = this.agendamentos
      .filter(a =>
        a.profissional_id === Number(profissionalId) &&
        a.data >= dataInicio &&
        a.data <= fim &&
        a.status !== 'Cancelado'
      )
      .sort((a, b) => `${a.data} ${a.horario_inicio}`.localeCompare(`${b.data} ${b.horario_inicio}`));

    const bls = this.bloqueios
      .filter(b =>
        b.profissional_id === Number(profissionalId) &&
        b.data >= dataInicio &&
        b.data <= fim
      )
      .sort((a, b) => `${a.data} ${a.horario_inicio}`.localeCompare(`${b.data} ${b.horario_inicio}`));

    return {
      profissional: prof,
      periodo: {
        data_inicio: dataInicio,
        data_fim: fim,
        tipo: dataInicio === fim ? 'dia' : 'periodo'
      },
      dados: ags,
      bloqueios: bls,
      resumo: {
        total: ags.length,
        confirmados: ags.filter(a => a.status === 'Confirmado').length,
        agendados: ags.filter(a => a.status === 'Agendado').length,
        concluidos: ags.filter(a => a.status === 'Concluído' || a.status === 'Realizado').length,
        em_atendimento: ags.filter(a => a.status === 'Em Atendimento').length,
        recepcao: ags.filter(a => a.status === 'Na Recepção').length,
        reagendados: ags.filter(a => a.status === 'Reagendado').length,
        bloqueios_total: bls.length
      }
    };
  }
}

export const mockStore = new InMemoryStore();

