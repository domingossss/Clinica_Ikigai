import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { ConnectionState, MessageUpsertType, WAMessage } from '@whiskeysockets/baileys';
import {
  formatarMensagemComunicacao,
  obterProvedor
} from '../services/provedorMensagens.js';
import {
  BaileysAuthStateBundle,
  BaileysSocketLike,
  WhatsAppBaileysConfig,
  WhatsAppBaileysConnector
} from '../services/whatsappBaileys.js';
import {
  InMemoryWhatsAppClinicRepository,
  MySqlWhatsAppClinicRepository
} from '../services/whatsappClinicRepository.js';
import {
  obterStatusConexaoWhatsApp,
  registrarConectorWhatsApp
} from '../services/whatsappRuntime.js';
import {
  MENU,
  SimulatedMessageProvider,
  WhatsAppSimulationService
} from '../services/whatsappSimulation.js';
import { MockAgendamento, MockBloqueio, MockPaciente, MockProfissional, MockServico } from './mock-store.js';

class MockBaileysSocket implements BaileysSocketLike {
  private readonly emitter = new EventEmitter();
  readonly sentMessages: Array<{ jid: string; text: string }> = [];
  shouldFailSend = false;
  private sentCounter = 0;

  readonly ev = {
    on: (event: string, listener: (...args: any[]) => void) => {
      this.emitter.on(event, listener);
    },
    removeAllListeners: (event?: string) => {
      this.emitter.removeAllListeners(event);
    }
  };

  async sendMessage(jid: string, content: { text: string }): Promise<WAMessage | undefined> {
    if (this.shouldFailSend) {
      throw new Error('simulated_send_error');
    }
    this.sentCounter += 1;
    this.sentMessages.push({ jid, text: content.text });
    return {
      key: {
        id: `wa-active-${this.sentCounter}`,
        remoteJid: jid,
        fromMe: true
      }
    } as WAMessage;
  }

  async end(): Promise<void> {}

  emitConnectionUpdate(update: Partial<ConnectionState>): void {
    this.emitter.emit('connection.update', update);
  }

  emitMessagesUpsert(messages: WAMessage[], type: MessageUpsertType = 'notify'): void {
    this.emitter.emit('messages.upsert', { messages, type });
  }
}

