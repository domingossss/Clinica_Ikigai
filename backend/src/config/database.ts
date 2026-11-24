import mysql, { type PoolConnection } from 'mysql2/promise';
import { registrarErro } from '../middleware/security.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

// Criar o pool de conexões com o MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'clinica_ikigai_db',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10, // número máximo de conexões ociosas
  idleTimeout: 60000, // conexões ociosas expiram após 60 segundos
  queueLimit: 100,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Helper de teste rápido para validar a conexão no boot
export async function testarConexao(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    console.log('[MySQL] Conexão com o banco de dados estabelecida com sucesso!');
    connection.release();
    return true;
  } catch (error) {
    registrarErro('[MySQL] Falha ao conectar ao banco:', error);
    return false;
  }
}

export class ErroOperacao extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type ConsultaBanco = Pick<PoolConnection, 'query'>;

export async function executarTransacao<T>(operacao: (conexao: PoolConnection) => Promise<T>): Promise<T> {
  const conexao = await pool.getConnection();
  let reutilizavel = true;
  try {
    await conexao.beginTransaction();
    const resultado = await operacao(conexao);
    await conexao.commit();
    return resultado;
  } catch (erro) {
    try {
      await conexao.rollback();
    } catch {
      reutilizavel = false;
      conexao.destroy();
    }
    throw erro;
  } finally {
    if (reutilizavel) conexao.release();
  }
}

export default pool;
