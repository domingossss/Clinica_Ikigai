import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool, { ErroOperacao } from '../config/database.js';
import { obterProvedor, type PedidoMensagem, type ProvedorMensagens, type ResultadoEnvio } from './provedorMensagens.js';

type Tipo = PedidoMensagem['tipo'];
const statusElegiveis = ['Agendado', 'Confirmado', 'Reagendado'];
const formatoOcorrencia = "DATE_FORMAT(a.data_hora_agendamento, '%Y-%m-%d %H:%i:%s')";
const consultaAtendimento = `SELECT a.id_agendamento AS id, p.nome AS paciente, p.whatsapp,
  a.status, ${formatoOcorrencia} AS ocorrencia FROM agendamento a
  JOIN paciente p ON p.id_paciente = a.id_paciente WHERE a.id_agendamento = ?`;

async function transacao<T>(operacao: (db: PoolConnection) => Promise<T>) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const valor = await operacao(db);
    await db.commit();
    return valor;
  } catch (erro) {
    try { await db.rollback(); } catch { db.destroy(); }
    throw erro;
  } finally { db.release(); }
}

export function janelaLembrete(agora = new Date()) {
  const minutos = Number(process.env.LEMBRETE_ANTECEDENCIA_MINUTOS?.trim() || 1440);
  const fuso = process.env.LEMBRETE_FUSO?.trim() || 'America/Sao_Paulo';
  if (!fuso || !Number.isSafeInteger(minutos) || minutos < 1 || minutos > 10080) return null;
  const formato = new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return { inicio: formato.format(agora), fim: formato.format(agora.getTime() + minutos * 60000) };
}

function numeroWhatsApp(valor: unknown) {
  if (typeof valor !== 'string' || !/^[+\d() .-]+$/.test(valor)) return null;
  const numero = valor.replace(/\D/g, '');
  return /^[1-9]\d{9,14}$/.test(numero) ? numero : null;
}

function elegivel(atendimento: RowDataPacket, tipo: Tipo, agora?: Date) {
  if (!statusElegiveis.includes(atendimento.status)) return false;
  if (tipo === 'CONFIRMACAO') return true;
  const janela = janelaLembrete(agora);
  return janela && atendimento.ocorrencia > janela.inicio && atendimento.ocorrencia <= janela.fim;
}

export async function consultarAtendimento(id: number) {
  const [rows] = await pool.query<RowDataPacket[]>(consultaAtendimento, [id]);
  if (!rows.length) throw new ErroOperacao(404, 'Atendimento não encontrado.');
  const { paciente, ocorrencia, status, whatsapp } = rows[0];
  const numero = numeroWhatsApp(whatsapp);
  return { id, paciente, ocorrencia, status, contatoFinal: numero?.slice(-4) ?? null };
}

async function registrar(id: number, tipo: Tipo, ocorrencia: string, anterior: number | null, provedor: ProvedorMensagens, agora?: Date) {
  return transacao(async db => {
    const [rows] = await db.query<RowDataPacket[]>(consultaAtendimento + ' FOR UPDATE', [id]);
    if (!rows.length) throw new ErroOperacao(404, 'Atendimento não encontrado.');
    const atendimento = rows[0];
    if (atendimento.ocorrencia !== ocorrencia || !elegivel(atendimento, tipo, agora)) {
      throw new ErroOperacao(409, 'O horário ou o status do atendimento mudou. Atualize a consulta.');
    }
    const [anteriores] = await db.query<RowDataPacket[]>(`SELECT id, tentativa, estado FROM comunicacao_agendamento
      WHERE id_agendamento = ? AND ocorrencia = ? AND tipo = ? ORDER BY tentativa DESC LIMIT 1 FOR UPDATE`,
      [id, ocorrencia, tipo]);
    const ultima = anteriores[0];
    if (ultima && (anterior !== ultima.id || ultima.estado !== 'FALHA')) return Number(ultima.id);
    if (anterior !== null && !ultima) throw new ErroOperacao(409, 'Tentativa anterior não encontrada neste horário.');
    const [inserido] = await db.query<ResultSetHeader>(`INSERT INTO comunicacao_agendamento
      (id_agendamento, ocorrencia, tipo, tentativa, provedor) VALUES (?, ?, ?, ?, ?)`,
      [id, ocorrencia, tipo, Number(ultima?.tentativa || 0) + 1, provedor.nome]);
    return inserido.insertId;
  });
}