function criarStoreEtapa3() {
  const hoje = '2026-11-24'; // Terça-feira
  const pacientes: MockPaciente[] = [
    {
      id: 'pac-e3-1',
      nome_completo: 'Carlos Eduardo Souza',
      cpf: '123.456.789-01',
      telefone: '(11) 98888-7777',
      whatsapp: '(11) 98888-7777',
      etapa_tratamento: 'Em Tratamento'
    },
    {
      id: 'pac-e3-2',
      nome_completo: 'Roberto Santos',
      cpf: '345.678.901-23',
      telefone: '(11) 96666-5555',
      whatsapp: '(11) 96666-5555',
      etapa_tratamento: 'Retorno'
    }
  ];

  const profissionais: MockProfissional[] = [
    { id: 1, nome: 'Dr. Ulisses Higo', especialidade: 'Terapeuta Ortomolecular', ativo: 1 },
    { id: 2, nome: 'Dra. Samantha Ferreira', especialidade: 'Acupunturista', ativo: 1 }
  ];

  const servicos: Array<MockServico & { ativo?: number }> = [
    {
      id: 1,
      categoria_id: 1,
      categoria_nome: 'Acupuntura',
      nome: 'Sessão de Acupuntura Sistêmica',
      preco: 220,
      duracao_minutos: 60,
      ativo: 1
    },
    {
      id: 2,
      categoria_id: 2,
      categoria_nome: 'Nutrição Integrativa',
      nome: 'Consulta Nutricional Integrativa',
      preco: 280,
      duracao_minutos: 60,
      ativo: 1
    }
  ];

  const profissionalProcedimentos = [
    { profissional_id: 1, procedimento_id: 1 },
    { profissional_id: 1, procedimento_id: 2 },
    { profissional_id: 2, procedimento_id: 1 }
  ];

  const agendamentos: MockAgendamento[] = [
    {
      id: 10,
      data: '2026-11-25',
      horario_inicio: '09:00',
      horario_fim: '10:15',
      status: 'Agendado',
      paciente_id: 'pac-e3-1',
      paciente_nome: 'Carlos Eduardo Souza',
      paciente_whatsapp: '(11) 98888-7777',
      profissional_id: 1,
      profissional_nome: 'Dr. Ulisses Higo',
      servico_id: 1,
      servico_nome: 'Sessão de Acupuntura Sistêmica',
      duracao_minutos: 60
    },
    {
      id: 11,
      data: '2026-11-20',
      horario_inicio: '10:00',
      horario_fim: '11:15',
      status: 'Concluído',
      paciente_id: 'pac-e3-1',
      paciente_nome: 'Carlos Eduardo Souza',
      paciente_whatsapp: '(11) 98888-7777',
      profissional_id: 1,
      profissional_nome: 'Dr. Ulisses Higo',
      servico_id: 1,
      servico_nome: 'Sessão de Acupuntura Sistêmica',
      duracao_minutos: 60
    },
    {
      id: 12,
      data: '2026-11-25',
      horario_inicio: '14:00',
      horario_fim: '15:15',
      status: 'Agendado',
      paciente_id: 'pac-e3-2',
      paciente_nome: 'Roberto Santos',
      paciente_whatsapp: '(11) 96666-5555',
      profissional_id: 1,
      profissional_nome: 'Dr. Ulisses Higo',
      servico_id: 2,
      servico_nome: 'Consulta Nutricional Integrativa',
      duracao_minutos: 60
    },
    {
      id: 13,
      data: '2026-11-18',
      horario_inicio: '15:00',
      horario_fim: '16:15',
      status: 'Realizado',
      paciente_id: 'pac-e3-2',
      paciente_nome: 'Roberto Santos',
      paciente_whatsapp: '(11) 96666-5555',
      profissional_id: 1,
      profissional_nome: 'Dr. Ulisses Higo',
      servico_id: 2,
      servico_nome: 'Consulta Nutricional Integrativa',
      duracao_minutos: 60
    }
  ];

  const bloqueios: MockBloqueio[] = [
    {
      id: 1,
      profissional_id: 1,
      profissional_nome: 'Dr. Ulisses Higo',
      data: '2026-11-25',
      horario_inicio: '12:00',
      horario_fim: '13:00',
      motivo: 'Almoço'
    }
  ];

  return {
    hoje,
    profissionais,
    servicos,
    pacientes,
    agendamentos,
    bloqueios,
    profissionalProcedimentos,
    nextAgendamentoId: 100,
    nextBloqueioId: 50,
    verificarVinculo(profissionalId: number, procedimentoId: number) {
      return this.profissionalProcedimentos.some(
        (v: { profissional_id: number; procedimento_id: number }) =>
          v.profissional_id === Number(profissionalId) && v.procedimento_id === Number(procedimentoId)
      );
    }
  } as any;
}

