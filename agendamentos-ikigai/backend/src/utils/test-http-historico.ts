import express from 'express';
import http from 'http';
import router from '../routes/agendamentos.js';
import pool from '../config/database.js';
import { randomUUID } from 'crypto';

async function testHttpHistorico() {
  console.log('\n================================================================');
  console.log('🧪 TESTE DE INTEGRAÇÃO HTTP: GET /api/pacientes/:id/historico');
  console.log('================================================================');

  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const tempUuidComAtendimentos = randomUUID();
  const tempUuidSemAtendimentos = randomUUID();

  try {
    // Setup pacientes: limpeza preventiva
    await pool.query('DELETE FROM paciente WHERE cpf IN (?, ?)', ['77766655544', '77766655533']);

    await pool.query(
      `INSERT INTO paciente (uuid, nome, cpf, telefone, whatsapp, endereco) VALUES (?, ?, ?, ?, ?, ?)`,
      [tempUuidComAtendimentos, 'Paciente Com Histórico', '77766655544', '11988887777', '11988887777', 'Rua A, 1']
    );
    await pool.query(
      `INSERT INTO paciente (uuid, nome, cpf, telefone, whatsapp, endereco) VALUES (?, ?, ?, ?, ?, ?)`,
      [tempUuidSemAtendimentos, 'Paciente Sem Histórico', '77766655533', '11988886666', '11988886666', 'Rua B, 2']
    );

    // Setup 2 agendamentos para o primeiro
    await pool.query(
      `INSERT INTO agendamento (paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, status)
       VALUES (?, 1, 1, '2026-05-10', '09:00:00', '10:00:00', 'Realizado')`,
      [tempUuidComAtendimentos]
    );
    await pool.query(
      `INSERT INTO agendamento (paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, status)
       VALUES (?, 2, 2, '2026-06-15', '14:00:00', '15:00:00', 'Agendado')`,
      [tempUuidComAtendimentos]
    );

    // 1. Testar Paciente com histórico (CA01 e CA02)
    console.log('\n--- Teste HTTP 1: Paciente com histórico (CA01 e CA02) ---');
    const res1 = await fetch(`${baseUrl}/pacientes/${tempUuidComAtendimentos}/historico`);
    if (res1.status !== 200) throw new Error(`Esperado status 200, recebido ${res1.status}`);
    const json1: any = await res1.json();
    console.log('   Retorno json1:', JSON.stringify(json1, null, 2));

    if (!json1.sucesso || json1.dados.total !== 2) {
      throw new Error(`Total incorreto. Esperado 2, recebido: ${json1.dados.total}`);
    }
    // Ordem DESC: 2026-06-15 primeiro
    if (json1.dados.historico[0].data !== '2026-06-15' || json1.dados.historico[1].data !== '2026-05-10') {
      throw new Error('Falha na ordenação cronológica decrescente padrão.');
    }
    // Campos do item
    const item = json1.dados.historico[0];
    if (!item.data || !item.horario_inicio || !item.servico_nome || !item.profissional_nome || !item.status) {
      throw new Error('Campos obrigatórios ausentes no item do histórico.');
    }
    console.log('   ✅ PASSOU: 200 OK, ordenação correta e informações completas (data, procedimento, profissional, status).');

    // 2. Testar Paciente sem histórico (CA03)
    console.log('\n--- Teste HTTP 2: Paciente sem histórico (CA03) ---');
    const res2 = await fetch(`${baseUrl}/pacientes/${tempUuidSemAtendimentos}/historico`);
    if (res2.status !== 200) throw new Error(`Esperado status 200, recebido ${res2.status}`);
    const json2: any = await res2.json();

    if (!json2.sucesso || json2.dados.total !== 0 || !Array.isArray(json2.dados.historico) || json2.dados.historico.length !== 0) {
      throw new Error(`Falha no CA03. Esperado total 0 e array vazio.`);
    }
    if (!json2.mensagem.includes('Nenhum registro')) {
      throw new Error(`Mensagem explicativa ausente no CA03: ${json2.mensagem}`);
    }
    console.log('   ✅ PASSOU: 200 OK, total: 0, historico: [] e mensagem informativa para paciente sem registros.');

    // 3. Testar ordenação crescente
    console.log('\n--- Teste HTTP 3: Suporte ao parâmetro de ordenação (?ordem=ASC) ---');
    const res3 = await fetch(`${baseUrl}/pacientes/${tempUuidComAtendimentos}/historico?ordem=ASC`);
    const json3: any = await res3.json();
    if (json3.dados.historico[0].data !== '2026-05-10' || json3.dados.historico[1].data !== '2026-06-15') {
      throw new Error('Falha na ordenação cronológica crescente.');
    }
    console.log('   ✅ PASSOU: Ordenação crescente funcionou perfeitamente.');

    // 4. Testar Paciente Inexistente (404)
    console.log('\n--- Teste HTTP 4: Paciente Inexistente (404) ---');
    const fakeId = '00000000-ffff-eeee-dddd-000000000000';
    const res4 = await fetch(`${baseUrl}/pacientes/${fakeId}/historico`);
    if (res4.status !== 404) throw new Error(`Esperado 404, recebido ${res4.status}`);
    const json4: any = await res4.json();
    if (json4.sucesso !== false) throw new Error('Esperado sucesso: false para 404.');
    console.log('   ✅ PASSOU: 404 retornado corretamente para ID inexistente.');

    console.log('\n================================================================');
    console.log('🎉 TODOS OS TESTES HTTP DE HISTÓRICO PASSARAM COM SUCESSO!');
    console.log('================================================================\n');

  } finally {
    // Cleanup
    try {
      await pool.query('DELETE FROM agendamento WHERE paciente_uuid = ?', [tempUuidComAtendimentos]);
      await pool.query('DELETE FROM paciente WHERE uuid IN (?, ?)', [tempUuidComAtendimentos, tempUuidSemAtendimentos]);
    } catch {}
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

testHttpHistorico().then(() => {
  // exit cleanly
}).catch((err) => {
  console.error('🚨 FALHA NO TESTE HTTP:', err.message);
  process.exit(1);
});
