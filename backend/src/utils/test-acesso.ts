import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import type { RowDataPacket } from 'mysql2';
import pool from '../config/database.js';
import { identificarSessao, validarConfiguracaoSessao } from '../middleware/auth.js';

const executar = promisify(execFile);

export async function testarAcesso(verificar: (ok: boolean, descricao: string) => void) {
  const [bancos] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS nome');
  if (!/^ikigai_verificacao_\d+$/.test(bancos[0].nome)) throw new Error('A suíte de acesso exige um banco descartável.');
  const envOriginal = { ...process.env };
  process.env.NODE_ENV = 'test';
  process.env.TRUST_PROXY_LOOPBACK = 'true';
  process.env.SESSION_SECRET = randomBytes(48).toString('hex');
  const { app } = await import('../server.js');
  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const origem = 'http://127.0.0.1:' + (servidor.address() as AddressInfo).port;

  async function chamar(rota: string, metodo = 'GET', dados?: unknown, cookie?: string, https = false) {
    const headers: Record<string, string> = {};
    if (dados !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (https) headers['X-Forwarded-Proto'] = 'https';
    const resposta = await fetch(origem + '/api' + rota, {
      method: metodo, headers, body: dados === undefined ? undefined : JSON.stringify(dados),
    });
    const setCookie = resposta.headers.get('set-cookie') ?? '';
    return { status: resposta.status, json: await resposta.json() as Record<string, any>, setCookie, cookie: setCookie.split(';')[0] };
  }
  const senha = randomBytes(24).toString('hex');
  const dadosAdmin = { email: 'gestor@example.test', senha };
  const provisionar = (email: string, password: string) => executar(process.execPath,
    [fileURLToPath(new URL('../scripts/provisionar-admin.js', import.meta.url))],
    { env: { ...process.env, ADMIN_INITIAL_EMAIL: email, ADMIN_INITIAL_PASSWORD: password } });
  const migrar = () => executar(process.execPath, [fileURLToPath(new URL('../scripts/migrate.js', import.meta.url))]);
  const criar = (nome: string, email: string, perfil = 'RECEPCAO') => ({ nome, email, perfil, senha });
  const semSegredo = (dados: unknown) => !/senha|token/i.test(JSON.stringify(dados));
  try {
    verificar((await chamar('/health')).status === 200, 'Health público no Express completo.');
    verificar((await chamar('/usuarios')).status === 401, 'Rota protegida exige sessão.');
    const [contas] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM usuario');
    verificar(contas[0].n === 0, 'Instalação nova inicia sem credencial padrão.');
    const semConfig = await provisionar('', '').then(() => false, () => true);
    verificar(semConfig, 'Provisionamento recusa credenciais ausentes.');

    // Reproduz a estrutura da versão anterior ao módulo de acesso, no banco exclusivo da suíte.
    await pool.query('DROP TABLE sessao_usuario');
    await pool.query('DROP TABLE usuario');
    const [pacientesAntes] = await pool.query<RowDataPacket[]>('SELECT id_paciente FROM paciente ORDER BY id_paciente');
    await migrar();
    await provisionar(dadosAdmin.email, senha);
    await migrar();
    const [pacientesDepois] = await pool.query<RowDataPacket[]>('SELECT id_paciente FROM paciente ORDER BY id_paciente');
    verificar(pacientesAntes.length > 0 && JSON.stringify(pacientesAntes) === JSON.stringify(pacientesDepois),
      'Migração e reaplicação preservam registros legados e permitem provisionar administrador.');
    verificar(await provisionar('segundo@example.test', senha).then(() => false, () => true),
      'Provisionamento recusa um segundo administrador.');

    const admin = await chamar('/auth/login', 'POST', dadosAdmin);
    verificar(admin.status === 200 && !!admin.cookie && semSegredo(admin.json), 'Administrador provisionado entra sem expor senha ou token no JSON.');
    verificar(/HttpOnly/i.test(admin.setCookie) && /SameSite=Lax/i.test(admin.setCookie) && /Max-Age=43200/i.test(admin.setCookie),
      'Cookie HttpOnly possui prazo de 12 horas e SameSite=Lax.');
    const cookie = admin.cookie;
    const adminId = admin.json.dados.usuario.id;
    verificar((await chamar('/dashboard/especialidades', 'GET', undefined, cookie)).status === 200, 'ADMIN acessa os indicadores.');
    verificar((await chamar('/sem-regra', 'GET', undefined, cookie)).status === 403, 'Recurso sem política tem acesso negado inclusive para ADMIN.');
    verificar((await chamar('/auth/me', 'GET', undefined, cookie)).json.dados.id === adminId, 'Sessão identifica o administrador.');
    const inexistente = await chamar('/auth/login', 'POST', { ...dadosAdmin, email: 'ausente@example.test' });
    const incorreta = await chamar('/auth/login', 'POST', { ...dadosAdmin, senha: senha + 'x' });
    verificar(inexistente.status === 401 && incorreta.status === 401 && JSON.stringify(inexistente.json) === JSON.stringify(incorreta.json),
      'E-mail desconhecido e senha incorreta produzem a mesma resposta.');

    const recepcao = criar('Recepção Fictícia', 'recepcao@example.test');
    const duas = await Promise.all([chamar('/usuarios', 'POST', recepcao, cookie),
      chamar('/usuarios', 'POST', { ...recepcao, email: ' RECEPCAO@example.test ' }, cookie)]);
    verificar(duas.map(res => res.status).sort().join() === '201,409', 'Cadastro concorrente normaliza o e-mail e retorna conflito.');
    const nova = duas.find(res => res.status === 201)!;
    const id = nova.json.dados.id;
    const rota = '/usuarios/' + id;
    const lista = await chamar('/usuarios', 'GET', undefined, cookie);
    verificar(lista.json.dados.some((u: { id: number }) => u.id === id) && semSegredo(lista.json) && semSegredo(nova.json),
      'Listagem e cadastro retornam os dados públicos para pesquisa.');
    const login = () => chamar('/auth/login', 'POST', recepcao);
    const usuario = await login();
    verificar((await chamar('/pacientes', 'GET', undefined, usuario.cookie)).status === 200 &&
      (await chamar('/dashboard/especialidades', 'GET', undefined, usuario.cookie)).status === 200 &&
      (await chamar('/servicos', 'POST', {}, usuario.cookie)).status === 403, 'RECEPCAO consulta pacientes e indicadores, mas não cadastra serviços.');
    verificar((await chamar('/usuarios', 'GET', undefined, usuario.cookie)).status === 403, 'Recepção tem a gestão de usuários negada.');
    const pacienteRapido = await chamar('/pacientes/rapido', 'POST', {
      nome_completo: 'Paciente fictício da recepção', whatsapp: '11987654321',
    }, usuario.cookie);
    verificar(pacienteRapido.status === 201 && !!pacienteRapido.json.dados?.id &&
      pacienteRapido.json.dados.whatsapp === '11987654321',
      'RECEPCAO cadastra paciente pelo formulário rápido sem CPF.');
    for (const dados of [{}, { ativo: 'false' }, { ativo: null }, { ativo: 0 }]) {
      verificar((await chamar(rota + '/status', 'PATCH', dados, cookie)).status === 400, 'PATCH rejeita ' + JSON.stringify(dados));
    }
    verificar((await chamar('/auth/me', 'GET', undefined, usuario.cookie)).status === 200, 'PATCH inválido preserva conta e sessão.');
    verificar((await chamar(rota, 'PUT', { ...recepcao, email: dadosAdmin.email }, cookie)).status === 409, 'Edição rejeita e-mail duplicado.');
    const edicao = await chamar(rota, 'PUT', { ...recepcao, senha: '', nome: 'Nome atualizado', perfil: 'PROFISSIONAL' }, cookie);
    verificar(edicao.status === 200 && edicao.json.dados.profissional_id > 0 && semSegredo(edicao.json) && (await chamar('/auth/me', 'GET', undefined, usuario.cookie)).json.dados.perfil === 'PROFISSIONAL',
      'Nome e perfil são editados e a sessão reflete o perfil na próxima chamada.');
    verificar((await chamar('/agendamentos/dia?data=2026-11-23', 'GET', undefined, usuario.cookie)).status === 200 &&
      (await chamar('/servicos', 'POST', {}, usuario.cookie)).status === 403 &&
      (await chamar('/profissionais/' + (edicao.json.dados.profissional_id + 1) + '/jornada', 'PUT', {}, usuario.cookie)).status === 403 &&
      (await chamar('/pacientes', 'GET', undefined, usuario.cookie)).status === 200 &&
      (await chamar('/dashboard/especialidades', 'GET', undefined, usuario.cookie)).status === 403,
      'PROFISSIONAL consulta agenda e pacientes, só edita a própria jornada e não acessa indicadores ou cadastro de serviços.');
    verificar((await chamar(rota + '/status', 'PATCH', { ativo: false }, cookie)).status === 200, 'Administrador desativa a conta.');
    const inativo = await login();
    verificar(inativo.status === 401 && JSON.stringify(inativo.json) === JSON.stringify(incorreta.json), 'Conta inativa recebe o mesmo erro de login.');
    verificar((await chamar('/auth/me', 'GET', undefined, usuario.cookie)).status === 401, 'Desativação invalida a sessão existente.');
    verificar((await chamar(rota + '/status', 'PATCH', { ativo: true }, cookie)).status === 200 &&
      (await chamar('/auth/me', 'GET', undefined, usuario.cookie)).status === 401 && (await login()).status === 200,
      'Reativação mantém o cadastro e exige um novo login.');
    verificar((await chamar('/usuarios/' + adminId + '/status', 'PATCH', { ativo: false }, cookie)).status === 409 &&
      (await chamar('/usuarios/' + adminId, 'PUT', criar('Gestor', dadosAdmin.email), cookie)).status === 409,
      'Administrador não pode se desativar nem remover seu próprio perfil.');

    const descartavel = criar('Conta para exclusão', 'exclusao@example.test');
    const criada = await chamar('/usuarios', 'POST', descartavel, cookie);
    const rotaExcluir = '/usuarios/' + criada.json.dados.id;
    const sessaoDescartavel = await chamar('/auth/login', 'POST', descartavel);
    verificar(sessaoDescartavel.status === 200 &&
      (await chamar(rotaExcluir, 'DELETE', undefined, sessaoDescartavel.cookie)).status === 403 &&
      (await chamar('/usuarios/' + adminId, 'DELETE', undefined, cookie)).status === 409,
      'Exclusão de usuário exige perfil administrativo e bloqueia a própria conta.');
    verificar((await chamar(rotaExcluir, 'DELETE', undefined, cookie)).status === 200 &&
      (await chamar(rotaExcluir, 'DELETE', undefined, cookie)).status === 404 &&
      (await chamar('/auth/me', 'GET', undefined, sessaoDescartavel.cookie)).status === 401,
      'Exclusão remove a conta e invalida a sessão.');

    const novoAdmin = criar('Administrador Fictício', 'outro@example.test', 'ADMIN');
    const segundo = await chamar('/usuarios', 'POST', novoAdmin, cookie);
    const sessaoSegundo = await chamar('/auth/login', 'POST', novoAdmin);
    const mutuas = await Promise.all([
      chamar('/usuarios/' + segundo.json.dados.id + '/status', 'PATCH', { ativo: false }, cookie),
      chamar('/usuarios/' + adminId, 'PUT', criar('Gestor', dadosAdmin.email), sessaoSegundo.cookie)
    ]);
    const [admins] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM usuario WHERE perfil = 'ADMIN' AND ativo = 1");
    verificar(mutuas.filter(resp => resp.status === 200).length === 1 && admins[0].n === 1, 'Operações simultâneas preservam um administrador ativo.');

    const expira = await login();
    await pool.query('UPDATE sessao_usuario SET expira_em = UTC_TIMESTAMP() WHERE identificador = ?', [identificarSessao(expira.cookie.split('=')[1])]);
    verificar((await chamar('/auth/me', 'GET', undefined, expira.cookie)).status === 401, 'Servidor rejeita sessão ao atingir o prazo.');
    const sair = await login();
    const encerrada = await chamar('/auth/logout', 'POST', {}, sair.cookie);
    verificar(encerrada.status === 200 && /Expires=/i.test(encerrada.setCookie) &&
      (await chamar('/auth/me', 'GET', undefined, sair.cookie)).status === 401, 'Logout limpa o cookie e revoga a sessão no banco.');

    process.env.NODE_ENV = 'production';
    const producao = await chamar('/auth/login', 'POST', recepcao, undefined, true);
    verificar(producao.status === 200 && /; Secure(;|$)/i.test(producao.setCookie) &&
      (await chamar('/auth/login', 'POST', recepcao)).status === 403, 'Publicação exige HTTPS e emite cookie Secure pelo proxy local.');
    delete process.env.SESSION_SECRET;
    delete process.env.JWT_SECRET;
    let rejeitado = false;
    try { validarConfiguracaoSessao(); } catch { rejeitado = true; }
    verificar(rejeitado, 'Produção recusa configuração sem segredo.');
  } finally {
    await new Promise<void>(resolve => { servidor.close(() => resolve()); servidor.closeAllConnections(); });
    for (const chave of ['NODE_ENV', 'TRUST_PROXY_LOOPBACK', 'SESSION_SECRET', 'JWT_SECRET']) {
      if (envOriginal[chave] === undefined) delete process.env[chave]; else process.env[chave] = envOriginal[chave];
    }
  }
}
