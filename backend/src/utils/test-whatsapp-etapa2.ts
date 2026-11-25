import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  InMemoryWhatsAppClinicRepository,
  MySqlWhatsAppClinicRepository
} from '../services/whatsappClinicRepository.js';
import {
  SimulatedMessageProvider,
  WhatsAppSimulationService
} from '../services/whatsappSimulation.js';
import { MockAgendamento, MockBloqueio, MockPaciente, MockProfissional, MockServico } from './mock-store.js';

function criarStoreIsolado() {
  const hoje = '2026-11-24'; // Terça-feira
  const pacientes: MockPaciente[] = [
    {
      id: 'pac-uuid-1',
      nome_completo: 'Carlos Eduardo Souza',
      cpf: '123.456.789-01',
      telefone: '(11) 98888-7777',
      whatsapp: '(11) 98888-7777',
      etapa_tratamento: 'Em Tratamento'
    },
    {
      id: 'pac-uuid-2',
      nome_completo: 'Mariana Costa',
      cpf: '234.567.890-12',
      telefone: '(11) 97777-6666',
      whatsapp: '(11) 97777-6666',
      etapa_tratamento: 'Avaliação'
    },
    {
      id: 'pac-uuid-3',
      nome_completo: 'Roberto Santos',
      cpf: '345.678.901-23',
      telefone: '(11) 96666-5555',
      whatsapp: '(11) 96666-5555',
      etapa_tratamento: 'Retorno'
    }
  ];

  const profissionais: MockProfissional[] = [
    { id: 1, nome: 'Dr. Ulisses Higo', especialidade: 'Terapeuta Ortomolecular', ativo: 1 },
    { id: 2, nome: 'Dra. Samantha Ferreira', especialidade: 'Acupunturista e Massoterapeuta', ativo: 1 },
    { id: 3, nome: 'Dr. Inativo Teste', especialidade: 'Naturopata', ativo: 0 }
  ];

  const servicos: Array<MockServico & { ativo?: number }> = [
    {
      id: 1,
      categoria_id: 1,
      categoria_nome: 'Acupuntura',
      nome: 'Sessão de Acupuntura Sistêmica',
      preco: 220.0,
      duracao_minutos: 60,
      ativo: 1
    },
    {
      id: 2,
      categoria_id: 2,
      categoria_nome: 'Nutrição Integrativa',
      nome: 'Consulta Nutricional Integrativa Inicial',
      preco: 280.0,
      duracao_minutos: 60,
      ativo: 1
    },
    {
      id: 4,
      categoria_id: 4,
      categoria_nome: 'Massoterapia',
      nome: 'Massagem Miofascial / Terapêutica',
      preco: 180.0,
      duracao_minutos: 60,
      ativo: 1
    },
    {
      id: 99,
      categoria_id: 1,
      categoria_nome: 'Acupuntura',
      nome: 'Procedimento Inativo Teste',
      preco: 150.0,
      duracao_minutos: 45,
      ativo: 0
    }
  ];

  const profissionalProcedimentos = [
    { profissional_id: 1, procedimento_id: 1 },
    { profissional_id: 1, procedimento_id: 2 },
    { profissional_id: 2, procedimento_id: 1 },
    { profissional_id: 2, procedimento_id: 4 },
    { profissional_id: 3, procedimento_id: 99 }
  ];

  const agendamentos: MockAgendamento[] = [
    {
      id: 1,
      data: hoje,
      horario_inicio: '09:00',
      horario_fim: '10:15',
      status: 'Confirmado',
      paciente_id: pacientes[0].id,
      paciente_nome: pacientes[0].nome_completo,
      paciente_whatsapp: pacientes[0].whatsapp,
      profissional_id: 1,
      profissional_nome: 'Dr. Ulisses Higo',
      servico_id: 1,
      servico_nome: 'Sessão de Acupuntura Sistêmica',
      duracao_minutos: 60
    },
    {
      id: 3,
      data: hoje,
      horario_inicio: '14:00',
      horario_fim: '15:15',
      status: 'Agendado',
      paciente_id: pacientes[2].id,
      paciente_nome: pacientes[2].nome_completo,
      paciente_whatsapp: pacientes[2].whatsapp,
      profissional_id: 1,
      profissional_nome: 'Dr. Ulisses Higo',
      servico_id: 2,
      servico_nome: 'Consulta Nutricional Integrativa Inicial',
      duracao_minutos: 60
    }
  ];

  const bloqueios: MockBloqueio[] = [
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

  return {
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

test('Etapa 2: segurança na identificação por CPF, bloqueio de CPF de outro telefone, números compartilhados e limite de tentativas', async () => {
  const store = criarStoreIsolado();
  // Adicionar familiar compartilhando o mesmo WhatsApp de Carlos (5511988887777) com mesmo final 8901 para testar desambiguação
  store.pacientes.push({
    id: 'pac-uuid-familiar',
    nome_completo: 'Fernanda Souza',
    cpf: '987.654.890-1', // dígitos: 9876548901 -> vamos usar 11 dígitos terminando em 8901
    telefone: '(11) 98888-7777',
    whatsapp: '(11) 98888-7777',
    etapa_tratamento: 'Avaliação'
  });
  store.pacientes[3].cpf = '999.888.789-01';

  const repo = new InMemoryWhatsAppClinicRepository(store);
  const provider = new SimulatedMessageProvider();
  const clock = new Date('2026-11-24T08:00:00-03:00');
  const service = new WhatsAppSimulationService(provider, () => {}, {
    repository: repo,
    now: () => clock
  });

  // 1. Tentar usar CPF de Roberto Santos (34567890123) a partir do telefone de Mariana (5511977776666) -> Bloqueado!
  const step1 = await service.process({
    messageId: 'sec-1',
    phone: '5511977776666',
    text: '2',
    origin: 'baileys-local'
  });
  assert.equal(step1.step, 'AGUARDANDO_CPF');

  const spoofAttempt = await service.process({
    messageId: 'sec-2',
    phone: '5511977776666',
    text: '34567890123',
    origin: 'baileys-local'
  });
  assert.equal(spoofAttempt.authenticated, false);
  assert.equal(spoofAttempt.step, 'AGUARDANDO_CPF');
  assert.match(spoofAttempt.reply, /vinculado a outro número de contato/i);

  // 2. Mais duas tentativas inválidas reiniciam a sessão por segurança
  await service.process({
    messageId: 'sec-3',
    phone: '5511977776666',
    text: '0000',
    origin: 'baileys-local'
  });
  const lockout = await service.process({
    messageId: 'sec-4',
    phone: '5511977776666',
    text: '9999',
    origin: 'baileys-local'
  });
  assert.equal(lockout.step, 'MENU_PRINCIPAL');
  assert.match(lockout.reply, /após 3 tentativas/i);

  // 3. Número compartilhado entre Carlos e Fernanda (ambos terminam em 8901): exige CPF completo de 11 dígitos
  await service.process({
    messageId: 'shared-1',
    phone: '5511988887777',
    text: '2',
    origin: 'baileys-local'
  });
  const ambiguo = await service.process({
    messageId: 'shared-2',
    phone: '5511988887777',
    text: '8901',
    origin: 'baileys-local'
  });
  assert.equal(ambiguo.step, 'AGUARDANDO_CPF');
  assert.match(ambiguo.reply, /mais de um paciente vinculado[\s\S]*CPF completo/i);

  // Informando o CPF completo de Carlos (123.456.789-01), autentica exatamente Carlos
  const autenticadoCarlos = await service.process({
    messageId: 'shared-3',
    phone: '5511988887777',
    text: '123.456.789-01',
    origin: 'baileys-local'
  });
  assert.equal(autenticadoCarlos.authenticated, true);
  assert.match(autenticadoCarlos.reply, /Carlos Eduardo Souza/);
  assert.match(autenticadoCarlos.reply, /Protocolo \*#1\*/);
});

test('Etapa 2: Opção 2 (Consultar agendamento) e Opção 3 (Confirmar presença) com atualização de status e trilha de auditoria', async () => {
  const store = criarStoreIsolado();
  const repo = new InMemoryWhatsAppClinicRepository(store);
  const provider = new SimulatedMessageProvider();
  const clock = new Date('2026-11-24T08:00:00-03:00');
  const service = new WhatsAppSimulationService(provider, () => {}, {
    repository: repo,
    now: () => clock
  });

  const phoneRoberto = '5511966665555';

  // 1. Roberto escolhe Opção 2 (Consultar agendamento)
  const askCpf = await service.process({
    messageId: 'rob-1',
    phone: phoneRoberto,
    text: '2',
    origin: 'baileys-local'
  });
  assert.equal(askCpf.intent, 'consultar');
  assert.equal(askCpf.step, 'AGUARDANDO_CPF');

  // 2. Roberto informa os 4 últimos dígitos do CPF (0123)
  const consulta = await service.process({
    messageId: 'rob-2',
    phone: phoneRoberto,
    text: '0123',
    origin: 'baileys-local'
  });
  assert.equal(consulta.intent, 'consultar');
  assert.equal(consulta.authenticated, true);
  assert.equal(consulta.step, 'MENU_PRINCIPAL');
  assert.match(consulta.reply, /Roberto Santos/);
  assert.match(consulta.reply, /Protocolo \*#3\*/);
  assert.match(consulta.reply, /Consulta Nutricional Integrativa Inicial/);
  assert.match(consulta.reply, /Status: \*Agendado\*/);

  // 3. Roberto digita 3 (Confirmar presença) na mesma sessão (já autenticado!)
  const listaConfirmacao = await service.process({
    messageId: 'rob-3',
    phone: phoneRoberto,
    text: '3',
    origin: 'baileys-local'
  });
  assert.equal(listaConfirmacao.intent, 'confirmar');
  assert.equal(listaConfirmacao.step, 'AGUARDANDO_SELECAO_CONFIRMACAO');
  assert.match(listaConfirmacao.reply, /#3[\s\S]*14:00/);

  // 4. Roberto confirma o item 1
  const confirmado = await service.process({
    messageId: 'rob-4',
    phone: phoneRoberto,
    text: '1',
    origin: 'baileys-local'
  });
  assert.equal(confirmado.intent, 'confirmar');
  assert.equal(confirmado.step, 'MENU_PRINCIPAL');
  assert.equal(confirmado.agendamentoId, 3);
  assert.match(confirmado.reply, /Presença confirmada com sucesso/i);
  assert.match(confirmado.reply, /Status: \*Confirmado\*/);

  // Verificar atualização real na agenda e na trilha de auditoria
  const agendamento3 = store.agendamentos.find((a: MockAgendamento) => a.id === 3);
  assert.equal(agendamento3.status, 'Confirmado');
  assert.equal(repo.historicoStatus.length, 1);
  assert.deepEqual(repo.historicoStatus[0], {
    id_agendamento: 3,
    status_anterior: 'Agendado',
    status_novo: 'Confirmado',
    tipo_evento: 'STATUS',
    alterado_por: 'Paciente via WhatsApp',
    motivo: 'Presença confirmada pelo paciente via WhatsApp'
  });
  assert.equal(repo.comunicacoesRegistradas.length, 1);
  assert.equal(repo.comunicacoesRegistradas[0].id_agendamento, 3);
  assert.equal(repo.comunicacoesRegistradas[0].tipo, 'CONFIRMACAO');

  // 5. Se Roberto pedir opção 3 novamente, informa que já está confirmado
  const jaConfirmado = await service.process({
    messageId: 'rob-5',
    phone: phoneRoberto,
    text: '3',
    origin: 'baileys-local'
  });
  assert.equal(jaConfirmado.step, 'MENU_PRINCIPAL');
  assert.match(jaConfirmado.reply, /já consta como \*Confirmada\*/i);
});

test('Etapa 2: Opção 1 (Autoagendamento) respeita vínculos, duração + 15min de respiro, bloqueios, conflitos, exceções e grava auditoria', async () => {
  const store = criarStoreIsolado();
  const repo = new InMemoryWhatsAppClinicRepository(store);
  // Configurar feriado/exceção Fechado em 2026-11-25 (Quarta-feira) para validar bloqueio de data fechada
  repo.excecoesDisponibilidade.push({
    id: 1,
    data: '2026-11-25',
    id_profissional: null,
    tipo_excecao: 'Fechado',
    motivo: 'Recesso Clínico'
  });

  const provider = new SimulatedMessageProvider();
  const clock = new Date('2026-11-24T08:00:00-03:00'); // Terça-feira 24/11/2026
  const service = new WhatsAppSimulationService(provider, () => {}, {
    repository: repo,
    now: () => clock
  });

  const phoneMariana = '5511977776666';

  // 1. Mariana escolhe 1 - Agendar consulta
  const p1 = await service.process({
    messageId: 'ag-1',
    phone: phoneMariana,
    text: '1',
    origin: 'baileys-local'
  });
  assert.equal(p1.step, 'AGUARDANDO_CPF');

  // 2. Autentica com os 4 últimos dígitos do CPF (9012)
  const p2 = await service.process({
    messageId: 'ag-2',
    phone: phoneMariana,
    text: '9012',
    origin: 'baileys-local'
  });
  assert.equal(p2.step, 'AGUARDANDO_PROCEDIMENTO');
  assert.equal(p2.authenticated, true);
  // Procedimento inativo (#99) NÃO pode aparecer na lista
  assert.doesNotMatch(p2.reply, /Procedimento Inativo Teste/);
  assert.match(p2.reply, /1\* - Sessão de Acupuntura Sistêmica/);

  // 3. Escolhe procedimento 1 (Sessão de Acupuntura Sistêmica - 60 min)
  const p3 = await service.process({
    messageId: 'ag-3',
    phone: phoneMariana,
    text: '1',
    origin: 'baileys-local'
  });
  assert.equal(p3.step, 'AGUARDANDO_PROFISSIONAL');
  assert.match(p3.reply, /Dr\. Ulisses Higo/);
  assert.match(p3.reply, /Dra\. Samantha Ferreira/);

  // 4. Escolhe profissional 1 (Dr. Ulisses Higo)
  const p4 = await service.process({
    messageId: 'ag-4',
    phone: phoneMariana,
    text: '1',
    origin: 'baileys-local'
  });
  assert.equal(p4.step, 'AGUARDANDO_DATA');
  // 25/11/2026 está fechado por exceção, então a lista deve mostrar 24/11/2026 e pular 25/11/2026!
  assert.match(p4.reply, /24\/11\/2026/);
  assert.doesNotMatch(p4.reply, /25\/11\/2026/);

  // 5. Tentar digitar manualmente o dia fechado (25/11/2026) ou sábado (28/11/2026) deve ser recusado
  const tentativaFeriado = await service.process({
    messageId: 'ag-4-feriado',
    phone: phoneMariana,
    text: '25/11/2026',
    origin: 'baileys-local'
  });
  assert.equal(tentativaFeriado.step, 'AGUARDANDO_DATA');
  assert.match(tentativaFeriado.reply, /Não há horários disponíveis/i);

  const tentativaSabado = await service.process({
    messageId: 'ag-4-sabado',
    phone: phoneMariana,
    text: '28/11/2026',
    origin: 'baileys-local'
  });
  assert.equal(tentativaSabado.step, 'AGUARDANDO_DATA');
  assert.match(tentativaSabado.reply, /Não há horários disponíveis/i);

  // 6. Seleciona a opção 1 de data (24/11/2026)
  const p5 = await service.process({
    messageId: 'ag-5',
    phone: phoneMariana,
    text: '1',
    origin: 'baileys-local'
  });
  assert.equal(p5.step, 'AGUARDANDO_HORARIO');
  // Em 24/11/2026 para Dr. Ulisses:
  // - 09:00 às 10:15 está ocupado (agendamento #1) -> logo 08:00 (terminaria 09:15 com respiro), 08:30 (09:45), 09:00, 09:30, 10:00 estão indisponíveis!
  // - 10:30 (termina 11:45 com 60m + 15m de respiro, antes do almoço 12:00-13:00) -> DISPONÍVEL!
  // - 11:00 (terminaria 12:15, conflita com almoço/bloqueio 12:00-13:00) -> INDISPONÍVEL!
  // - 14:00 às 15:15 está ocupado (agendamento #3) -> 13:00 (terminaria 14:15) INDISPONÍVEL!
  // - 15:30 (termina 16:45) e 16:00 (termina 17:15) e 16:30 (termina 17:45) -> DISPONÍVEIS!
  // - 17:00 (60m + 15m = 18:15, passa das 18:00) -> INDISPONÍVEL!
  assert.match(p5.reply, /10:30/);
  assert.match(p5.reply, /15:30/);
  assert.doesNotMatch(p5.reply, /\s09:00/);
  assert.doesNotMatch(p5.reply, /\s11:00/);
  assert.doesNotMatch(p5.reply, /\s12:00/);
  assert.doesNotMatch(p5.reply, /\s14:00/);
  assert.doesNotMatch(p5.reply, /\s17:00/);

  // 7. Escolhe o horário 10:30 (opção 1)
  const p6 = await service.process({
    messageId: 'ag-6',
    phone: phoneMariana,
    text: '10:30',
    origin: 'baileys-local'
  });
  assert.equal(p6.step, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO');
  assert.match(p6.reply, /Confira o resumo do seu agendamento/);
  assert.match(p6.reply, /Mariana Costa/);
  assert.match(p6.reply, /10:30/);

  // 8. Confirma o agendamento enviando '1'
  const p7 = await service.process({
    messageId: 'ag-7',
    phone: phoneMariana,
    text: '1',
    origin: 'baileys-local'
  });
  assert.equal(p7.step, 'MENU_PRINCIPAL');
  assert.ok(p7.agendamentoId);
  assert.match(p7.reply, /Agendamento realizado com sucesso/i);
  assert.match(p7.reply, /Protocolo: \*#101\*/);

  // Verificar gravação na agenda, buffer de 15 min (10:30 -> 11:45), histórico e funil do chatbot
  const criado = store.agendamentos.find((a: MockAgendamento) => a.id === p7.agendamentoId);
  assert.ok(criado);
  assert.equal(criado.data, '2026-11-24');
  assert.equal(criado.horario_inicio, '10:30');
  assert.equal(criado.horario_fim, '11:45');
  assert.equal(criado.status, 'Agendado');
  assert.equal(criado.paciente_id, 'pac-uuid-2');
  assert.equal(repo.historicoStatus.some(h => h.id_agendamento === criado.id && h.tipo_evento === 'CRIACAO'), true);
  assert.equal(repo.sessoesChatbot.some(s => s.status_sessao === 'Agendamento_Concluido'), true);
});

test('Etapa 2: pré-cadastro rápido de novo paciente no fluxo de agendamento, expiração de sessão e transbordo humano', async () => {
  const store = criarStoreIsolado();
  const repo = new InMemoryWhatsAppClinicRepository(store, 30 * 60 * 1000);
  const provider = new SimulatedMessageProvider();
  let currentMs = new Date('2026-11-24T09:00:00-03:00').getTime();
  const service = new WhatsAppSimulationService(provider, () => {}, {
    repository: repo,
    now: () => new Date(currentMs)
  });

  const novoTelefone = '5511944443333';
  const cpfValidoNovo = '52998224725'; // CPF válido pelo algoritmo oficial

  // 1. Novo paciente escolhe 1 - Agendar consulta e informa CPF válido inédito
  await service.process({
    messageId: 'new-1',
    phone: novoTelefone,
    text: '1',
    origin: 'baileys-local'
  });
  const pedeNome = await service.process({
    messageId: 'new-2',
    phone: novoTelefone,
    text: cpfValidoNovo,
    origin: 'baileys-local'
  });
  assert.equal(pedeNome.step, 'AGUARDANDO_NOME_CADASTRO');
  assert.match(pedeNome.reply, /digite seu \*Nome Completo\*/i);

  // 2. Informa o Nome Completo -> cria paciente e já abre lista de procedimentos
  const posCadastro = await service.process({
    messageId: 'new-3',
    phone: novoTelefone,
    text: 'Beatriz Helena Vasconcelos',
    origin: 'baileys-local'
  });
  assert.equal(posCadastro.step, 'AGUARDANDO_PROCEDIMENTO');
  assert.equal(posCadastro.authenticated, true);
  assert.match(posCadastro.reply, /Pré-cadastro realizado com sucesso, \*Beatriz Helena Vasconcelos\*/);

  // 3. Avançar o relógio em 31 minutos (expiração de sessão conversacional)
  currentMs += 31 * 60 * 1000;
  const aposExpirar = await service.process({
    messageId: 'new-4',
    phone: novoTelefone,
    text: '2',
    origin: 'baileys-local'
  });
  // Sessão anterior expirou (e foi marcada como Abandonada), exigindo nova validação de CPF
  assert.equal(aposExpirar.step, 'AGUARDANDO_CPF');
  assert.equal(repo.sessoesChatbot[0].status_sessao, 'Abandonada');

  // 4. Solicitação de transbordo humano ("atendente") marca escalonado_humano = 1
  const transbordo = await service.process({
    messageId: 'new-5',
    phone: novoTelefone,
    text: 'atendente',
    origin: 'baileys-local'
  });
  assert.equal(transbordo.step, 'MENU_PRINCIPAL');
  assert.match(transbordo.reply, /atendimento humano registrada/i);
  assert.equal(repo.sessoesChatbot[1].escalonado_humano, 1);
});

test('Etapa 2: MySqlWhatsAppClinicRepository executa transações, locks FOR UPDATE e persistência durável no MySQL', async () => {
  const queriesExecutadas: Array<{ sql: string; params: unknown[] }> = [];
  let statusAgendamentoBanco = 'Agendado';
  let eventoProcessadoBanco: {
    message_id: string;
    conversation_id: string;
    origem: string;
    intencao: string;
    resposta: string;
    estado_envio: string;
    expira_em: string;
  } | null = null;

  const mockConnection = {
    async beginTransaction() {
      queriesExecutadas.push({ sql: 'BEGIN', params: [] });
    },
    async commit() {
      queriesExecutadas.push({ sql: 'COMMIT', params: [] });
    },
    async rollback() {
      queriesExecutadas.push({ sql: 'ROLLBACK', params: [] });
    },
    release() {},
    destroy() {},
    async query(sql: string, params: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queriesExecutadas.push({ sql: normalized, params });

      if (normalized.includes('SELECT id_profissional FROM profissional WHERE id_profissional = ? FOR UPDATE')) {
        return [[{ id_profissional: 1 }]];
      }
      if (normalized.includes('SELECT nome, ativo FROM profissional WHERE id_profissional = ?')) {
        return [[{ nome: 'Dr. Ulisses Higo', ativo: 1 }]];
      }
      if (normalized.includes('FROM procedimento WHERE id_procedimento = ? FOR SHARE')) {
        return [[{ nome: 'Sessão de Acupuntura Sistêmica', duracao_minutos: 60, preco: 220, ativo: 1 }]];
      }
      if (normalized.includes('FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?')) {
        return [[{ 1: 1 }]];
      }
      if (normalized.includes('FROM jornada_profissional')) {
        return [[{ ativo: 1, horario_inicio: '08:00', horario_fim: '18:00', intervalo_inicio: '12:00', intervalo_fim: '13:00' }]];
      }
      if (normalized.includes('FROM excecao_disponibilidade')) {
        return [[]];
      }
      if (normalized.includes('FROM expediente_clinica')) {
        return [[{ dia_semana: 2, ativo: 1, horario_inicio: '08:00', horario_fim: '18:00', intervalo_inicio: '12:00', intervalo_fim: '13:00' }]];
      }
      if (normalized.includes('SELECT id_agendamento FROM agendamento WHERE id_profissional = ?')) {
        return [[]];
      }
      if (normalized.includes('SELECT id_bloqueio FROM bloqueio_agenda')) {
        return [[]];
      }
      if (normalized.includes('SELECT id_paciente, uuid, nome, etapa_tratamento FROM paciente WHERE uuid = ? FOR UPDATE')) {
        return [[{ id_paciente: 1, uuid: 'uuid-pac-1', nome: 'Lucas Silveira Santos', etapa_tratamento: 'Retorno' }]];
      }
      if (normalized.includes('SELECT id_agendamento FROM agendamento WHERE paciente_uuid = ?')) {
        return [[]];
      }
      if (normalized.startsWith('INSERT INTO agendamento')) {
        return [{ insertId: 501, affectedRows: 1 }];
      }
      if (normalized.includes('FOR UPDATE') && normalized.includes('FROM agendamento a')) {
        return [[{
          id: 501,
          data: '2026-11-24',
          horario_inicio: '10:30',
          horario_fim: '11:45',
          ocorrencia: '2026-11-24 10:30:00',
          status: statusAgendamentoBanco,
          paciente_id: 'uuid-pac-1',
          paciente_nome: 'Lucas Silveira Santos',
          profissional_id: 1,
          profissional_nome: 'Dr. Ulisses Higo',
          servico_id: 1,
          servico_nome: 'Sessão de Acupuntura Sistêmica',
          duracao_minutos: 60
        }]];
      }
      if (normalized.includes('SELECT COALESCE(MAX(id_historico), 0) AS ultimo')) {
        return [[{ ultimo: 10 }]];
      }
      if (normalized.startsWith("UPDATE agendamento SET status = 'Confirmado'")) {
        statusAgendamentoBanco = 'Confirmado';
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes('SELECT id_historico FROM historico_status_agendamento')) {
        return [[{ id_historico: 11 }]];
      }
      if (normalized.includes('FROM comunicacao_agendamento')) {
        return [[{ ultima: 0 }]];
      }
      return [{ insertId: 1, affectedRows: 1 }];
    }
  };

  const mockPool = {
    async getConnection() {
      return mockConnection;
    },
    async query(sql: string, params: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queriesExecutadas.push({ sql: normalized, params });

      if (normalized.startsWith('SELECT message_id, conversation_id')) {
        return [eventoProcessadoBanco ? [eventoProcessadoBanco] : []];
      }
      if (normalized.startsWith('INSERT INTO whatsapp_evento_processado')) {
        eventoProcessadoBanco = {
          message_id: String(params[0]),
          conversation_id: String(params[1]),
          origem: String(params[2]),
          intencao: 'menu',
          resposta: '',
          estado_envio: 'PROCESSANDO',
          expira_em: String(params[3])
        };
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('UPDATE whatsapp_evento_processado SET intencao = ?')) {
        if (eventoProcessadoBanco) {
          eventoProcessadoBanco.intencao = String(params[0]);
          eventoProcessadoBanco.resposta = String(params[1]);
          eventoProcessadoBanco.estado_envio = 'ENVIADO';
          eventoProcessadoBanco.expira_em = String(params[2]);
        }
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes('SELECT id_profissional FROM agendamento WHERE id_agendamento = ?')) {
        return [[{ id_profissional: 1 }]];
      }
      return mockConnection.query(sql, params);
    }
  } as any;

  const mysqlRepo = new MySqlWhatsAppClinicRepository(mockPool);
  const nowMs = new Date('2026-11-24T10:00:00Z').getTime();

  // 1. Idempotência durável no MySQL
  const ev1 = await mysqlRepo.iniciarProcessamentoEvento('msg-sql-1', 'conv-1', 'baileys-local', nowMs);
  assert.equal(ev1.status, 'NOVO');
  await mysqlRepo.concluirProcessamentoEvento(
    {
      messageId: 'msg-sql-1',
      conversationId: 'conv-1',
      origin: 'baileys-local',
      intent: 'agendar',
      reply: 'Agendado',
      step: 'MENU_PRINCIPAL',
      statusEnvio: 'ENVIADO'
    },
    nowMs
  );
  const evDup = await mysqlRepo.iniciarProcessamentoEvento('msg-sql-1', 'conv-1', 'baileys-local', nowMs);
  assert.equal(evDup.status, 'DUPLICADO');

  // 2. Criação transacional de agendamento com bloqueio FOR UPDATE no profissional e no paciente
  const criado = await mysqlRepo.criarAgendamentoWhatsApp({
    pacienteUuid: 'uuid-pac-1',
    profissionalId: 1,
    procedimentoId: 1,
    data: '2026-11-24',
    horarioInicio: '10:30',
    idSessaoChatbot: 77
  });
  assert.equal(criado.id, 501);
  assert.equal(criado.horario_fim, '11:45');
  assert.equal(criado.origem, 'Chatbot');
  assert.ok(queriesExecutadas.some(q => q.sql.includes('SELECT id_profissional FROM profissional WHERE id_profissional = ? FOR UPDATE')));
  assert.ok(queriesExecutadas.some(q => q.sql.includes('INSERT INTO agendamento')));
  assert.ok(queriesExecutadas.some(q => q.sql.includes('INSERT INTO historico_status_agendamento')));

  // 3. Confirmação transacional de presença com auditoria em historico_status_agendamento e comunicacao_agendamento
  const conf = await mysqlRepo.confirmarPresencaWhatsApp({
    agendamentoId: 501,
    pacienteUuid: 'uuid-pac-1'
  });
  assert.equal(conf.statusAnterior, 'Agendado');
  assert.equal(conf.statusNovo, 'Confirmado');
  assert.equal(conf.jaEstavaConfirmado, false);
  assert.ok(queriesExecutadas.some(q => q.sql.includes("UPDATE agendamento SET status = 'Confirmado'")));
  assert.ok(queriesExecutadas.some(q => q.sql.includes('UPDATE historico_status_agendamento')));
  assert.ok(queriesExecutadas.some(q => q.sql.includes('INSERT INTO comunicacao_agendamento')));
});

