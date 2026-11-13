import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import mysql, { type PoolConnection } from 'mysql2/promise';
import { registrarErro } from '../middleware/security.js';
import { resolverJanelasAgenda } from '../utils/validation.js';
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
    registrarErro('[MySQL] Falha ao conectar ao banco:', error);
    return false;
  }
}

export class ErroOperacao extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type ConsultaBanco = Pick<PoolConnection, 'query'>;

export async function obterJanelasAgenda(banco: ConsultaBanco, profissionalId: number, data: string) {
  const dia = new Date(data + 'T12:00:00Z').getUTCDay();
  const [jornadas] = await banco.query<any[]>(
    'SELECT * FROM jornada_profissional WHERE id_profissional = ? AND dia_semana = ?', [profissionalId, dia]);
  const [excecoes] = await banco.query<any[]>(
    'SELECT * FROM excecao_disponibilidade WHERE data = ? AND (id_profissional IS NULL OR id_profissional = ?) ORDER BY (id_profissional IS NOT NULL) DESC, id_excecao DESC LIMIT 1', [data, profissionalId]);
  return resolverJanelasAgenda(data, jornadas[0], excecoes[0]);
}

// Todas as alterações de agenda usam o mesmo bloqueio por profissional.
// Ele protege inclusive a primeira reserva do dia, quando ainda não existe linha de agendamento.
export async function transacaoAgenda<T>(ids: number[] | null, executar: (conexao: PoolConnection) => Promise<T>): Promise<T> {
  const conexao = await pool.getConnection();
  let descartar = false;
  try {
    await conexao.beginTransaction();
    if (ids === null) {
      await conexao.query('SELECT id_profissional FROM profissional ORDER BY id_profissional FOR UPDATE');
    } else {
      for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
        const [rows] = await conexao.query<any[]>('SELECT id_profissional FROM profissional WHERE id_profissional = ? FOR UPDATE', [id]);
        if (!rows.length) throw new ErroOperacao(404, 'Profissional não encontrado.');
      }
    }
    const resultado = await executar(conexao);
    await conexao.commit();
    return resultado;
  } catch (error) {
    try { await conexao.rollback(); } catch { descartar = true; conexao.destroy(); }
    throw error;
  } finally { if (!descartar) conexao.release(); }
}

export default pool;

// O fluxo transporta somente avisos de mudança, nunca dados de pacientes.
const eventosClinica = new EventEmitter();
eventosClinica.setMaxListeners(0);
const instancia = randomUUID();
let revisao = 0;
const recursosSincronizados = new Set(['agendamentos', 'pacientes', 'servicos', 'categorias', 'profissionais', 'bloqueios', 'excecoes']);

export function notificarAlteracoes(req: Request, res: Response, next: NextFunction): void {
  const recurso = req.path.split('/').filter(Boolean)[0];
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && recursosSincronizados.has(recurso)) {
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const publicar = () => eventosClinica.emit('alteracao', { versao: instancia + ':' + (++revisao), recursos: [recurso] });
        if (['profissionais','servicos','categorias','excecoes','bloqueios'].includes(recurso)) {
          void import('../services/capacidadeAgenda.js').then(m => m.registrarCapacidadeHoje()).catch(error => registrarErro('[Capacidade]', error)).finally(publicar);
        } else publicar();
      }
    });
  }
  next();
}

export function acompanharAlteracoes(_req: Request, res: Response): void {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  // Reconexões sempre pedem uma leitura completa: não dependemos de um histórico em memória.
  res.write('event: pronto\ndata: ' + JSON.stringify({ versao: instancia + ':' + revisao, recursos: [] }) + '\n\n');
  const enviar = (mudanca: { versao: string; recursos: string[] }) => {
    if (!res.destroyed && !res.writableEnded) {
      res.write('id: ' + mudanca.versao + '\nevent: alteracao\ndata: ' + JSON.stringify(mudanca) + '\n\n');
    }
  };
  eventosClinica.on('alteracao', enviar);
  const manterConexao = setInterval(() => { if (!res.destroyed) res.write(': conectado\n\n'); }, 20000);
  res.once('close', () => { clearInterval(manterConexao); eventosClinica.off('alteracao', enviar); });
}
