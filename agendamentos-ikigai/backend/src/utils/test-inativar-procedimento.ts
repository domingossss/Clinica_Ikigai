import pool from '../config/database.js';

export async function runInativarProcedimentoTests() {
  console.log("\n================================================================");
  console.log("🧪 INICIANDO TESTES DE INATIVAÇÃO DE PROCEDIMENTO (IK-95)");
  console.log("================================================================");

  let pass = 0;
  let fail = 0;

  function assert(cond: boolean, desc: string) {
    if (cond) {
      console.log(`✅ [PASSOU] ${desc}`);
      pass++;
    } else {
      console.error(`🚨 [FALHOU] ${desc}`);
      fail++;
    }
  }

  try {
    // Preparação: Criar um procedimento temporário de teste
    const [catRows]: any = await pool.query('SELECT id FROM categorias LIMIT 1');
    const catId = catRows[0]?.id || 1;

    const [insertResult]: any = await pool.query(
      'INSERT INTO procedimento (id_especialidade, nome, duracao_minutos, preco, ativo) VALUES (?, ?, ?, ?, 1)',
      [catId, 'Procedimento Teste IK-95 ' + Date.now(), 60, 150.00]
    );
    const procId = insertResult.insertId;

    // Criar um agendamento com esse procedimento para testar preservação de histórico
    const [profRows]: any = await pool.query('SELECT id FROM profissionais LIMIT 1');
    const profId = profRows[0]?.id || 1;
    const [pacRows]: any = await pool.query('SELECT id_paciente, uuid FROM paciente LIMIT 1');
    const pacId = pacRows[0]?.id_paciente || 1;
    const pacUuid = pacRows[0]?.uuid || 'uuid-test-95';

    const [agResult]: any = await pool.query(
      `INSERT INTO agendamento (id_paciente, paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, status)
       VALUES (?, ?, ?, ?, '2026-11-20', '10:00:00', '11:00:00', 'Confirmado')`,
      [pacId, pacUuid, profId, procId]
    );
    const agId = agResult.insertId;

    // --- TESTE 1: Inativação não exclui fisicamente o registro (Soft Delete) ---
    await pool.query('UPDATE procedimento SET ativo = 0 WHERE id_procedimento = ?', [procId]);
    const [procCheck]: any = await pool.query('SELECT id_procedimento, ativo FROM procedimento WHERE id_procedimento = ?', [procId]);
    assert(procCheck.length === 1 && procCheck[0].ativo === 0, 'CA01/CA04: Procedimento inativado mantém registro no banco com ativo = 0');

    // --- TESTE 2: Histórico e agendamento antigo continuam íntegros e vinculados ---
    const [agCheck]: any = await pool.query(
      `SELECT a.id_agendamento, a.status, p.nome as procedimento_nome 
       FROM agendamento a 
       JOIN procedimento p ON a.id_procedimento = p.id_procedimento 
       WHERE a.id_agendamento = ?`,
      [agId]
    );
    assert(
      agCheck.length === 1 && agCheck[0].procedimento_nome.includes('Procedimento Teste IK-95'),
      'CA03: Agendamentos e históricos existentes continuam referenciando corretamente o procedimento inativado'
    );

    // --- TESTE 3: View servicos e filtro de ativos excluem o inativo ---
    const [servAtivos]: any = await pool.query('SELECT id FROM servicos WHERE (ativo = 1 OR ativo IS NULL) AND id = ?', [procId]);
    assert(servAtivos.length === 0, 'CA02: Procedimento inativo não aparece na lista de procedimentos disponíveis');

    // --- TESTE 4: Reativação do procedimento funciona perfeitamente ---
    await pool.query('UPDATE procedimento SET ativo = 1 WHERE id_procedimento = ?', [procId]);
    const [servReativado]: any = await pool.query('SELECT id, ativo FROM servicos WHERE id = ?', [procId]);
    assert(servReativado.length === 1 && servReativado[0].ativo === 1, 'CA01: Reativação do procedimento restaura status ativo com sucesso');

    // Limpeza dos dados temporários de teste
    await pool.query('DELETE FROM agendamento WHERE id_agendamento = ?', [agId]);
    await pool.query('DELETE FROM procedimento WHERE id_procedimento = ?', [procId]);

  } catch (error) {
    console.error('Erro durante execução dos testes de IK-95:', error);
    fail++;
  }

  return { pass, fail };
}