async function processar(id: number, provedor: ProvedorMensagens, agora?: Date) {
  // O registro incerto impede um segundo envio após interrupção entre submissão e gravação do resultado.
  const pedido = await transacao(async db => {
    const [ids] = await db.query<RowDataPacket[]>('SELECT id_agendamento FROM comunicacao_agendamento WHERE id = ?', [id]);
    if (!ids.length) return;
    const [atendimentos] = await db.query<RowDataPacket[]>(consultaAtendimento + ' FOR UPDATE', [ids[0].id_agendamento]);
    const [rows] = await db.query<RowDataPacket[]>(`SELECT estado, provedor, tipo, DATE_FORMAT(ocorrencia, '%Y-%m-%d %H:%i:%s') AS ocorrencia
      FROM comunicacao_agendamento WHERE id = ? FOR UPDATE`, [id]);
    const mensagem = rows[0];
    if (mensagem.estado !== 'PENDENTE' || mensagem.provedor !== provedor.nome) return;
    const atendimento = atendimentos[0];
    const whatsapp = numeroWhatsApp(atendimento.whatsapp);
    let erro: string | null = null;
    if (atendimento.ocorrencia !== mensagem.ocorrencia || !elegivel(atendimento, mensagem.tipo, agora)) {
      erro = 'Atendimento fora da regra de envio.';
    } else if (!whatsapp) erro = 'WhatsApp inválido no cadastro do paciente.';
    if (erro || !whatsapp) {
      await db.query("UPDATE comunicacao_agendamento SET estado = 'FALHA', erro = ? WHERE id = ?", [erro, id]);
      return;
    }
    await db.query("UPDATE comunicacao_agendamento SET estado = 'INCERTA', erro = 'Aguardando resultado do provedor.' WHERE id = ?", [id]);
    return { id, whatsapp, ocorrencia: mensagem.ocorrencia, tipo: mensagem.tipo } satisfies PedidoMensagem;
  });
  if (!pedido) return;
  let resultado: ResultadoEnvio;
  try { resultado = await provedor.enviar(pedido); }
  catch { resultado = { estado: 'INCERTA', erro: 'O provedor não confirmou a submissão.' }; }
  await pool.query(`UPDATE comunicacao_agendamento SET estado = ?, erro = ?, referencia_externa = ?
    WHERE id = ? AND estado = 'INCERTA'`, [resultado.estado, resultado.erro ?? null, resultado.referencia ?? null, id]);
}

export async function confirmar(id: number, ocorrencia: string, anterior: number | null) {
  const provedor = obterProvedor();
  if (!provedor) throw new ErroOperacao(503, 'Canal de comunicação desabilitado.');
  const mensagemId = await registrar(id, 'CONFIRMACAO', ocorrencia, anterior, provedor);
  await processar(mensagemId, provedor);
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id, estado, erro FROM comunicacao_agendamento WHERE id = ?', [mensagemId]);
  return rows[0];
}

export async function processarFila(agora?: Date) {
  const provedor = obterProvedor();
  if (!provedor) return;
  const [pendentes] = await pool.query<RowDataPacket[]>(`SELECT id FROM comunicacao_agendamento
    WHERE estado = 'PENDENTE' AND provedor = ? ORDER BY id LIMIT 100`, [provedor.nome]);
  for (const row of pendentes) await processar(row.id, provedor, agora);
  const janela = janelaLembrete(agora);
  if (!janela) return;
  const [candidatos] = await pool.query<RowDataPacket[]>(`SELECT a.id_agendamento AS id, ${formatoOcorrencia} AS ocorrencia
    FROM agendamento a WHERE a.data_hora_agendamento > ? AND a.data_hora_agendamento <= ?
      AND a.status IN (?) AND NOT EXISTS (SELECT 1 FROM comunicacao_agendamento c WHERE c.id_agendamento = a.id_agendamento
        AND c.tipo = 'LEMBRETE' AND c.ocorrencia = a.data_hora_agendamento)
    ORDER BY a.data_hora_agendamento, a.id_agendamento LIMIT 100`, [janela.inicio, janela.fim, statusElegiveis]);
  for (const row of candidatos) {
    try {
      const id = await registrar(row.id, 'LEMBRETE', row.ocorrencia, null, provedor, agora);
      await processar(id, provedor, agora);
    } catch (erro) {
      if (!(erro instanceof ErroOperacao && [404, 409].includes(erro.status))) throw erro;
    }
  }
}

export function iniciarLembretes() {
  if (!obterProvedor()) return;
  let rodando = false;
  async function executar() {
    if (rodando) return;
    rodando = true;
    try { await processarFila(); } catch { console.error('[Comunicação] Falha ao processar a fila.'); }
    finally { rodando = false; }
  }
  void executar();
  return setInterval(() => { void executar(); }, 60000).unref();
}
