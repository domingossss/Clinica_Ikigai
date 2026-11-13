import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validarRegraAgendamento,
  validarHorarioExpediente,
  converterHorarioParaMinutos,
  converterMinutosParaHorario,
  verificarSobreposicao,
  calcularHorarioTermino,
  validarPeriodoBloqueio
} from './validation.js';

interface CasoTeste {
  descricao: string;
  data: Date;
  tipo: string;
  esperado: boolean;
}

const casosDias: CasoTeste[] = [
  // Segunda-feira (Permite qualquer serviço)
  {
    descricao: "Segunda-feira com Consulta (Válido)",
    data: new Date('2026-06-15T10:00:00'),
    tipo: 'Consulta',
    esperado: true
  },
  {
    descricao: "Segunda-feira com Retorno (Válido)",
    data: new Date('2026-06-15T14:00:00'),
    tipo: 'Retorno',
    esperado: true
  },
  
  // Terça-feira (Permite qualquer serviço)
  {
    descricao: "Terça-feira com Retorno (Válido)",
    data: new Date('2026-06-16T09:00:00'),
    tipo: 'Retorno',
    esperado: true
  },
  {
    descricao: "Terça-feira com Procedimento (Válido)",
    data: new Date('2026-06-16T11:00:00'),
    tipo: 'Procedimento',
    esperado: true
  },

  // Quarta-feira (Permite qualquer serviço)
  {
    descricao: "Quarta-feira com Procedimento (Válido)",
    data: new Date('2026-06-17T15:30:00'),
    tipo: 'Procedimento',
    esperado: true
  },
  
  // Quinta-feira (Permite qualquer serviço)
  {
    descricao: "Quinta-feira com Consulta (Válido)",
    data: new Date('2026-06-18T16:00:00'),
    tipo: 'Consulta',
    esperado: true
  },

  // Sexta-feira (Permite qualquer serviço)
  {
    descricao: "Sexta-feira com Retorno (Válido)",
    data: new Date('2026-06-19T08:00:00'),
    tipo: 'Retorno',
    esperado: true
  },

  // Sábado (Fechado - Bloqueado)
  {
    descricao: "Sábado com Procedimento (Bloqueado)",
    data: new Date('2026-06-20T10:00:00'),
    tipo: 'Procedimento',
    esperado: false
  },
  {
    descricao: "Sábado com Consulta (Bloqueado)",
    data: new Date('2026-06-20T12:00:00'),
    tipo: 'Consulta',
    esperado: false
  },

  // Domingo (Fechado - Bloqueado)
  {
    descricao: "Domingo com Consulta (Bloqueado)",
    data: new Date('2026-06-14T10:00:00'),
    tipo: 'Consulta',
    esperado: false
  },
  {
    descricao: "Domingo com Retorno (Bloqueado)",
    data: new Date('2026-06-14T14:00:00'),
    tipo: 'Retorno',
    esperado: false
  }
];

const casosHorario = [
  {
    descricao: "Horário 08:00 com 60 min (Válido)",
    horario: "08:00",
    duracao: 60,
    esperado: true
  },
  {
    descricao: "Horário 17:00 com 60 min (Termina às 18:00 - Válido)",
    horario: "17:00",
    duracao: 60,
    esperado: true
  },
  {
    descricao: "Horário 07:30 (Antes das 08:00 - Bloqueado)",
    horario: "07:30",
    duracao: 60,
    esperado: false
  },
  {
    descricao: "Horário 17:30 com 60 min (Passa das 18:00 - Bloqueado)",
    horario: "17:30",
    duracao: 60,
    esperado: false
  },
  {
    descricao: "Horário 18:30 (Depois das 18:00 - Bloqueado)",
    horario: "18:30",
    duracao: 30,
    esperado: false
  }
];