test('Etapa 3: provedorMensagens conectado ao WhatsApp Baileys dispara lembretes ativos com segurança', async () => {
  const originalProvedor = process.env.COMUNICACAO_PROVEDOR;
  const socket = new MockBaileysSocket();
  const fakeAuth: BaileysAuthStateBundle = {
    state: { creds: { registered: true } as any, keys: {} as any },
    saveCreds: async () => {}
  };
  const config: WhatsAppBaileysConfig = {
    mode: 'baileys',
    enabled: true,
    sendEnabled: true,
    allowedNumbers: ['5511988887777'],
    sessionDir: 'C:\\temp\\non-existent-ikigai-e3-session',
    maxReconnectAttempts: 1,
    reconnectIntervalMs: 10,
    maxMessageAgeSeconds: 120,
    maxMessagesPerMinute: 10
  };

  const connector = new WhatsAppBaileysConnector(config, {
    authStateFactory: async () => fakeAuth,
    socketFactory: () => socket,
    log: () => {}
  });

  try {
    process.env.COMUNICACAO_PROVEDOR = 'whatsapp';
    const provedor = obterProvedor();
    assert.ok(provedor);
    assert.equal(provedor.nome, 'whatsapp');

    // Sem conector registrado -> não pronto
    registrarConectorWhatsApp(null);
    assert.equal(provedor.pronto?.(), false);
    const semConector = await provedor.enviar({
      id: 1,
      whatsapp: '11988887777',
      tipo: 'LEMBRETE',
      ocorrencia: '2026-11-25 09:00:00'
    });
    assert.equal(semConector.estado, 'FALHA');

    // Registra conector, inicia e conecta
    registrarConectorWhatsApp(connector);
    await connector.start();
    assert.equal(provedor.pronto?.(), false);

    socket.emitConnectionUpdate({ connection: 'open' });
    assert.equal(provedor.pronto?.(), true);
    assert.equal(obterStatusConexaoWhatsApp().status, 'connected');

    // Disparo ativo autorizado
    const textoEsperado = formatarMensagemComunicacao({
      id: 10,
      whatsapp: '11988887777',
      tipo: 'LEMBRETE',
      ocorrencia: '2026-11-25 09:00:00',
      agendamentoId: 10,
      pacienteNome: 'Carlos Eduardo Souza',
      profissionalNome: 'Dr. Ulisses Higo',
      procedimentoNome: 'Sessão de Acupuntura Sistêmica'
    });
    assert.match(textoEsperado, /Lembrete da \*Clínica IKIGAI\*/);
    assert.match(textoEsperado, /25\/11\/2026.*09:00/);
    assert.match(textoEsperado, /Responda \*SIM\*/);

    const envioOk = await provedor.enviar({
      id: 10,
      whatsapp: '11988887777',
      tipo: 'LEMBRETE',
      ocorrencia: '2026-11-25 09:00:00',
      agendamentoId: 10,
      pacienteNome: 'Carlos Eduardo Souza',
      profissionalNome: 'Dr. Ulisses Higo',
      procedimentoNome: 'Sessão de Acupuntura Sistêmica'
    });
    assert.equal(envioOk.estado, 'SUBMETIDA');
    assert.equal(envioOk.referencia, 'wa-active-1');
    assert.equal(socket.sentMessages.length, 1);
    assert.equal(socket.sentMessages[0].jid, '5511988887777@s.whatsapp.net');

    // Número não autorizado -> FALHA sem enviar
    const envioNaoAut = await provedor.enviar({
      id: 11,
      whatsapp: '5511999990000',
      tipo: 'CONFIRMACAO',
      ocorrencia: '2026-11-25 09:00:00'
    });
    assert.equal(envioNaoAut.estado, 'FALHA');
    assert.equal(socket.sentMessages.length, 1);

    // Erro de rede no socket -> INCERTA
    socket.shouldFailSend = true;
    const envioErro = await provedor.enviar({
      id: 12,
      whatsapp: '5511988887777',
      tipo: 'CONFIRMACAO',
      ocorrencia: '2026-11-25 09:00:00'
    });
    assert.equal(envioErro.estado, 'INCERTA');
  } finally {
    registrarConectorWhatsApp(null);
    await connector.stop();
    if (originalProvedor === undefined) delete process.env.COMUNICACAO_PROVEDOR;
    else process.env.COMUNICACAO_PROVEDOR = originalProvedor;
  }
});

