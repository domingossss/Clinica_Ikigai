import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({path:path.join(root,'backend/.env')});
const name = process.env.DB_NAME || 'clinica_ikigai_db';
if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Nome do banco inválido.');
const db = await mysql.createConnection({host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT || 3306),user:process.env.DB_ADMIN_USER || process.env.DB_USER,password:process.env.DB_ADMIN_PASS || process.env.DB_PASS || process.env.DB_PASSWORD,database:name,multipleStatements:true});
try {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  const [columns] = await db.query<mysql.RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agendamento' AND COLUMN_NAME = 'observacoes'",[name]);
  if (!columns.length) await db.query('ALTER TABLE agendamento ADD COLUMN observacoes TEXT NULL');
  const [version] = await db.query<mysql.RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'paciente' AND COLUMN_NAME = 'versao'",[name]);
  if (!version.length) await db.query('ALTER TABLE paciente ADD COLUMN versao INT NOT NULL DEFAULT 0');
  await db.query('ALTER TABLE paciente MODIFY data_nascimento DATE NULL DEFAULT NULL');
  const sql = (await fs.readFile(path.join(root,'database/schema.sql'),'utf8')).replaceAll('clinica_ikigai_db',name);
  let delimiter = ';', buffer = '';
  for (const line of sql.split(/\r?\n/)) {
    const match = line.trim().match(/^DELIMITER\s+(\S+)/i);
    if (match) { delimiter = match[1]; continue; }
    buffer += line + '\n';
    if (line.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0,-delimiter.length);
      if (statement.trim()) await db.query(statement);
      buffer = '';
    }
  }
  if (buffer.replace(/--[^\n]*/g,'').trim()) await db.query(buffer);
  const [historico] = await db.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME AS nome, CHARACTER_MAXIMUM_LENGTH AS tamanho FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'historico_status_agendamento'", [name]);
  if (!historico.some(c => c.nome === 'tipo_evento')) {
    await db.query("ALTER TABLE historico_status_agendamento ADD COLUMN tipo_evento ENUM('CRIACAO','REAGENDAMENTO','CANCELAMENTO','STATUS') NULL");
  }
  if (!historico.some(c => c.nome === 'id_usuario')) {
    await db.query("ALTER TABLE historico_status_agendamento ADD COLUMN id_usuario INT NULL");
  }
  if (Number(historico.find(c => c.nome === 'alterado_por')?.tamanho) < 150) {
    await db.query("ALTER TABLE historico_status_agendamento MODIFY alterado_por VARCHAR(150) NOT NULL DEFAULT 'Sistema'");
  }
  await db.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('2026-11-22-historico-agendamento')");
  await db.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('2026-11-13-integridade')");
  await db.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('2026-11-22-usuarios-sessoes')");
  await db.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('2026-11-22-comunicacoes')");
  console.log('Estrutura atualizada. Dados existentes preservados.');
} finally { await db.end(); }
