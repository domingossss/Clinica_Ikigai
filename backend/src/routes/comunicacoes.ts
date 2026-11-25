import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool, { ErroOperacao } from '../config/database.js';
import { publicarAlteracao } from '../services/alteracoesClinica.js';
import { confirmar, consultarAtendimento, prepararConfirmacaoWhatsApp, processarFila } from '../services/comunicacoes.js';
import { obterProvedor } from '../services/provedorMensagens.js';
import { obterStatusConexaoWhatsApp } from '../services/whatsappRuntime.js';

const router = Router();
const estados = ['PENDENTE', 'SUBMETIDA', 'ENTREGUE', 'FALHA', 'INCERTA'];
const tiposComunicacao = ['LEMBRETE', 'CONFIRMACAO'];
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

function horarioConsultado(ocorrencia: unknown) {
  if (typeof ocorrencia !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ocorrencia)) {
    throw new ErroOperacao(400, 'Informe o horário consultado.');
  }
  return ocorrencia;
}

router.get('/:agendamentoId/confirmacao/whatsapp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = await prepararConfirmacaoWhatsApp(inteiro(req.params.agendamentoId), horarioConsultado(req.query.ocorrencia));
    if (req.query.formato === 'json') { res.json({ dados: { url: link } }); return; }
    res.redirect(link);
  } catch (erro) { responderErro(erro, res, next); }
});

router.post('/:agendamentoId/confirmacao', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = inteiro(req.params.agendamentoId);
    const { ocorrencia, tentativaAnterior } = req.body ?? {};
    const dados = await confirmar(id, horarioConsultado(ocorrencia), tentativaAnterior === undefined ? null : inteiro(tentativaAnterior));
    res.json({ sucesso: true, dados });
  } catch (erro) { responderErro(erro, res, next); }
});

