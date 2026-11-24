import pool from '../config/database.js';
import type { RowDataPacket } from 'mysql2';
import { gerarHashSenha } from '../middleware/auth.js';

async function provisionar() {
  const email = process.env.ADMIN_INITIAL_EMAIL?.trim().toLowerCase();
  const senha = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !senha || senha.length < 12) {
    throw new Error('Defina ADMIN_INITIAL_EMAIL e ADMIN_INITIAL_PASSWORD (mínimo de 12 caracteres) para provisionar o primeiro administrador.');
  }
  const conexao = await pool.getConnection();
  try {
    const [bloqueio] = await conexao.query<RowDataPacket[]>(
      "SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':admin-inicial'), 256), 10) AS obtido"
    );
    if (bloqueio[0]?.obtido !== 1) throw new Error('Já existe um provisionamento em andamento.');
    const [existentes] = await conexao.query<RowDataPacket[]>('SELECT 1 FROM usuario LIMIT 1');
    if (existentes.length) throw new Error('O banco já possui usuários. Gerencie as contas pela aplicação.');
    await conexao.query(
      "INSERT INTO usuario (nome, email, senha_hash, perfil, ativo) VALUES (?, ?, ?, 'ADMIN', 1)",
      ['Administrador Ikigai', email, await gerarHashSenha(senha)]
    );
    console.log('Primeiro administrador criado.');
  } finally {
    // Encerrar a conexão também libera o bloqueio do MySQL em qualquer caminho de erro.
    conexao.destroy();
  }
}

try {
  await provisionar();
} catch (erro) {
  console.error(erro instanceof Error && !('code' in erro) ? erro.message : 'Falha ao provisionar. Confira a conexão e aplique o schema.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
