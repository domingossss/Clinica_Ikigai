import type { RequestHandler } from 'express';

// Cada operação publicada pela API deve constar aqui antes de ser montada.
const operacao = 'operacao';
const leitura = 'agenda';
const profissional = 'profissional';
const recepcao = 'recepcao';
const admin = 'admin';
type Regra = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', typeof operacao | typeof admin | typeof leitura | typeof profissional | typeof recepcao>>;
const regras: [RegExp, Regra][] = [
  [/^\/usuarios$/, { GET: admin, POST: admin }],
  [/^\/usuarios\/\d+$/, { PUT: admin, DELETE: admin }],
  [/^\/usuarios\/\d+\/status$/, { PATCH: admin }],
  [/^\/dashboard\/(dados-painel|especialidades)$/, { GET: recepcao }],
  [/^\/(eventos|janelas|disponibilidade|agendamentos\/dia)$/, { GET: leitura }],
  [/^\/expediente-clinica$/, { GET: admin, PUT: admin }],
  [/^\/agenda\/pacientes$/, { GET: profissional }],
  [/^\/agendamentos$/, { POST: leitura }],
  [/^\/agendamentos\/\d+\/status$/, { PUT: leitura }],
  [/^\/agendamentos\/\d+\/reagendar$/, { PUT: recepcao }],
  [/^\/agendamentos\/\d+\/historico$/, { GET: admin }],
  [/^\/pacientes$/, { GET: leitura, POST: operacao }],
  [/^\/pacientes\/rapido$/, { POST: operacao }],
  [/^\/pacientes\/[A-Za-z0-9-]+$/, { GET: leitura, PUT: leitura, DELETE: admin }],
  [/^\/pacientes\/[A-Za-z0-9-]+\/historico$/, { GET: leitura }],
  [/^\/pacientes\/[A-Za-z0-9-]+\/prontuario$/, { GET: leitura, PUT: leitura }],
  [/^\/(profissionais|categorias)$/, { GET: leitura, POST: admin }],
  [/^\/(profissionais|servicos|categorias)\/\d+$/, { PUT: admin, DELETE: admin }],
  [/^\/servicos$/, { GET: leitura, POST: admin }],
  [/^\/excecoes$/, { GET: admin, POST: admin }],
  [/^\/excecoes\/\d+$/, { DELETE: admin }],
  [/^\/(profissionais|servicos)\/\d+\/status$/, { PATCH: admin, PUT: admin }],
  [/^\/profissionais\/\d+\/procedimentos$/, { GET: leitura, PUT: profissional, POST: profissional }],
  [/^\/profissionais\/\d+\/procedimentos\/\d+$/, { PUT: profissional, PATCH: profissional, DELETE: profissional }],
  [/^\/profissionais\/\d+\/jornada$/, { GET: leitura, PUT: profissional }],
  [/^\/profissionais\/\d+\/agenda$/, { GET: leitura }],
  [/^\/(servicos|procedimentos)\/\d+\/profissionais$/, { GET: leitura }],
  [/^\/bloqueios$/, { GET: leitura, POST: leitura }],
  [/^\/bloqueios\/\d+$/, { DELETE: leitura }],
  [/^\/comunicacoes$/, { GET: admin }],
  [/^\/comunicacoes\/buscar-atendimentos$/, { POST: admin }],
  [/^\/comunicacoes\/\d+\/confirmacao$/, { POST: admin }],
  [/^\/comunicacoes\/\d+\/confirmacao\/whatsapp$/, { GET: admin }],
  [/^\/comunicacoes\/whatsapp\/painel$/, { GET: recepcao }],
  [/^\/comunicacoes\/whatsapp\/transbordos\/\d+\/resolver$/, { PATCH: recepcao }],
  [/^\/comunicacoes\/whatsapp\/processar-lembretes$/, { POST: admin }],
];

export const controlarPermissoesApi: RequestHandler = (req, res, next) => {
  const caminho = req.path.replace(/\/+$/, '');
  const metodo = req.method === 'HEAD' ? 'GET' : req.method;
  const regra = regras.find(([padrao]) => padrao.test(caminho))?.[1][metodo as keyof Regra];
  const perfil = req.usuario?.perfil;
  if (regra && (perfil === 'ADMIN' || (perfil === 'RECEPCAO' && [operacao, leitura, recepcao].includes(regra)) || (perfil === 'PROFISSIONAL' && [profissional, leitura].includes(regra)))) return next();
  res.status(403).json({ sucesso: false, erro: 'Seu perfil não tem permissão para esta operação.' });
};