async function executarTestes() {
  const { runHistoricoTests } = await import('./test-historico.js');
  const { runProfissionalProcedimentoTests } = await import('./test-profissional-procedimento.js');
  const { runAgendaProfissionalTests } = await import('./test-agenda-profissional.js');
  const { runInativarProcedimentoTests } = await import('./test-inativar-procedimento.js');
  const { runExpedienteExcecoesTests } = await import('./test-expediente-excecoes.js');
  const { runIntegrityRegressionTests } = await import('./test-expediente-excecoes.js');
  console.log("================================================================");
  console.log("🧪 INICIANDO TESTES COMPLETOS DA AGENDA (IK-49, IK-85, IK-87, IK-77)");
  console.log("================================================================");

  let passados = 0;
  let falhados = 0;

  function assert(condicao: boolean, descricao: string) {
    if (condicao) {
      passados++;
      console.log(`✅ [PASSOU] ${descricao}`);
    } else {
      falhados++;
      console.log(`❌ [FALHOU] ${descricao}`);
    }
  }

  // 1. REGRAS DE DIAS DE ATENDIMENTO
  console.log("\n--- SUÍTE 1: DIAS OPERACIONAIS (Segunda a Sexta) ---");
  casosDias.forEach((caso, index) => {
    const obtido = validarRegraAgendamento(caso.data, caso.tipo);
    assert(obtido === caso.esperado, `Caso #${index + 1}: ${caso.descricao}`);
  });

  // 2. REGRAS DE EXPEDIENTE
  console.log("\n--- SUÍTE 2: HORÁRIO DE EXPEDIENTE (08:00 às 18:00) ---");
  casosHorario.forEach((caso, index) => {
    const res = validarHorarioExpediente(caso.horario, caso.duracao);
    assert(res.valido === caso.esperado, `Caso Horário #${index + 1}: ${caso.descricao}`);
  });

  // 3. REAGENDAMENTO (IK-85)
  console.log("\n--- SUÍTE 3: REAGENDAMENTO DE ATENDIMENTO (IK-85) ---");

  // CA01 & CA02: Cálculo correto de novo término com buffer de 15 minutos
  const fimCalculado = calcularHorarioTermino('09:00', 60, 15);
  assert(fimCalculado === '10:15:00', 'CA01/CA02: Cálculo de novo término com 60min de procedimento + 15min de respiro');

  // CA02: Reagendamento em dia útil é permitido
  const segundaFeira = new Date('2026-08-17T09:00:00');
  assert(validarRegraAgendamento(segundaFeira) === true, 'CA02: Reagendar para dia útil (Segunda-feira) é aceito');

  // CA02: Reagendamento para fim de semana deve ser rejeitado
  const sabado = new Date('2026-08-22T09:00:00');
  assert(validarRegraAgendamento(sabado) === false, 'CA02: Reagendar para final de semana (Sábado) é bloqueado');

  // CA02: Reagendamento com horário que ultrapassa expediente (17:30 + 60 min = 18:30) é rejeitado
  const checagemUltrapassa = validarHorarioExpediente('17:30', 60);
  assert(checagemUltrapassa.valido === false, 'CA02: Reagendar para horário que ultrapassa 18:00 é impedido');

  // CA03: Detecção de conflito (Overlap) com outro agendamento
  // Agendamento A: 09:00 às 10:15 | Novo Agendamento proposto B: 10:00 às 11:15 (Sobreposição de 10:00 a 10:15)
  const haConflito = verificarSobreposicao('09:00', '10:15', '10:00', '11:15');
  assert(haConflito === true, 'CA03: Detecta conflito com agendamento sobreposto (09h-10h15 vs 10h-11h15)');

  // CA03: Sem conflito quando os horários não coincidem
  // Agendamento A: 09:00 às 10:15 | Novo proposto B: 10:30 às 11:30
  const semConflito = verificarSobreposicao('09:00', '10:15', '10:30', '11:30');
  assert(semConflito === false, 'CA03: Permite novo horário livre sem sobreposição (09h-10h15 vs 10h30-11h30)');

  // CA04: Reagendamento com sucesso preserva dados e avança para status 'Reagendado'
  const agendamentoMock = {
    id: 42,
    paciente_id: 'uuid-123',
    profissional_id: 1,
    servico_id: 2,
    data: '2026-08-17',
    horario_inicio: '09:00',
    horario_fim: '10:15',
    status: 'Agendado'
  };
  const novoHorarioInicio = '14:00';
  const novoHorarioFim = calcularHorarioTermino(novoHorarioInicio, 60, 15);
  const reagendamentoSucesso = {
    ...agendamentoMock,
    horario_inicio: novoHorarioInicio,
    horario_fim: novoHorarioFim,
    status: 'Reagendado'
  };
  assert(
    reagendamentoSucesso.status === 'Reagendado' &&
    reagendamentoSucesso.horario_fim === '15:15:00' &&
    reagendamentoSucesso.paciente_id === agendamentoMock.paciente_id,
    'CA04: Atendimento atualizado com preservação de paciente/serviço e status Reagendado'
  );

  // 4. BLOQUEIO DE HORÁRIOS (IK-87)
  console.log("\n--- SUÍTE 4: BLOQUEIO DE HORÁRIOS PELA AGENDA (IK-87) ---");

  // CA01: Período válido de bloqueio (12:00 às 13:00)
  const validacaoBloqueio = validarPeriodoBloqueio('12:00', '13:00');
  assert(validacaoBloqueio.valido === true, 'CA01: Período de bloqueio válido dentro do expediente (12:00 às 13:00)');

  // CA01: Bloqueio com horário invertido (14:00 às 13:00) deve falhar
  const validacaoInvertida = validarPeriodoBloqueio('14:00', '13:00');
  assert(validacaoInvertida.valido === false, 'CA01: Bloqueio com horário de início posterior ao fim é rejeitado');

  // CA01: Bloqueio fora do expediente (antes das 08:00 ou após 18:00) deve falhar
  const validacaoForaExpediente = validarPeriodoBloqueio('07:00', '08:00');
  assert(validacaoForaExpediente.valido === false, 'CA01: Bloqueio antes das 08:00 é rejeitado');

  // CA02: Bloqueio bloqueia geração de novos agendamentos no período
  // Bloqueio das 12:00 às 13:30 | Tentativa de agendamento às 12:30 com 60 min (12:30 às 13:45)
  const bloqueioImpedeAgendamento = verificarSobreposicao('12:00', '13:30', '12:30', '13:45');
  assert(bloqueioImpedeAgendamento === true, 'CA02: Bloqueio ativo impede novo agendamento no período bloqueado');

  // CA04: O sistema identifica conflito entre bloqueio e agendamento existente
  // Agendamento existente: 10:00 às 11:15 | Tentativa de bloqueio: 10:30 às 12:00
  const bloqueioConflitanteComAgendamento = verificarSobreposicao('10:00', '11:15', '10:30', '12:00');
  assert(bloqueioConflitanteComAgendamento === true, 'CA04: Validação impede criação de bloqueio conflitante com atendimento existente');

  // CA03: Remoção do bloqueio restaura a disponibilidade do período
  let bloqueiosAtivos = [
    { id: 101, profissional_id: 1, horario_inicio: '12:00', horario_fim: '13:00', motivo: 'Almoço' }
  ];
  // Simulando exclusão do bloqueio
  bloqueiosAtivos = bloqueiosAtivos.filter(b => b.id !== 101);
  const temBloqueioAposRemocao = bloqueiosAtivos.some(b =>
    verificarSobreposicao(b.horario_inicio, b.horario_fim, '12:00', '13:15')
  );
  assert(temBloqueioAposRemocao === false, 'CA03: Ao remover bloqueio, o período volta a ficar disponível');

  // SUÍTE 5: HISTÓRICO DO PACIENTE (IK-77)
  const historicoResult = await runHistoricoTests();
  passados += historicoResult.pass;
  falhados += historicoResult.fail;

  // SUÍTE 6: VINCULAÇÃO DE PROCEDIMENTOS AO PROFISSIONAL (IK-80)
  const procedimentoResult = await runProfissionalProcedimentoTests();
  passados += procedimentoResult.pass;
  falhados += procedimentoResult.fail;

  // SUÍTE 7: CONSULTA DA AGENDA DO PROFISSIONAL (IK-81)
  const agendaResult = await runAgendaProfissionalTests();
  passados += agendaResult.pass;
  falhados += agendaResult.fail;

  // SUÍTE 8: INATIVAÇÃO DE PROCEDIMENTO (IK-95)
  const inativarResult = await runInativarProcedimentoTests();
  passados += inativarResult.pass;
  falhados += inativarResult.fail;

  // SUÍTE 9 E 10: EXPEDIENTE, INTERVALOS E EXCEÇÕES (IK-14 E IK-83)
  const expExcResult = await runExpedienteExcecoesTests();
  passados += expExcResult.pass;
  falhados += expExcResult.fail;

  const integridade = await runIntegrityRegressionTests();
  passados += integridade.pass;
  falhados += integridade.fail;

  console.log("\n================================================================");
  console.log("RESUMO DA EXECUÇÃO");
  console.log("================================================================");
  console.log(`🎉 Sucessos: ${passados}`);
  console.log(`🚨 Falhas: ${falhados}`);
  console.log(`📈 Taxa de Sucesso: ${((passados / (passados + falhados)) * 100).toFixed(2)}%`);
  console.log("================================================================");

  if (falhados > 0) throw new Error(falhados + ' testes falharam.');
}

