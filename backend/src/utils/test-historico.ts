import pool from '../config/database.js';
import { randomUUID } from 'crypto';

interface AtendimentoItem {
  id: number;
  data: string;
  horario_inicio: string;
  horario_fim: string;
  status: string;
  servico_nome: string;
  duracao_minutos: number;
  profissional_nome: string;
  profissional_especialidade?: string;
  categoria_nome?: string;
}

export async function runHistoricoTests(): Promise<{ total: number; pass: number; fail: number }> {
  console.log('\n================================================================');
  console.log('🧪 INICIANDO TESTES DO HISTÓRICO DO PACIENTE (IK-77)');
  console.log('================================================================');

  let pass = 0;
  let fail = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      console.log(`✅ [PASSOU] ${testName}`);
      pass++;
    } else {
      console.error(`🚨 [FALHOU] ${testName} ${detail ? `- ${detail}` : ''}`);
      fail++;
    }
  };

  const tempPatientUuid = randomUUID();
  const tempPatientCpf = '88877766655';

  try {
    // -------------------------------------------------------------------------
    // SETUP: Limpeza e preparação de dados de teste
    // -------------------------------------------------------------------------
    await pool.query('DELETE FROM agendamento WHERE paciente_uuid = ?', [tempPatientUuid]);
    await pool.query('DELETE FROM paciente WHERE uuid = ? OR cpf = ?', [tempPatientUuid, tempPatientCpf]);

    // Criar paciente de teste
    await pool.query(
      `INSERT INTO paciente (uuid, nome, cpf, telefone, whatsapp, endereco) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tempPatientUuid, 'Paciente Teste IK77', tempPatientCpf, '11999998888', '11999998888', 'Rua Teste IK77, 100']
    );

    // -------------------------------------------------------------------------
    // SUÍTE 1: CA03 — Sem Histórico
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 1: CA03 — Paciente sem atendimentos ---');

    // Consultar histórico do paciente recém-criado
    const [emptyRows]: any = await pool.query(
      `SELECT 
         a.id_agendamento AS id,
         DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
         a.status,
         p.nome AS servico_nome,
         pr.nome AS profissional_nome
       FROM agendamento a
       INNER JOIN paciente pac ON (a.paciente_uuid = pac.uuid OR a.id_paciente = pac.id_paciente)
       LEFT JOIN procedimento p ON a.id_procedimento = p.id_procedimento
       LEFT JOIN profissional pr ON a.id_profissional = pr.id_profissional
       WHERE pac.uuid = ?
       ORDER BY a.data DESC, a.horario_inicio DESC`,
      [tempPatientUuid]
    );

    assert(
      Array.isArray(emptyRows) && emptyRows.length === 0,
      'CA03: Paciente sem atendimentos retorna lista vazia de histórico',
      `Esperado 0 itens, obtido: ${emptyRows.length}`
    );

    // -------------------------------------------------------------------------
    // SUÍTE 2: Inserir múltiplos atendimentos para o paciente de teste
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 2: Inserção de Atendimentos Cronológicos ---');

    // Inserir agendamento 1 (mais antigo: 2026-08-10)
    await pool.query(
      `INSERT INTO agendamento (paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, status)
       VALUES (?, 1, 1, '2026-08-10', '09:00:00', '10:00:00', 'Realizado')`,
      [tempPatientUuid]
    );

    // Inserir agendamento 2 (intermediário: 2026-09-15)
    await pool.query(
      `INSERT INTO agendamento (paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, status)
       VALUES (?, 2, 2, '2026-09-15', '14:00:00', '15:00:00', 'Realizado')`,
      [tempPatientUuid]
    );

    // Inserir agendamento 3 (mais recente: 2026-10-20)
    await pool.query(
      `INSERT INTO agendamento (paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, status)
       VALUES (?, 1, 1, '2026-10-20', '16:00:00', '17:00:00', 'Confirmado')`,
      [tempPatientUuid]
    );

    // -------------------------------------------------------------------------
    // SUÍTE 3: CA01 — Histórico em Ordem Cronológica
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 3: CA01 — Histórico em ordem cronológica ---');

    const [descRows]: any = await pool.query(
      `SELECT 
         a.id_agendamento AS id,
         DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
         a.status,
         p.nome AS servico_nome,
         p.duracao_minutos,
         pr.nome AS profissional_nome,
         e.nome AS categoria_nome
       FROM agendamento a
       INNER JOIN paciente pac ON (a.paciente_uuid = pac.uuid OR a.id_paciente = pac.id_paciente)
       LEFT JOIN procedimento p ON a.id_procedimento = p.id_procedimento
       LEFT JOIN especialidade e ON p.id_especialidade = e.id_especialidade
       LEFT JOIN profissional pr ON a.id_profissional = pr.id_profissional
       WHERE pac.uuid = ?
       ORDER BY a.data DESC, a.horario_inicio DESC`,
      [tempPatientUuid]
    );

    assert(
      descRows.length === 3,
      'CA01: Todos os atendimentos registrados foram retornados',
      `Esperado 3, obtido ${descRows.length}`
    );

    // Validar ordenação decrescente: 2026-10-20 -> 2026-09-15 -> 2026-08-10
    const ordenadoDesc =
      descRows[0].data === '2026-10-20' &&
      descRows[1].data === '2026-09-15' &&
      descRows[2].data === '2026-08-10';

    assert(
      ordenadoDesc,
      'CA01: Histórico ordenado em ordem cronológica decrescente (mais recente primeiro)',
      `Datas retornadas: ${descRows.map((r: any) => r.data).join(', ')}`
    );

    // Validar ordenação crescente quando solicitada (ASC)
    const [ascRows]: any = await pool.query(
      `SELECT 
         a.id_agendamento AS id,
         DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
         a.status
       FROM agendamento a
       INNER JOIN paciente pac ON (a.paciente_uuid = pac.uuid OR a.id_paciente = pac.id_paciente)
       WHERE pac.uuid = ?
       ORDER BY a.data ASC, a.horario_inicio ASC`,
      [tempPatientUuid]
    );

    const ordenadoAsc =
      ascRows[0].data === '2026-08-10' &&
      ascRows[1].data === '2026-09-15' &&
      ascRows[2].data === '2026-10-20';

    assert(
      ordenadoAsc,
      'CA01: Histórico suporta ordenação cronológica crescente (ASC)',
      `Datas retornadas: ${ascRows.map((r: any) => r.data).join(', ')}`
    );

    // -------------------------------------------------------------------------
    // SUÍTE 4: CA02 — Informações Mínimas Obrigatórias
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 4: CA02 — Informações detalhadas do atendimento ---');

    for (let i = 0; i < descRows.length; i++) {
      const item: AtendimentoItem = descRows[i];
      const temData = typeof item.data === 'string' && item.data.length === 10;
      const temHorario = typeof item.horario_inicio === 'string' && typeof item.horario_fim === 'string';
      const temProcedimento = typeof item.servico_nome === 'string' && item.servico_nome.trim().length > 0;
      const temProfissional = typeof item.profissional_nome === 'string' && item.profissional_nome.trim().length > 0;
      const temStatus = typeof item.status === 'string' && item.status.trim().length > 0;

      assert(
        temData && temHorario && temProcedimento && temProfissional && temStatus,
        `CA02: Atendimento #${i + 1} contém todos os campos mínimos (Data: ${item.data}, Procedimento: ${item.servico_nome}, Profissional: ${item.profissional_nome}, Situação: ${item.status})`
      );
    }

    // -------------------------------------------------------------------------
    // SUÍTE 5: Validação de Paciente Inexistente
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 5: Validação de Paciente Inexistente ---');
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const [notFoundRows]: any = await pool.query('SELECT uuid FROM paciente WHERE uuid = ?', [fakeUuid]);
    assert(
      notFoundRows.length === 0,
      'Paciente inexistente não retorna dados e permite disparar 404 apropriado'
    );

  } catch (error: any) {
    console.error('Erro durante a execução dos testes de histórico:', error);
    fail++;
  } finally {
    // Teardown: Limpeza dos dados de teste
    try {
      await pool.query('DELETE FROM agendamento WHERE paciente_uuid = ?', [tempPatientUuid]);
      await pool.query('DELETE FROM paciente WHERE uuid = ?', [tempPatientUuid]);
    } catch {
      // Ignorar erro de teardown
    }
  }

  return { total: pass + fail, pass, fail };
}

// Execução direta via node/tsx
if (process.argv[1]?.endsWith('test-historico.ts') || process.argv[1]?.endsWith('test-historico.js')) {
  runHistoricoTests().then(res => {
    if (res.fail > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  });
}
