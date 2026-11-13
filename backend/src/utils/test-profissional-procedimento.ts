import pool from '../config/database.js';
import express from 'express';
import http from 'http';
import router from '../routes/agendamentos.js';
import {
  validarVinculoProfissionalProcedimento,
  filtrarProfissionaisPorProcedimento,
  filtrarProcedimentosPorProfissional
} from './validation.js';
import { mockStore } from './mock-store.js';

export async function runProfissionalProcedimentoTests(): Promise<{ total: number; pass: number; fail: number }> {
  console.log('\n================================================================');
  console.log('🧪 INICIANDO TESTES DE VINCULAÇÃO DE PROCEDIMENTOS (IK-80)');
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

  // Inicializa servidor HTTP de teste em porta aleatória
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  try {
    // -------------------------------------------------------------------------
    // SUÍTE 1: TESTES UNITÁRIOS DE REGRAS E MOCK STORE
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 1: Funções de Validação e Mock Store ---');

    const vinculosTeste = [
      { profissional_id: 1, procedimento_id: 10 },
      { profissional_id: 1, procedimento_id: 20 },
      { profissional_id: 2, procedimento_id: 20 }
    ];

    assert(
      validarVinculoProfissionalProcedimento(1, 10, vinculosTeste) === true,
      'Unitário: Profissional #1 vinculado ao Procedimento #10 retorna true'
    );
    assert(
      validarVinculoProfissionalProcedimento(1, 99, vinculosTeste) === false,
      'Unitário: Profissional #1 não vinculado ao Procedimento #99 retorna false'
    );
    assert(
      validarVinculoProfissionalProcedimento(2, 10, vinculosTeste) === false,
      'Unitário: Profissional #2 não vinculado ao Procedimento #10 retorna false'
    );

    const profsMock = [
      { id: 1, nome: 'Dr. Teste 1' },
      { id: 2, nome: 'Dr. Teste 2' },
      { id: 3, nome: 'Dr. Teste 3' }
    ];

    const elegiveisProc10 = filtrarProfissionaisPorProcedimento(profsMock, 10, vinculosTeste);
    assert(
      elegiveisProc10.length === 1 && elegiveisProc10[0].id === 1,
      'Unitário: Procedimento #10 filtra apenas Dr. Teste 1 como profissional elegível'
    );

    const elegiveisProc20 = filtrarProfissionaisPorProcedimento(profsMock, 20, vinculosTeste);
    assert(
      elegiveisProc20.length === 2 && elegiveisProc20.some(p => p.id === 1) && elegiveisProc20.some(p => p.id === 2),
      'Unitário: Procedimento #20 filtra Dr. Teste 1 e Dr. Teste 2 como elegíveis'
    );

    // Mock store teste
    mockStore.vincularProcedimentosAoProfissional(1, [1, 2, 3]);
    assert(
      mockStore.verificarVinculo(1, 3) === true && mockStore.verificarVinculo(1, 4) === false,
      'MockStore: Vincular procedimentos 1, 2, 3 ao profissional 1 atualiza o store corretamente'
    );

    // -------------------------------------------------------------------------
    // SETUP DB: Garantir profissional e procedimentos de teste no MySQL
    // -------------------------------------------------------------------------
    // Criar profissional de teste dedicado
    const [resProf]: any = await pool.query(
      `INSERT INTO profissional (nome, registro_profissional, especialidade_principal, ativo) 
       VALUES ('Dr. Teste IK80', 'CRM-TEST-80', 'Especialista Teste', 1)`
    );
    const profIdTeste = resProf.insertId;

    // Buscar 3 procedimentos ativos existentes no banco
    const [procs]: any = await pool.query(
      'SELECT id_procedimento, nome FROM procedimento WHERE ativo = 1 LIMIT 3'
    );
    if (procs.length < 2) {
      throw new Error('Banco de dados precisa ter pelo menos 2 procedimentos ativos cadastrados.');
    }
    const procIdA = procs[0].id_procedimento;
    const procIdB = procs[1].id_procedimento;
    const procIdC = procs[2] ? procs[2].id_procedimento : null;

    // -------------------------------------------------------------------------
    // SUÍTE 2: CA01 — Vinculação de Procedimentos ao Profissional
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 2: CA01 — Vinculação (Salvar Vínculos) ---');

    // PUT /api/profissionais/:id/procedimentos com múltiplos procedimentos
    const resPut = await fetch(`${baseUrl}/profissionais/${profIdTeste}/procedimentos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ procedimentos: [procIdA, procIdB] })
    });
    const dataPut: any = await resPut.json();

    assert(
      resPut.status === 200 && dataPut.sucesso === true,
      'CA01: PUT /api/profissionais/:id/procedimentos responde 200 ao salvar múltiplos vínculos'
    );
    assert(
      Array.isArray(dataPut.dados?.procedimentos) &&
      dataPut.dados.procedimentos.includes(procIdA) &&
      dataPut.dados.procedimentos.includes(procIdB),
      'CA01: Retorno contém os IDs dos procedimentos vinculados [A, B]'
    );

    // GET /api/profissionais/:id/procedimentos para confirmar persistência
    const resGet = await fetch(`${baseUrl}/profissionais/${profIdTeste}/procedimentos`);
    const dataGet: any = await resGet.json();

    assert(
      resGet.status === 200 && dataGet.sucesso === true,
      'CA01: GET /api/profissionais/:id/procedimentos responde 200'
    );
    assert(
      Array.isArray(dataGet.procedimento_ids) &&
      dataGet.procedimento_ids.includes(procIdA) &&
      dataGet.procedimento_ids.includes(procIdB) &&
      dataGet.procedimento_ids.length === 2,
      'CA01: Procedimentos vinculados [A, B] persistidos com sucesso no MySQL'
    );

    // -------------------------------------------------------------------------
    // SUÍTE 3: CA02 — Remoção de Vínculo
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 3: CA02 — Remoção de Vínculo ---');

    // Remove procIdB, mantendo apenas procIdA
    const resPutRemocao = await fetch(`${baseUrl}/profissionais/${profIdTeste}/procedimentos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ procedimentos: [procIdA] })
    });
    const dataPutRemocao: any = await resPutRemocao.json();

    assert(
      resPutRemocao.status === 200 && dataPutRemocao.sucesso === true,
      'CA02: Atualização com remoção do vínculo B responde com sucesso 200'
    );

    const resGetAposRemocao = await fetch(`${baseUrl}/profissionais/${profIdTeste}/procedimentos`);
    const dataGetAposRemocao: any = await resGetAposRemocao.json();

    assert(
      !dataGetAposRemocao.procedimento_ids.includes(procIdB),
      'CA02: Procedimento B não está mais vinculado ao profissional após remoção'
    );
    assert(
      dataGetAposRemocao.procedimento_ids.includes(procIdA),
      'CA02: Procedimento A permaneceu vinculado'
    );

    // Testar DELETE pontual do vínculo remanescente
    const resDelete = await fetch(`${baseUrl}/profissionais/${profIdTeste}/procedimentos/${procIdA}`, {
      method: 'DELETE'
    });
    assert(
      resDelete.status === 200,
      'CA02: DELETE /api/profissionais/:id/procedimentos/:procId responde 200 ao remover vínculo'
    );

    const resGetZero = await fetch(`${baseUrl}/profissionais/${profIdTeste}/procedimentos`);
    const dataGetZero: any = await resGetZero.json();
    assert(
      dataGetZero.procedimento_ids.length === 0,
      'CA02: Todos os vínculos foram removidos com sucesso'
    );

    // -------------------------------------------------------------------------
    // SUÍTE 4: CA03 — Agendamento e Elegibilidade de Profissionais
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 4: CA03 — Agendamento e Elegibilidade ---');

    // Vincula novamente procIdA ao nosso profissional de teste
    await fetch(`${baseUrl}/profissionais/${profIdTeste}/procedimentos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ procedimento_id: procIdA })
    });

    // 1. Consulta profissionais elegíveis para o procedimento A
    const resElegiveisA = await fetch(`${baseUrl}/servicos/${procIdA}/profissionais`);
    const dataElegiveisA: any = await resElegiveisA.json();

    assert(
      resElegiveisA.status === 200 && dataElegiveisA.sucesso === true,
      'CA03: GET /api/servicos/:id/profissionais responde 200'
    );
    assert(
      dataElegiveisA.dados.some((p: any) => p.id === profIdTeste),
      'CA03: Profissional vinculado ao procedimento A é elegível na busca'
    );

    // 2. Consulta profissionais elegíveis para o procedimento B (ao qual nosso prof NÃO está vinculado)
    const resElegiveisB = await fetch(`${baseUrl}/servicos/${procIdB}/profissionais`);
    const dataElegiveisB: any = await resElegiveisB.json();

    assert(
      !dataElegiveisB.dados.some((p: any) => p.id === profIdTeste),
      'CA03: Profissional NÃO vinculado ao procedimento B NÃO é elegível para ele'
    );

    // 3. Consulta via query parameter ?procedimento_id=X
    const resQueryProc = await fetch(`${baseUrl}/profissionais?procedimento_id=${procIdA}`);
    const dataQueryProc: any = await resQueryProc.json();
    assert(
      dataQueryProc.sucesso === true && dataQueryProc.dados.some((p: any) => p.id === profIdTeste),
      'CA03: GET /api/profissionais?procedimento_id=X retorna somente profissionais vinculados'
    );

    // -------------------------------------------------------------------------
    // SUÍTE 5: CA03 — Validação de Regra de Negócio em Novo Agendamento
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 5: Bloqueio de Agendamento Sem Vínculo ---');

    // Tentativa de agendamento do procedimento B com o nosso prof (sem vínculo)
    // Busca paciente existente para usar no teste
    const [pacs]: any = await pool.query('SELECT uuid FROM paciente LIMIT 1');
    const pacUuid = pacs[0]?.uuid || 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d01';

    const resAgendamentoInvalido = await fetch(`${baseUrl}/agendamentos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paciente_id: pacUuid,
        profissional_id: profIdTeste,
        servico_id: procIdB, // NÃO vinculado
        data: '2026-08-17',
        horario_inicio: '10:00'
      })
    });
    const dataAgendamentoInvalido: any = await resAgendamentoInvalido.json();

    assert(
      resAgendamentoInvalido.status === 400 && dataAgendamentoInvalido.sucesso === false,
      'CA03/CA04: Tentativa de agendar procedimento para profissional não vinculado é rejeitada com 400'
    );
    assert(
      dataAgendamentoInvalido.erro.includes('Profissional não habilitado'),
      'CA03/CA04: Mensagem de erro informa com precisão que profissional não é habilitado'
    );

    // CLEANUP: Remover dados criados durante os testes
    await pool.query('DELETE FROM profissional_procedimento WHERE id_profissional = ?', [profIdTeste]);
    await pool.query('DELETE FROM profissional WHERE id_profissional = ?', [profIdTeste]);

  } catch (error: any) {
    console.error('Erro durante a execução dos testes de vinculação:', error);
    fail++;
  } finally {
    server.close();
  }

  return { total: pass + fail, pass, fail };
}
