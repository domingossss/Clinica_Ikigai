import { Router, type NextFunction, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import pool, { ErroOperacao } from '../config/database.js';
import { confirmar, consultarAtendimento } from '../services/comunicacoes.js';
import { obterProvedor } from '../services/provedorMensagens.js';

const router = Router();
const estados = ['PENDENTE', 'SUBMETIDA', 'ENTREGUE', 'FALHA', 'INCERTA'];
const limite = 20;

function inteiro(valor: unknown) {
  const n = Number(valor);
  if (!(typeof valor === 'number' || typeof valor === 'string') || !/^[1-9]\d*$/.test(String(valor)) || !Number.isSafeInteger(n) || n > 2147483647) {
    throw new ErroOperacao(400, 'Identificador ou página inválidos.');
  }
  return n;
}

function responderErro(erro: unknown, res: Response, next: NextFunction) {
  if (erro instanceof ErroOperacao) res.status(erro.status).json({ sucesso: false, erro: erro.message });
  else next(erro);
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.query.agendamento === undefined ? null : inteiro(req.query.agendamento);
    const pagina = req.query.pagina === undefined ? 1 : inteiro(req.query.pagina);
    const estado = req.query.estado;
    if (estado !== undefined && (typeof estado !== 'string' || !estados.includes(estado))) throw new ErroOperacao(400, 'Estado inválido.');
    const atendimento = id === null ? null : await consultarAtendimento(id);
    const filtros: string[] = [];
    const params: (string | number)[] = [];
    if (id !== null) { filtros.push('c.id_agendamento = ?'); params.push(id); }
    if (typeof estado === 'string') { filtros.push('c.estado = ?'); params.push(estado); }
    const onde = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';
    const [dados] = await pool.query<RowDataPacket[]>(`SELECT c.id, c.id_agendamento, p.nome AS paciente,
      DATE_FORMAT(c.ocorrencia, '%Y-%m-%d %H:%i:%s') AS ocorrencia, c.tipo, c.canal, c.estado, c.provedor, c.tentativa,
      c.erro, c.referencia_externa, c.criado_em,
      NOT EXISTS (SELECT 1 FROM comunicacao_agendamento posterior
        WHERE posterior.id_agendamento = c.id_agendamento AND posterior.ocorrencia = c.ocorrencia
          AND posterior.tipo = c.tipo AND posterior.tentativa > c.tentativa) AS ultima_tentativa
      FROM comunicacao_agendamento c JOIN agendamento a ON c.id_agendamento = a.id_agendamento
      JOIN paciente p ON p.id_paciente = a.id_paciente ${onde} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
      [...params, limite + 1, (pagina - 1) * limite]);
    res.json({ sucesso: true, dados: dados.slice(0, limite), proxima: dados.length > limite, atendimento, provedor: obterProvedor()?.nome ?? null });
  } catch (erro) { responderErro(erro, res, next); }
});

router.post('/buscar-atendimentos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const termo = typeof req.body?.termo === 'string' ? req.body.termo.trim() : '';
    if (!termo || termo.length > 150) throw new ErroOperacao(400, 'Informe um termo de busca válido.');

    const digitos = termo.replace(/\D/g, '');
    const numero = /^[+\d().\s-]+$/.test(termo) ? digitos : '';
    const id = /^[1-9]\d*$/.test(termo) && Number(termo) <= 2147483647 ? Number(termo) : null;
    const [dados] = await pool.query<RowDataPacket[]>(`SELECT a.id_agendamento AS id, p.nome AS paciente,
      DATE_FORMAT(a.data_hora_agendamento, '%Y-%m-%d %H:%i:%s') AS ocorrencia, a.status,
      pr.nome AS profissional, s.nome AS procedimento
      FROM agendamento a JOIN paciente p ON p.id_paciente = a.id_paciente
      JOIN profissional pr ON pr.id_profissional = a.id_profissional
      JOIN procedimento s ON s.id_procedimento = a.id_procedimento
      WHERE a.id_agendamento = ? OR LOCATE(?, p.nome) > 0 OR (
        ? <> '' AND (
          REGEXP_REPLACE(p.cpf, '[^0-9]', '') = ? OR
          REGEXP_REPLACE(p.telefone, '[^0-9]', '') IN (?, ?) OR
          REGEXP_REPLACE(p.whatsapp, '[^0-9]', '') IN (?, ?)
        )
      )
      ORDER BY (a.id_agendamento <=> ?) DESC, a.data_hora_agendamento DESC, a.id_agendamento DESC LIMIT ?`,
      [id, termo, numero, numero, numero, telefoneAlternativo(numero), numero, telefoneAlternativo(numero), id, limite + 1]);
    res.json({ sucesso: true, dados: dados.slice(0, limite), temMais: dados.length > limite });
  } catch (erro) { responderErro(erro, res, next); }
});

function telefoneAlternativo(numero: string) {
  if (numero.length === 10 || numero.length === 11) return '55' + numero;
  if ((numero.length === 12 || numero.length === 13) && numero.startsWith('55')) return numero.slice(2);
  return numero;
}

router.post('/:agendamentoId/confirmacao', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = inteiro(req.params.agendamentoId);
    const { ocorrencia, tentativaAnterior } = req.body ?? {};
    if (typeof ocorrencia !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ocorrencia)) throw new ErroOperacao(400, 'Informe o horário consultado.');
    const dados = await confirmar(id, ocorrencia, tentativaAnterior === undefined ? null : inteiro(tentativaAnterior));
    res.json({ sucesso: true, dados });
  } catch (erro) { responderErro(erro, res, next); }
});

export default router;
