/* =====================================================================
 * CLÍNICA IKIGAI - POOL DE CONEXÕES MYSQL (TYPESCRIPT)
 * Arquivo: backend/src/config/database.ts
 * ===================================================================== */

import mysql, { Pool } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const pool: Pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'clinica_ikigai_db',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true
});

// Verificação de conectividade no boot
pool.getConnection()
  .then(conn => {
    console.log(`[MySQL] Conexão ativa com o banco '${process.env.DB_NAME || 'clinica_ikigai_db'}'`);
    conn.release();
  })
  .catch(err => {
    console.error(`[MySQL] Falha ao conectar ao banco de dados: ${err.message}`);
  });

export default pool;
