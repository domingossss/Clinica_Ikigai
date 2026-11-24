import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { executarScriptSql } from '../utils/executarScriptSql.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(raiz, 'backend/.env') });
const esquema = process.env.DB_NAME || 'clinica_ikigai_db';
if (!/^[a-zA-Z0-9_]+$/.test(esquema)) throw new Error('Nome do banco inválido.');
const conexao = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_ADMIN_USER || process.env.DB_USER,
  password: process.env.DB_ADMIN_PASS || process.env.DB_PASS || process.env.DB_PASSWORD,
  database: esquema, multipleStatements: true,
});

const versaoBase = '2026-11-22-comunicacoes';
const versaoAuditoria = '2026-11-23-auditoria-clinica-e-reagendamento';
const versaoRevisoes = '2026-11-23-revisoes-clinica';
const versaoCheckin = '2026-11-23-validacao-checkin-recepcao';
const versaoProntuarioELogin = '2026-11-24-prontuario-consulta-e-login-usuario';
const trava = createHash('sha256').update(`ikigai:migracao:${esquema}`).digest('hex');

async function colunas(tabela: string) {
  const [linhas] = await conexao.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME AS nome, CHARACTER_MAXIMUM_LENGTH AS tamanho, IS_NULLABLE AS aceita_nulo
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [esquema, tabela]);
  return new Map(linhas.map(coluna => [coluna.nome, coluna]));
}

async function aplicarVersao(versao: string, migrar: () => Promise<void>) {
  const [aplicada] = await conexao.query<mysql.RowDataPacket[]>('SELECT 1 FROM schema_migrations WHERE version = ?', [versao]);
  if (aplicada.length) return;
  await migrar();
  await conexao.query('INSERT INTO schema_migrations(version) VALUES (?)', [versao]);
}

async function migrarBase(schema: string) {
  const agendamento = await colunas('agendamento');
  if (!agendamento.has('observacoes')) await conexao.query('ALTER TABLE agendamento ADD COLUMN observacoes TEXT NULL');
  const paciente = await colunas('paciente');
  if (!paciente.has('versao')) await conexao.query('ALTER TABLE paciente ADD COLUMN versao INT NOT NULL DEFAULT 0');
  if (paciente.get('data_nascimento')?.aceita_nulo === 'NO') {
    await conexao.query('ALTER TABLE paciente MODIFY data_nascimento DATE NULL DEFAULT NULL');
  }
  await executarScriptSql(conexao, schema.replaceAll('clinica_ikigai_db', esquema));
  const historico = await colunas('historico_status_agendamento');
  if (!historico.has('tipo_evento')) {
    await conexao.query("ALTER TABLE historico_status_agendamento ADD COLUMN tipo_evento ENUM('CRIACAO','REAGENDAMENTO','CANCELAMENTO','STATUS') NULL");
  }
  if (!historico.has('id_usuario')) await conexao.query('ALTER TABLE historico_status_agendamento ADD COLUMN id_usuario INT NULL');
  if (Number(historico.get('alterado_por')?.tamanho) < 150) {
    await conexao.query("ALTER TABLE historico_status_agendamento MODIFY alterado_por VARCHAR(150) NOT NULL DEFAULT 'Sistema'");
  }
  await conexao.query('INSERT IGNORE INTO schema_migrations(version) VALUES ?', [[
    ['2026-11-22-historico-agendamento'], ['2026-11-13-integridade'], ['2026-11-22-usuarios-sessoes'],
  ]]);
}

async function criarTabelaDoSchema(schema: string, tabela: 'paciente_evolucao' | 'revisao_clinica' | 'prontuario_consulta') {
  const padrao = new RegExp(`^CREATE TABLE IF NOT EXISTS ${tabela} \\([\\s\\S]*?;$`, 'm');
  const definicao = schema.match(padrao)?.[0];
  if (!definicao) throw new Error(`Tabela ${tabela} ausente na definição do banco.`);
  await conexao.query(definicao);
}

async function migrarAuditoria(schema: string) {
  await criarTabelaDoSchema(schema, 'paciente_evolucao');
  const historico = await colunas('historico_status_agendamento');
  for (const coluna of ['ocorrencia_anterior', 'ocorrencia_nova']) {
    if (!historico.has(coluna)) {
      await conexao.query('ALTER TABLE historico_status_agendamento ADD COLUMN ?? DATETIME NULL', [coluna]);
    }
  }
}

try {
  const [[bloqueio]] = await conexao.query<mysql.RowDataPacket[]>('SELECT GET_LOCK(?, 30) AS obtido', [trava]);
  if (Number(bloqueio.obtido) !== 1) throw new Error('Outra migração está em execução para este banco.');
  await conexao.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  const schema = await fs.readFile(path.join(raiz, 'database/schema.sql'), 'utf8');
  await aplicarVersao(versaoBase, () => migrarBase(schema));
  await aplicarVersao(versaoAuditoria, () => migrarAuditoria(schema));
  await aplicarVersao(versaoRevisoes, () => criarTabelaDoSchema(schema, 'revisao_clinica'));
  await aplicarVersao(versaoCheckin, async () => {
    if (!(await colunas('agendamento')).has('checkin_recepcao')) {
      await conexao.query('ALTER TABLE agendamento ADD COLUMN checkin_recepcao TINYINT(1) NOT NULL DEFAULT 0');
    }
    // O perfil atual só comprova quem registrou a chegada se a conta não mudou desde o evento.
    await conexao.query(`UPDATE agendamento a SET checkin_recepcao = 1
      WHERE a.checkin_recepcao = 0
        AND a.status IN ('Na Recepção', 'Em Atendimento', 'Concluído', 'Realizado')
        AND a.data_hora_checkin IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM historico_status_agendamento h
          JOIN usuario u ON u.id_usuario = h.id_usuario
          WHERE h.id_agendamento = a.id_agendamento AND h.tipo_evento = 'STATUS'
            AND h.status_anterior IN ('Agendado', 'Confirmado', 'Reagendado')
            AND h.status_novo = 'Na Recepção' AND h.data_alteracao = a.data_hora_checkin
            AND u.perfil IN ('ADMIN', 'RECEPCAO') AND u.atualizado_em < h.data_alteracao
        )`);
  });
  await aplicarVersao(versaoProntuarioELogin, async () => {
    const usuarioCols = await colunas('usuario');
    if (!usuarioCols.has('login')) {
      await conexao.query('ALTER TABLE usuario ADD COLUMN login VARCHAR(100) NULL UNIQUE AFTER nome');
    }
    if (!usuarioCols.has('precisa_trocar_senha')) {
      await conexao.query('ALTER TABLE usuario ADD COLUMN precisa_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE AFTER senha_hash');
    }
    const pacienteCols = await colunas('paciente');
    if (!pacienteCols.has('rg')) {
      await conexao.query('ALTER TABLE paciente ADD COLUMN rg VARCHAR(30) NULL AFTER cpf');
    }
    if (!pacienteCols.has('filiacao')) {
      await conexao.query('ALTER TABLE paciente ADD COLUMN filiacao VARCHAR(255) NULL AFTER sexo');
    }
    if (!pacienteCols.has('naturalidade')) {
      await conexao.query('ALTER TABLE paciente ADD COLUMN naturalidade VARCHAR(120) NULL AFTER filiacao');
    }
    await criarTabelaDoSchema(schema, 'prontuario_consulta');
  });
  console.log('Estrutura atualizada. Dados existentes preservados.');
} finally {
  await conexao.end();
}
