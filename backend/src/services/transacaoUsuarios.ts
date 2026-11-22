import type { PoolConnection } from 'mysql2/promise';
import pool from '../config/database.js';

export async function transacaoUsuarios<T>(operacao: (conexao: PoolConnection) => Promise<T>): Promise<T> {
  const conexao = await pool.getConnection();
  let reutilizavel = true;
  try {
    await conexao.beginTransaction();
    const resultado = await operacao(conexao);
    await conexao.commit();
    return resultado;
  } catch (erro) {
    try { await conexao.rollback(); } catch { reutilizavel = false; conexao.destroy(); }
    throw erro;
  } finally {
    if (reutilizavel) conexao.release();
  }
}