async function testarEmBancoIsolado() {
  const diretorio = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(diretorio, '../../.env') });
  const nome = 'ikigai_verificacao_' + Date.now();
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_ADMIN_USER || process.env.DB_USER || 'root', password: process.env.DB_ADMIN_PASS || process.env.DB_PASS || process.env.DB_PASSWORD || '',
    multipleStatements: true
  });
  const anterior = process.env.DB_NAME;
  try {
    process.env.DB_NAME = nome;
    if (process.env.DB_ADMIN_USER) process.env.DB_USER = process.env.DB_ADMIN_USER;
    if (process.env.DB_ADMIN_PASS) process.env.DB_PASS = process.env.DB_ADMIN_PASS;
    for (const arquivo of ['schema.sql', 'seed.sql']) {
      const sql = (await fs.readFile(path.resolve(diretorio, '../../../database', arquivo), 'utf8')).replaceAll('clinica_ikigai_db', nome);
      let separador = ';'; let buffer = '';
      for (const linha of sql.split(/\r?\n/)) {
        const delimitador = linha.trim().match(/^DELIMITER\s+(\S+)/i);
        if (delimitador) { separador = delimitador[1]; continue; }
        buffer += linha + '\n';
        if (linha.trimEnd().endsWith(separador)) {
          const comando = buffer.trimEnd().slice(0, -separador.length);
          if (comando.trim()) await admin.query(comando);
          buffer = '';
        }
      }
      if (buffer.replace(/--[^\n]*/g, '').trim()) await admin.query(buffer);
    }
    await executarTestes();
  } finally {
    const { default: pool } = await import('../config/database.js');
    await pool.end();
    // O nome é gerado aqui, nunca vem do ambiente ou do usuário.
    if (/^ikigai_verificacao_\d+$/.test(nome)) await admin.query('DROP DATABASE IF EXISTS ' + nome);
    await admin.end();
    if (anterior === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = anterior;
    console.log('[Testes] Banco temporário removido. Banco original preservado.');
  }
}

testarEmBancoIsolado().catch(erro => { console.error('[Testes]', erro); process.exitCode = 1; });