router.get('/whatsapp/painel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const estado = req.query.estado;
    const tipo = req.query.tipo;
    if (estado !== undefined && estado !== '' && (typeof estado !== 'string' || !estados.includes(estado))) {
      throw new ErroOperacao(400, 'Estado inválido.');
    }
    if (tipo !== undefined && tipo !== '' && (typeof tipo !== 'string' || !tiposComunicacao.includes(tipo))) {
      throw new ErroOperacao(400, 'Tipo de comunicação inválido.');
    }

    const provedor = obterProvedor();
    const statusBaileys = obterStatusConexaoWhatsApp();
    const conexao = {
      ...statusBaileys,
      provedorAtivo: provedor?.nome ?? null,
      prontoParaEnvio: Boolean(provedor && (!provedor.pronto || provedor.pronto()))
    };

    const [transbordosRows] = await pool.query<RowDataPacket[]>(`
      SELECT sc.id_sessao,
             sc.identificador_chat,
             DATE_FORMAT(sc.data_hora_inicio, '%Y-%m-%d %H:%i:%s') AS data_hora_inicio,
             DATE_FORMAT(sc.data_hora_fim, '%Y-%m-%d %H:%i:%s') AS data_hora_fim,
             sc.status_sessao,
             sc.escalonado_humano,
             wsc.etapa,
             wsc.intencao_atual,
             wsc.contexto_json,
             p.uuid AS paciente_uuid,
             p.nome AS paciente_nome,
             RIGHT(REGEXP_REPLACE(COALESCE(p.whatsapp, p.telefone, ''), '[^0-9]', ''), 4) AS paciente_contato_final
      FROM sessao_chatbot sc
      LEFT JOIN whatsapp_sessao_conversa wsc ON wsc.id_sessao_chatbot = sc.id_sessao
      LEFT JOIN paciente p ON p.uuid = wsc.paciente_uuid
      WHERE sc.escalonado_humano = 1
      ORDER BY (sc.status_sessao = 'Em_Andamento') DESC, sc.data_hora_inicio DESC, sc.id_sessao DESC
      LIMIT 50
    `);

    const transbordos = transbordosRows.map(row => {
      let contexto: { contatoFinal?: string; escalonadoMotivo?: string; escalonadoEm?: string } = {};
      if (typeof row.contexto_json === 'string' && row.contexto_json) {
        try {
          contexto = JSON.parse(row.contexto_json);
        } catch {
          contexto = {};
        }
      }
      const contatoFinal =
        (typeof row.paciente_contato_final === 'string' && row.paciente_contato_final.length > 0
          ? row.paciente_contato_final
          : contexto.contatoFinal) || null;

      return {
        id_sessao: Number(row.id_sessao),
        identificador_chat: String(row.identificador_chat),
        data_hora_inicio: String(row.data_hora_inicio),
        data_hora_fim: row.data_hora_fim ? String(row.data_hora_fim) : null,
        status_sessao: String(row.status_sessao),
        escalonado_humano: Number(row.escalonado_humano),
        pendente: row.status_sessao === 'Em_Andamento',
        etapa: row.etapa ? String(row.etapa) : null,
        intencao_atual: row.intencao_atual ? String(row.intencao_atual) : null,
        paciente_uuid: row.paciente_uuid ? String(row.paciente_uuid) : null,
        paciente_nome: row.paciente_nome ? String(row.paciente_nome) : null,
        contato_final: contatoFinal,
        motivo: contexto.escalonadoMotivo || 'Solicitação de atendimento humano via WhatsApp'
      };
    });

    const [agendamentosEscalonados] = await pool.query<RowDataPacket[]>(`
      SELECT a.id_agendamento AS id,
             p.nome AS paciente,
             RIGHT(REGEXP_REPLACE(COALESCE(p.whatsapp, p.telefone, ''), '[^0-9]', ''), 4) AS contato_final,
             DATE_FORMAT(a.data_hora_agendamento, '%Y-%m-%d %H:%i:%s') AS ocorrencia,
             a.status,
             pr.nome AS profissional,
             s.nome AS procedimento
      FROM agendamento a
      JOIN paciente p ON p.id_paciente = a.id_paciente
      LEFT JOIN profissional pr ON pr.id_profissional = a.id_profissional
      LEFT JOIN procedimento s ON s.id_procedimento = a.id_procedimento
      WHERE a.escalonado_humano = 1
      ORDER BY a.data_hora_agendamento DESC, a.id_agendamento DESC
      LIMIT 30
    `);

    const filtrosCom: string[] = [];
    const paramsCom: (string | number)[] = [];
    if (typeof estado === 'string' && estado) {
      filtrosCom.push('c.estado = ?');
      paramsCom.push(estado);
    }
    if (typeof tipo === 'string' && tipo) {
      filtrosCom.push('c.tipo = ?');
      paramsCom.push(tipo);
    }
    const ondeCom = filtrosCom.length ? 'WHERE ' + filtrosCom.join(' AND ') : '';

    const [comunicacoes] = await pool.query<RowDataPacket[]>(`
      SELECT c.id,
             c.id_agendamento,
             p.nome AS paciente,
             DATE_FORMAT(c.ocorrencia, '%Y-%m-%d %H:%i:%s') AS ocorrencia,
             c.tipo,
             c.canal,
             c.estado,
             c.provedor,
             c.tentativa,
             c.erro,
             c.referencia_externa,
             c.criado_em,
             a.status AS status_agendamento,
             pr.nome AS profissional,
             s.nome AS procedimento
      FROM comunicacao_agendamento c
      JOIN agendamento a ON c.id_agendamento = a.id_agendamento
      JOIN paciente p ON p.id_paciente = a.id_paciente
      LEFT JOIN profissional pr ON pr.id_profissional = a.id_profissional
      LEFT JOIN procedimento s ON s.id_procedimento = a.id_procedimento
      ${ondeCom}
      ORDER BY c.id DESC
      LIMIT 30
    `, paramsCom);

    const [totaisComRows] = await pool.query<RowDataPacket[]>(`
      SELECT COUNT(*) AS total,
             SUM(estado = 'ENTREGUE') AS entregues,
             SUM(estado = 'SUBMETIDA') AS submetidas,
             SUM(estado = 'FALHA') AS falhas
      FROM comunicacao_agendamento
    `);

    const [avaliacoesRecentes] = await pool.query<RowDataPacket[]>(`
      SELECT av.id_avaliacao,
             av.id_agendamento,
             av.nota_nps,
             av.comentario,
             DATE_FORMAT(av.data_resposta, '%Y-%m-%d %H:%i:%s') AS data_resposta,
             p.nome AS paciente,
             s.nome AS procedimento,
             pr.nome AS profissional
      FROM avaliacao_atendimento av
      JOIN agendamento a ON a.id_agendamento = av.id_agendamento
      JOIN paciente p ON p.id_paciente = a.id_paciente
      LEFT JOIN procedimento s ON s.id_procedimento = a.id_procedimento
      LEFT JOIN profissional pr ON pr.id_profissional = a.id_profissional
      ORDER BY av.data_resposta DESC, av.id_avaliacao DESC
      LIMIT 10
    `);

    const totaisCom = totaisComRows[0] || {};
    const transbordosPendentes = transbordos.filter(t => t.pendente).length;
    const mediaNpsRecente = avaliacoesRecentes.length
      ? Number((avaliacoesRecentes.reduce((acc, item) => acc + Number(item.nota_nps), 0) / avaliacoesRecentes.length).toFixed(1))
      : null;

    res.json({
      sucesso: true,
      dados: {
        conexao,
        transbordos,
        agendamentosEscalonados,
        comunicacoes,
        avaliacoesRecentes,
        resumo: {
          transbordosPendentes,
          transbordosTotal: transbordos.length,
          agendamentosEscalonadosTotal: agendamentosEscalonados.length,
          comunicacoesTotal: Number(totaisCom.total || 0),
          comunicacoesEntregues: Number(totaisCom.entregues || 0),
          comunicacoesSubmetidas: Number(totaisCom.submetidas || 0),
          comunicacoesFalhas: Number(totaisCom.falhas || 0),
          avaliacoesTotal: avaliacoesRecentes.length,
          mediaNpsRecente
        }
      }
    });
  } catch (erro) { responderErro(erro, res, next); }
});

router.patch('/whatsapp/transbordos/:idSessao/resolver', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idSessao = inteiro(req.params.idSessao);
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE sessao_chatbot
       SET status_sessao = 'Duvida_Resolvida',
           data_hora_fim = COALESCE(data_hora_fim, NOW())
       WHERE id_sessao = ? AND escalonado_humano = 1`,
      [idSessao]
    );
    if (result.affectedRows === 0) {
      throw new ErroOperacao(404, 'Sessão com transbordo humano não encontrada.');
    }
    void publicarAlteracao('comunicacoes');
    res.json({
      sucesso: true,
      mensagem: 'Transbordo humano marcado como atendido.',
      dados: { id_sessao: idSessao, status_sessao: 'Duvida_Resolvida' }
    });
  } catch (erro) { responderErro(erro, res, next); }
});

router.post('/whatsapp/processar-lembretes', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const resultado = await processarFila();
    res.json({ sucesso: true, dados: resultado });
  } catch (erro) { responderErro(erro, res, next); }
});

export default router;
