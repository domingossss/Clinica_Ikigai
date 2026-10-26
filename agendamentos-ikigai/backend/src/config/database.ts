import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente do .env
dotenv.config();

// Criar o pool de conexões com o MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'ikigai_db',
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10, // número máximo de conexões ociosas
  idleTimeout: 60000, // conexões ociosas expiram após 60 segundos
  queueLimit: 0,
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
    console.error('[MySQL] Falha ao se conectar com o banco de dados:', error);
    return false;
  }
}

export default pool;