test('Etapa 3: resposta ativa SIM ao lembrete confirma consulta e atualiza comunicação e histórico', async () => {
  const store = criarStoreEtapa3();
  const repo = new InMemoryWhatsAppClinicRepository(store);
  // Simula lembrete disparado previamente pela fila para o agendamento #10
  repo.comunicacoesRegistradas.push({
    id: 500,
    id_agendamento: 10,
    ocorrencia: '2026-11-25 09:00:00',
    tipo: 'LEMBRETE',
    canal: 'WHATSAPP',
    estado: 'SUBMETIDA',
    provedor: 'whatsapp'
  });

  const provider = new SimulatedMessageProvider();
  const clock = new Date('2026-11-24T10:00:00-03:00');
  const service = new WhatsAppSimulationService(provider, () => {}, {
    repository: repo,
    now: () => clock
  });

  const res = await service.process({
    messageId: 'lembrete-resp-1',
    phone: '5511988887777',
    text: 'SIM',
    origin: 'baileys-local'
  });

  assert.equal(res.intent, 'confirmar');
  assert.equal(res.agendamentoId, 10);
  assert.equal(res.step, 'MENU_PRINCIPAL');
  assert.match(res.reply, /presença foi confirmada com sucesso/i);
  assert.match(res.reply, /Protocolo: \*#10\*/);

  const ag10 = store.agendamentos.find((a: MockAgendamento) => a.id === 10);
  assert.equal(ag10.status, 'Confirmado');
  assert.equal(repo.comunicacoesRegistradas[0].estado, 'ENTREGUE');
  assert.equal(repo.historicoStatus.length, 1);
  assert.match(repo.historicoStatus[0].motivo, /resposta ao lembrete/i);
});

test('Etapa 3: Opção 4 (Reagendar consulta) aplica regras reais, buffer de 15 min, bloqueios e grava histórico REAGENDAMENTO', async () => {
  const store = criarStoreEtapa3();
  const repo = new InMemoryWhatsAppClinicRepository(store);
  const provider = new SimulatedMessageProvider();
  const clock = new Date('2026-11-24T10:00:00-03:00');
  const service = new WhatsAppSimulationService(provider, () => {}, {
    repository: repo,
    now: () => clock
  });

  assert.match(MENU, /4 - Reagendar consulta/);
  assert.match(MENU, /5 - Avaliar atendimento \(NPS\)/);

  const phone = '5511966665555'; // Roberto Santos (CPF final 0123), agendamento #12 em 2026-11-25 14:00

  // 1. Escolhe opção 4
  const p1 = await service.process({ messageId: 'reag-1', phone, text: '4', origin: 'baileys-local' });
  assert.equal(p1.intent, 'reagendar');
  assert.equal(p1.step, 'AGUARDANDO_CPF');

  // 2. Autentica com 4 dígitos finais do CPF
  const p2 = await service.process({ messageId: 'reag-2', phone, text: '0123', origin: 'baileys-local' });
  assert.equal(p2.step, 'AGUARDANDO_SELECAO_REAGENDAMENTO');
  assert.match(p2.reply, /#12.*25\/11\/2026.*14:00/);

  // 3. Seleciona o agendamento #12 (opção 1)
  const p3 = await service.process({ messageId: 'reag-3', phone, text: '1', origin: 'baileys-local' });
  assert.equal(p3.step, 'AGUARDANDO_DATA_REAGENDAMENTO');

  // 4. Escolhe a data 25/11/2026 (mesmo dia, para verificar que ignora o próprio agendamento e respeita conflito #10 das 09:00-10:15 e almoço 12:00-13:00)
  const p4 = await service.process({ messageId: 'reag-4', phone, text: '25/11/2026', origin: 'baileys-local' });
  assert.equal(p4.step, 'AGUARDANDO_HORARIO_REAGENDAMENTO');
  assert.match(p4.reply, /10:30/);
  assert.match(p4.reply, /15:30/);
  assert.doesNotMatch(p4.reply, /\s09:00/);
  assert.doesNotMatch(p4.reply, /\s12:00/);

  // 5. Escolhe novo horário 15:30
  const p5 = await service.process({ messageId: 'reag-5', phone, text: '15:30', origin: 'baileys-local' });
  assert.equal(p5.step, 'AGUARDANDO_CONFIRMACAO_REAGENDAMENTO');
  assert.match(p5.reply, /De: 25\/11\/2026.*14:00/);
  assert.match(p5.reply, /Para: \*25\/11\/2026.*15:30\*/);

  // 6. Confirma reagendamento
  const p6 = await service.process({ messageId: 'reag-6', phone, text: '1', origin: 'baileys-local' });
  assert.equal(p6.step, 'MENU_PRINCIPAL');
  assert.equal(p6.agendamentoId, 12);
  assert.match(p6.reply, /Consulta reagendada com sucesso/i);
  assert.match(p6.reply, /Status: \*Reagendado\*/);

  const ag12 = store.agendamentos.find((a: MockAgendamento) => a.id === 12);
  assert.equal(ag12.data, '2026-11-25');
  assert.equal(ag12.horario_inicio, '15:30');
  assert.equal(ag12.horario_fim, '16:45');
  assert.equal(ag12.status, 'Reagendado');
  assert.equal(repo.historicoStatus.some(h => h.id_agendamento === 12 && h.tipo_evento === 'REAGENDAMENTO'), true);
});

test('Etapa 3: Opção 5 (Pesquisa NPS 0-10) aceita nota 0 a 10, grava em avaliacao_atendimento e evita duplicidade', async () => {
  const store = criarStoreEtapa3();
  const repo = new InMemoryWhatsAppClinicRepository(store);
  const provider = new SimulatedMessageProvider();
  const clock = new Date('2026-11-24T10:00:00-03:00');
  const service = new WhatsAppSimulationService(provider, () => {}, {
    repository: repo,
    now: () => clock
  });

  // Fluxo 1: Carlos avalia atendimento #11 com nota 10 e comentário
  const phoneCarlos = '5511988887777';
  const a1 = await service.process({ messageId: 'nps-1', phone: phoneCarlos, text: '5', origin: 'baileys-local' });
  assert.equal(a1.intent, 'avaliar');
  assert.equal(a1.step, 'AGUARDANDO_CPF');

  const a2 = await service.process({ messageId: 'nps-2', phone: phoneCarlos, text: '8901', origin: 'baileys-local' });
  assert.equal(a2.step, 'AGUARDANDO_NOTA_NPS');
  assert.match(a2.reply, /Protocolo: \*#11\*/);

  // Nota fora do intervalo é rejeitada
  const invalida = await service.process({ messageId: 'nps-3', phone: phoneCarlos, text: '11', origin: 'baileys-local' });
  assert.equal(invalida.step, 'AGUARDANDO_NOTA_NPS');
  assert.match(invalida.reply, /Nota inválida/i);

  // Nota 10 válida
  const nota10 = await service.process({ messageId: 'nps-4', phone: phoneCarlos, text: '10', origin: 'baileys-local' });
  assert.equal(nota10.step, 'AGUARDANDO_COMENTARIO_NPS');

  // Comentário
  const fim1 = await service.process({
    messageId: 'nps-5',
    phone: phoneCarlos,
    text: 'Atendimento excelente e pontual!',
    origin: 'baileys-local'
  });
  assert.equal(fim1.step, 'MENU_PRINCIPAL');
  assert.equal(fim1.agendamentoId, 11);
  assert.match(fim1.reply, /Nota NPS: \*10\/10\*/);
  assert.equal(repo.avaliacoesNps.length, 1);
  assert.equal(repo.avaliacoesNps[0].id_agendamento, 11);
  assert.equal(repo.avaliacoesNps[0].nota_nps, 10);
  assert.equal(repo.avaliacoesNps[0].comentario, 'Atendimento excelente e pontual!');

  // Tentar avaliar novamente informa que não há atendimentos pendentes
  const rep = await service.process({ messageId: 'nps-6', phone: phoneCarlos, text: '5', origin: 'baileys-local' });
  assert.equal(rep.step, 'MENU_PRINCIPAL');
  assert.match(rep.reply, /Não encontramos atendimentos concluídos pendentes/i);

  // Fluxo 2: Roberto avalia atendimento #13 com nota 0 (deve ser aceita sem voltar ao menu!) e PULAR comentário
  const phoneRoberto = '5511966665555';
  await service.process({ messageId: 'nps-r1', phone: phoneRoberto, text: '5', origin: 'baileys-local' });
  const r2 = await service.process({ messageId: 'nps-r2', phone: phoneRoberto, text: '0123', origin: 'baileys-local' });
  assert.equal(r2.step, 'AGUARDANDO_NOTA_NPS');

  const notaZero = await service.process({ messageId: 'nps-r3', phone: phoneRoberto, text: '0', origin: 'baileys-local' });
  assert.equal(notaZero.step, 'AGUARDANDO_COMENTARIO_NPS');
  assert.match(notaZero.reply, /Nota \*0\/10\*/);

  const fimZero = await service.process({ messageId: 'nps-r4', phone: phoneRoberto, text: 'PULAR', origin: 'baileys-local' });
  assert.equal(fimZero.step, 'MENU_PRINCIPAL');
  assert.equal(repo.avaliacoesNps.length, 2);
  assert.equal(repo.avaliacoesNps[1].id_agendamento, 13);
  assert.equal(repo.avaliacoesNps[1].nota_nps, 0);
  assert.equal(repo.avaliacoesNps[1].comentario, null);
});

test('Etapa 3: MySqlWhatsAppClinicRepository executa reagendamento transacional e gravação NPS em avaliacao_atendimento', async () => {
  const queries: string[] = [];

  const mockConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    destroy() {},
    async query(sql: string) {
      const norm = sql.replace(/\s+/g, ' ').trim();
      queries.push(norm);
      if (norm.includes('SELECT id_profissional FROM profissional WHERE id_profissional = ? FOR UPDATE')) {
        return [[{ id_profissional: 1 }]];
      }
      if (norm.includes('FROM agendamento a INNER JOIN paciente p') && norm.includes('FOR UPDATE')) {
        return [[{
          id: 501,
          data: '2026-11-25',
          horario_inicio: '09:00',
          horario_fim: '10:15',
          status: 'Agendado',
          paciente_id: 'uuid-pac-1',
          paciente_nome: 'Lucas Silveira',
          profissional_id: 1,
          profissional_nome: 'Dr. Ulisses Higo',
          profissional_ativo: 1,
          servico_id: 1,
          servico_nome: 'Acupuntura',
          duracao_minutos: 60,
          procedimento_ativo: 1
        }]];
      }
      if (norm.includes('FROM profissional_procedimento')) return [[{ 1: 1 }]];
      if (norm.includes('FROM jornada_profissional')) {
        return [[{ ativo: 1, horario_inicio: '08:00', horario_fim: '18:00', intervalo_inicio: '12:00', intervalo_fim: '13:00' }]];
      }
      if (norm.includes('FROM excecao_disponibilidade')) return [[]];
      if (norm.includes('FROM expediente_clinica')) {
        return [[{ dia_semana: 3, ativo: 1, horario_inicio: '08:00', horario_fim: '18:00', intervalo_inicio: '12:00', intervalo_fim: '13:00' }]];
      }
      if (norm.includes('SELECT id_agendamento FROM agendamento')) return [[]];
      if (norm.includes('SELECT id_bloqueio FROM bloqueio_agenda')) return [[]];
      if (norm.includes('SELECT id_paciente FROM paciente')) return [[{ id_paciente: 1 }]];
      if (norm.includes('SELECT COALESCE(MAX(id_historico), 0)')) return [[{ ultimo: 20 }]];
      if (norm.includes('SELECT id_historico FROM historico_status_agendamento')) return [[{ id_historico: 21 }]];
      return [{ insertId: 90, affectedRows: 1 }];
    }
  };

  const mockPool = {
    async getConnection() {
      return mockConnection;
    },
    async query(sql: string) {
      const norm = sql.replace(/\s+/g, ' ').trim();
      queries.push(norm);
      if (norm.includes('SELECT id_profissional FROM agendamento WHERE id_agendamento = ?')) {
        return [[{ id_profissional: 1 }]];
      }
      if (norm.includes('FROM agendamento a INNER JOIN paciente p') && norm.includes('LIMIT 1')) {
        return [[{
          id: 501,
          data: '2026-11-20',
          horario_inicio: '09:00',
          horario_fim: '10:15',
          status: 'Concluído',
          paciente_id: 'uuid-pac-1',
          paciente_nome: 'Lucas Silveira',
          profissional_id: 1,
          profissional_nome: 'Dr. Ulisses Higo',
          servico_id: 1,
          servico_nome: 'Acupuntura',
          duracao_minutos: 60
        }]];
      }
      return [{ insertId: 90, affectedRows: 1 }];
    }
  } as any;

  const repo = new MySqlWhatsAppClinicRepository(mockPool);

  const reag = await repo.reagendarAgendamentoWhatsApp({
    agendamentoId: 501,
    pacienteUuid: 'uuid-pac-1',
    novaData: '2026-11-25',
    novoHorarioInicio: '14:00'
  });
  assert.equal(reag.agendamento.status, 'Reagendado');
  assert.equal(reag.agendamento.horario_fim, '15:15');
  assert.ok(queries.some(q => q.includes("status = 'Reagendado'")));
  assert.ok(queries.some(q => q.includes("tipo_evento = 'REAGENDAMENTO'")));

  const nps = await repo.registrarAvaliacaoNpsWhatsApp({
    agendamentoId: 501,
    pacienteUuid: 'uuid-pac-1',
    notaNps: 9,
    comentario: 'Muito bom'
  });
  assert.equal(nps.avaliacao.id_avaliacao, 90);
  assert.equal(nps.avaliacao.nota_nps, 9);
  assert.ok(queries.some(q => q.includes('INSERT INTO avaliacao_atendimento')));
});

