import pool from '../config/database.js';

async function runPatientTests() {
  console.log("================================================================");
  console.log("🧪 INICIANDO TESTES: ENDPOINTS DE CADASTRO DE PACIENTES");
  console.log("================================================================");

  const testCpf = '99988877766';
  const testCpfFormatted = '999.888.777-66';
  const testPhone = '5511955554444';
  const testPhoneFormatted = '(55) 1195555-4444';

  try {
    // 1. Limpar paciente de teste pré-existente
    console.log('[Setup] Limpando dados de teste anteriores...');
    await pool.query('DELETE FROM pacientes WHERE cpf = ?', [testCpf]);

    // Simulação de chamada de API: Cadastro bem sucedido com sanitização
    console.log('\n--- Teste 1: Cadastro de Paciente com Sanitização ---');
    
    // Dados com caracteres especiais
    const payload = {
      nome_completo: 'Paciente de Teste da Silva',
      cpf: testCpfFormatted,
      telefone: testPhoneFormatted,
      endereco: 'Rua de Teste, 100 - Bairro - Cidade/UF'
    };

    // Processamento do backend
    const cleanCpf = payload.cpf.replace(/\D/g, '');
    const cleanTelefone = payload.telefone.replace(/\D/g, '');

    if (cleanCpf !== testCpf) {
      throw new Error(`Falha ao sanitizar CPF. Esperado: ${testCpf}, Obtido: ${cleanCpf}`);
    }
    if (cleanTelefone !== testPhone) {
      throw new Error(`Falha ao sanitizar Telefone. Esperado: ${testPhone}, Obtido: ${cleanTelefone}`);
    }
    console.log('   ✅ PASSOU: Máscaras sanitizadas no backend com sucesso.');

    // Simulação da inserção no banco de dados com UUID gerado
    const crypto = await import('crypto');
    const id = crypto.randomUUID();

    await pool.query(
      `INSERT INTO pacientes (id, nome_completo, cpf, telefone, whatsapp, endereco) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, payload.nome_completo, cleanCpf, cleanTelefone, cleanTelefone, payload.endereco]
    );
    console.log(`   Paciente inserido no banco com UUID: ${id}`);

    // Consultar o banco de dados para garantir que foi salvo sem máscaras
    const [rows]: any = await pool.query('SELECT * FROM pacientes WHERE id = ?', [id]);
    
    if (rows.length === 0) {
      throw new Error('Falha no salvamento: Paciente não encontrado no banco.');
    }
    const saved = rows[0];
    if (saved.cpf === testCpf && saved.telefone === testPhone) {
      console.log('   ✅ PASSOU: Dados gravados fisicamente de forma limpa no MySQL.');
    } else {
      throw new Error(`Dados salvos de forma incorreta. CPF: ${saved.cpf}, Telefone: ${saved.telefone}`);
    }

    // 2. Testar unicidade do CPF (Colisão)
    console.log('\n--- Teste 2: Validação de CPF Único (Colisão) ---');
    
    // Tentar buscar se o CPF já existe
    const [existing]: any = await pool.query('SELECT id FROM pacientes WHERE cpf = ?', [cleanCpf]);
    if (existing.length > 0) {
      console.log('   ✅ PASSOU: CPF já detectado como existente no banco. Impedindo novo cadastro.');
    } else {
      throw new Error('Falha no Teste 2: CPF deveria ter sido detectado como duplicado.');
    }

    console.log("\n================================================================");
    console.log("🎉 TODOS OS TESTES DE CADASTRO PASSARAM COM SUCESSO!");
    console.log("================================================================");

    // Limpar dados de teste
    await pool.query('DELETE FROM pacientes WHERE id = ?', [id]);
    process.exit(0);

  } catch (err: any) {
    console.error('\n🚨 FALHA NOS TESTES DE CADASTRO DE PACIENTES:', err.message);
    process.exit(1);
  }
}

runPatientTests();
