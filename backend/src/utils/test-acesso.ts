import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import type { RowDataPacket } from 'mysql2';
import pool from '../config/database.js';
import { identificarSessao, validarConfiguracaoSessao } from '../middleware/auth.js';
import { resolverJanelasAgenda, validarPeriodoAgenda } from './validation.js';
import { janelaLembrete } from '../services/comunicacoes.js';

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

  async function chamar(rota: string, metodo = 'GET', dados?: unknown, cookie?: string, https = false, origemInvalida = false) {
    const headers: Record<string, string> = {};
    if (dados !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (https) {
      headers['X-Forwarded-Proto'] = 'https';
      if (!origemInvalida) headers.Origin = origem.replace(/^http:/, 'https:');
    }
    if (origemInvalida) headers.Origin = 'http://site-malicioso.test';
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
    const profissionaisAgrupados = await chamar('/profissionais?incluir=procedimentos', 'GET', undefined, cookie);
    const listaAgrupada = profissionaisAgrupados.json.dados as { id: number; procedimento_ids: number[] }[];
    const vinculoIndividual = await chamar(`/profissionais/${listaAgrupada[0].id}/procedimentos`, 'GET', undefined, cookie);
    verificar(profissionaisAgrupados.status === 200 && listaAgrupada.every(p => Array.isArray(p.procedimento_ids)) &&
      [...listaAgrupada[0].procedimento_ids].sort().join() === [...vinculoIndividual.json.procedimento_ids].sort().join(),
      'Listagem administrativa em lote preserva os vínculos individuais dos profissionais.');
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
    verificar((await chamar('/pacientes/' + pacienteRapido.json.dados.id, 'PUT', {
      versao: 0, historico_clinico: 'Alteração clínica fictícia',
    }, usuario.cookie)).status === 403, 'Recepção não pode sobrescrever a evolução clínica.');
    for (const dados of [{}, { ativo: 'false' }, { ativo: null }, { ativo: 0 }]) {
      verificar((await chamar(rota + '/status', 'PATCH', dados, cookie)).status === 400, 'PATCH rejeita ' + JSON.stringify(dados));
    }
    verificar((await chamar('/auth/me', 'GET', undefined, usuario.cookie)).status === 200, 'PATCH inválido preserva conta e sessão.');
    verificar((await chamar(rota, 'PUT', { ...recepcao, email: dadosAdmin.email }, cookie)).status === 409, 'Edição rejeita e-mail duplicado.');
    const edicao = await chamar(rota, 'PUT', { ...recepcao, senha: '', nome: 'Nome atualizado', perfil: 'PROFISSIONAL' }, cookie);
    verificar(edicao.status === 200 && edicao.json.dados.profissional_id > 0 && semSegredo(edicao.json) && (await chamar('/auth/me', 'GET', undefined, usuario.cookie)).json.dados.perfil === 'PROFISSIONAL',
      'Nome e perfil são editados e a sessão reflete o perfil na próxima chamada.');
    const outro = criar('Segundo profissional fictício', 'profissional-2@example.test', 'PROFISSIONAL');
    const outroCadastro = await chamar('/usuarios', 'POST', outro, cookie);
    const outraSessao = await chamar('/auth/login', 'POST', outro);
    const profissionalId = edicao.json.dados.profissional_id;
    const outroProfissionalId = outroCadastro.json.dados.profissional_id;
    verificar(outroCadastro.status === 201 && outraSessao.status === 200 && outroProfissionalId !== profissionalId,
      'Profissionais têm sessões e vínculos de agenda independentes.');
    verificar((await chamar('/usuarios', 'POST', {
      ...outro, email: 'vinculo-duplicado@example.test', profissional_id: outroProfissionalId,
    }, cookie)).status === 409, 'IK-98: o cadastro rejeita vínculo de agenda duplicado.');

    verificar((await chamar('/agendamentos/dia?data=2026-11-23', 'GET', undefined, usuario.cookie)).status === 200 &&
      (await chamar('/pacientes', 'GET', undefined, usuario.cookie)).status === 200 &&
      (await chamar('/dashboard/especialidades', 'GET', undefined, usuario.cookie)).status === 403,
      'Profissional consulta agenda e pacientes e tem os indicadores restritos.');
    const rotasAdministrativas = ['/servicos', '/categorias', '/profissionais', '/excecoes'];
    const alteracoesGlobais = await Promise.all(rotasAdministrativas.map(caminho => chamar(caminho, 'POST', {}, usuario.cookie)));
    verificar(alteracoesGlobais.every(resp => resp.status === 403), 'IK-99 CA01: somente administrador pode alterar configurações globais.');

    const pacienteRota = '/pacientes/' + pacienteRapido.json.dados.id;
    const pacienteId = pacienteRapido.json.dados.id;
    const buscaAgenda = await chamar('/agenda/pacientes?busca=Paciente%20fict%C3%ADcio%20da%20recep%C3%A7%C3%A3o&agenda=true', 'GET', undefined, usuario.cookie);
    verificar(buscaAgenda.json.dados?.some((p: { id: string; nome: string }) => p.id === pacienteId && Object.keys(p).length === 2) &&
      (await chamar(pacienteRota, 'GET', undefined, usuario.cookie)).status === 404,
      'Reserva excepcional encontra nome e identificador sem liberar prontuário antes do vínculo.');
    await pool.query(`INSERT INTO agendamento (paciente_uuid,id_profissional,id_procedimento,data,horario_inicio,horario_fim,status)
      VALUES (?, ?, 1, '2040-03-01', '16:00:00', '17:00:00', 'Realizado'),
             (?, ?, 1, '2040-03-02', '16:00:00', '17:00:00', 'Cancelado')`,
      [pacienteId, profissionalId, pacienteId, outroProfissionalId]);
    const listaOutro = await chamar('/pacientes?busca=Paciente%20fict%C3%ADcio%20da%20recep%C3%A7%C3%A3o', 'GET', undefined, outraSessao.cookie);
    const listaPropria = await chamar('/pacientes?busca=Paciente%20fict%C3%ADcio%20da%20recep%C3%A7%C3%A3o', 'GET', undefined, usuario.cookie);
    const historicoProprio = await chamar(pacienteRota + '/historico', 'GET', undefined, usuario.cookie);
    verificar(listaOutro.json.total === 0 && listaPropria.json.total === 1 && historicoProprio.json.dados?.total === 1 &&
      (await chamar(pacienteRota, 'GET', undefined, outraSessao.cookie)).status === 404 &&
      (await chamar(pacienteRota + '/historico', 'GET', undefined, outraSessao.cookie)).status === 404 &&
      (await chamar(pacienteRota, 'PUT', { versao: 0, observacoes: 'Teste de isolamento' }, outraSessao.cookie)).status === 404,
      'Só o profissional com atendimento elegível consulta ou grava prontuário e seu histórico traz apenas seus atendimentos.');
    const antes = await chamar(pacienteRota, 'GET', undefined, usuario.cookie);
    const evolucao = { etapa_tratamento: 'Retorno', historico_clinico: 'Histórico fictício', observacoes: 'Observação fictícia' };
    const alterado = await chamar(pacienteRota, 'PUT', {
      ...evolucao, versao: antes.json.dados.versao, nome_completo: 'Outro nome', cpf: '00000000000',
      telefone: '11900000000', whatsapp: '11800000000', endereco: 'Outro endereço',
    }, usuario.cookie);
    const depois = await chamar(pacienteRota, 'GET', undefined, cookie);
    verificar(alterado.status === 200 && Object.entries(evolucao).every(([campo, valor]) => alterado.json.dados[campo] === valor) &&
      depois.json.dados.etapa_tratamento === evolucao.etapa_tratamento &&
      ['nome_completo', 'cpf', 'telefone', 'whatsapp', 'endereco'].every(campo => depois.json.dados[campo] === antes.json.dados[campo]),
      'IK-99 CA02: a evolução clínica é salva e os dados cadastrais permanecem intactos.');
    const [versoesClinicas] = await pool.query<RowDataPacket[]>(`SELECT autor_id, anterior, posterior FROM paciente_evolucao
      WHERE paciente_uuid = ? AND versao = 1`, [pacienteId]);
    verificar(Number(versoesClinicas[0]?.autor_id) === Number(edicao.json.dados.id) &&
      versoesClinicas[0]?.anterior.historico_clinico === null &&
      versoesClinicas[0]?.posterior.historico_clinico === evolucao.historico_clinico,
      'Evolução clínica guarda autoria e versões anterior e posterior.');
    verificar((await chamar(pacienteRota, 'DELETE', undefined, usuario.cookie)).status === 403,
      'IK-99 CA02: profissional não pode excluir paciente.');

    const jornada = `/profissionais/${profissionalId}/jornada`;
    const outraJornada = `/profissionais/${outroProfissionalId}/jornada`;
    const dia = { dia_semana: 1, ativo: true, horario_inicio: '09:00', horario_fim: '17:00', intervalo_inicio: '12:30', intervalo_fim: '13:30' };
    const gravarJornada = await chamar(jornada, 'PUT', { dias: [dia] }, usuario.cookie);
    const lerJornada = await chamar(jornada, 'GET', undefined, usuario.cookie);
    verificar(gravarJornada.status === 200 && lerJornada.status === 200 &&
      lerJornada.json.dados[1].horario_inicio === dia.horario_inicio && lerJornada.json.dados[1].intervalo_inicio === dia.intervalo_inicio,
      'IK-99 CA03: profissional salva e consulta expediente e intervalo próprios.');
    verificar((await chamar(outraJornada, 'GET', undefined, usuario.cookie)).status === 403 &&
      (await chamar(outraJornada, 'PUT', { dias: [dia] }, usuario.cookie)).status === 403 &&
      (await chamar(jornada, 'GET', undefined, outraSessao.cookie)).status === 403 &&
      (await chamar(outraJornada, 'GET', undefined, cookie)).status === 200,
      'IK-99 CA03: profissionais não consultam ou alteram jornada de terceiros e administrador mantém acesso.');

    const horario = { data: '2040-03-01', horario_inicio: '15:00', horario_fim: '15:30' };
    const bloqueio = await chamar('/bloqueios', 'POST', { ...horario, profissional_id: profissionalId }, usuario.cookie);
    const bloqueioRota = '/bloqueios/' + bloqueio.json.dados?.id;
    verificar(bloqueio.status === 201 &&
      (await chamar('/bloqueios', 'POST', { ...horario, profissional_id: outroProfissionalId }, usuario.cookie)).status === 403 &&
      (await chamar(bloqueioRota, 'DELETE', undefined, outraSessao.cookie)).status === 403 &&
      (await chamar(bloqueioRota, 'DELETE', undefined, usuario.cookie)).status === 200,
      'IK-99 CA03: profissionais só criam e removem bloqueios nas próprias agendas.');

    await pool.query('DELETE FROM agendamento WHERE paciente_uuid = ?', [pacienteId]);
    const outroUsuarioRota = '/usuarios/' + outroCadastro.json.dados.id;
    verificar((await chamar('/profissionais/' + outroProfissionalId, 'DELETE', undefined, cookie)).status === 200,
      'Exclusão do cadastro na grade preserva a conta profissional para reassociação administrativa.');
    const semVinculo = await chamar('/auth/login', 'POST', outro);
    verificar(semVinculo.status === 401 && JSON.stringify(semVinculo.json) === JSON.stringify(incorreta.json) &&
      (await chamar('/auth/me', 'GET', undefined, outraSessao.cookie)).status === 401 &&
      (await chamar('/pacientes', 'GET', undefined, outraSessao.cookie)).status === 401,
      'IK-98: conta profissional sem vínculo perde acesso por login e por sessão existente.');
    const reassociado = await chamar(outroUsuarioRota, 'PUT', { ...outro, senha: '' }, cookie);
    verificar(reassociado.status === 200 && reassociado.json.dados.profissional_id > 0 &&
      (await chamar('/auth/me', 'GET', undefined, outraSessao.cookie)).status === 401 &&
      (await chamar('/auth/login', 'POST', outro)).status === 200,
      'IK-98: novo vínculo permite novo login e exige descartar a sessão anterior.');
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

    // ── CT-01: Prontuário RBAC, validação de chegada, lock otimista e preservação de histórico ──
    const recepcaoPront = criar('Recepção Prontuário', 'recepcao-pront@example.test', 'RECEPCAO');
    await chamar('/usuarios', 'POST', recepcaoPront, cookie);
    const sessaoRecepcao = await chamar('/auth/login', 'POST', recepcaoPront);
    const profPront = criar('Profissional Prontuário', 'prof-pront@example.test', 'PROFISSIONAL');
    const profProntCad = await chamar('/usuarios', 'POST', profPront, cookie);
    const sessaoProfPront = await chamar('/auth/login', 'POST', profPront);
    const profProntId = profProntCad.json.dados.profissional_id;

    const pacPront = await chamar('/pacientes', 'POST', {
      nome_completo: 'Paciente Prontuário Auditoria',
      cpf: '52998224725',
      telefone: '11999990001',
      endereco: 'Rua Original, 10',
    }, cookie);
    const pacProntUuid = pacPront.json.dados.id;

    // 1. RECEPCAO não acessa prontuário (403)
    verificar(
      (await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'GET', undefined, sessaoRecepcao.cookie)).status === 403 &&
      (await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'PUT', { versao: 0, anamnese: 'x' }, sessaoRecepcao.cookie)).status === 403,
      'CT-01: RECEPCAO não pode ler nem editar prontuário clínico (403).'
    );

    // 2. PROFISSIONAL sem vínculo ou com reserva excepcional não validada recebe 404
    const [agExcRes] = await pool.query<any>(
      `INSERT INTO agendamento (paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim, status, checkin_recepcao)
       VALUES (?, ?, 1, '2040-04-10', '10:00:00', '11:00:00', 'Agendado', 0)`,
      [pacProntUuid, profProntId]
    );
    const agExcId = Number(agExcRes.insertId);
    await pool.query(
      `INSERT INTO historico_status_agendamento (id_agendamento, status_novo, tipo_evento, alterado_por, motivo)
       VALUES (?, 'Agendado', 'CRIACAO', 'Profissional Prontuário', 'Reserva confirmada pelo profissional em dia fechado')`,
      [agExcId]
    );
    verificar(
      (await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'GET', undefined, sessaoProfPront.cookie)).status === 404 &&
      (await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'PUT', { versao: 0, agendamento_id: agExcId, anamnese: 'indevida' }, sessaoProfPront.cookie)).status === 404,
      'CT-01: Reserva excepcional sem validação de chegada mantém prontuário bloqueado para PROFISSIONAL (404).'
    );

    // 3. Após RECEPCAO validar chegada, PROFISSIONAL acessa, mas não altera campos cadastrais e respeita versão/datas
    await pool.query('UPDATE agendamento SET checkin_recepcao = 1 WHERE id_agendamento = ?', [agExcId]);
    const prontAberto = await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'GET', undefined, sessaoProfPront.cookie);
    verificar(
      prontAberto.status === 200 && prontAberto.json.dados?.paciente?.versao === 0,
      'CT-01: Após validação de chegada pela recepção, PROFISSIONAL acessa prontuário com versão otimista.'
    );
    const dataInvalida = await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'PUT', {
      versao: 0, agendamento_id: agExcId, data_nascimento: '2026-02-31',
    }, cookie);
    verificar(dataInvalida.status === 400, 'CT-01: Prontuário rejeita data de nascimento inválida (2026-02-31).');
    const semVersao = await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'PUT', {
      agendamento_id: agExcId, anamnese: 'Sem versão',
    }, sessaoProfPront.cookie);
    verificar(semVersao.status === 428, 'CT-01: Prontuário exige controle de versão otimista (428).');
    const salvoPront = await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'PUT', {
      versao: 0, agendamento_id: agExcId, rg: '999999', endereco: 'Rua Invadida',
      etapa_tratamento: 'Em Tratamento', anamnese: 'Anamnese da sessão', evolucao: 'Evolução da sessão',
    }, sessaoProfPront.cookie);
    const conflitoPront = await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'PUT', {
      versao: 0, agendamento_id: agExcId, anamnese: 'Versão obsoleta',
    }, sessaoProfPront.cookie);
    const prontDepois = await chamar(`/pacientes/${pacProntUuid}/prontuario`, 'GET', undefined, cookie);
    verificar(
      salvoPront.status === 200 &&
      salvoPront.json.dados?.versao === 1 &&
      conflitoPront.status === 409 &&
      prontDepois.json.dados?.paciente?.endereco === 'Rua Original, 10' &&
      prontDepois.json.dados?.paciente?.historico_clinico === null,
      'CT-01: Prontuário incrementa versão, detecta conflito 409, preserva cadastro e não sobrescreve histórico global.'
    );

    // ── CT-02: Primeiro acesso obrigatório, credencial temporária aleatória e rotação de sessão ──
    const novoPrimeiroAcesso = await chamar('/usuarios', 'POST', {
      nome: 'Usuário Primeiro Acesso',
      email: 'primeiro-acesso@example.test',
      perfil: 'RECEPCAO',
    }, cookie);
    const credTemp = String(novoPrimeiroAcesso.json.dados?.credencial_temporaria || '');
    verificar(
      novoPrimeiroAcesso.status === 201 &&
      credTemp.length >= 10 &&
      credTemp !== 'Ikigai@123' &&
      novoPrimeiroAcesso.json.dados?.primeiro_acesso === true,
      'CT-02: Criação sem senha gera credencial temporária aleatória e marca primeiro acesso.'
    );
    const loginTemp1 = await chamar('/auth/login', 'POST', { email: 'primeiro-acesso@example.test', senha: credTemp });
    const loginTemp2 = await chamar('/auth/login', 'POST', { email: 'primeiro-acesso@example.test', senha: credTemp });
    verificar(
      loginTemp1.status === 200 &&
      (await chamar('/pacientes', 'GET', undefined, loginTemp1.cookie)).status === 403 &&
      (await chamar('/auth/trocar-senha', 'POST', { nova_senha: 'curta', confirmar_senha: 'curta' }, loginTemp1.cookie)).status === 400 &&
      (await chamar('/auth/trocar-senha', 'POST', { nova_senha: 'NovaSenha123!', confirmar_senha: 'Diferente123!' }, loginTemp1.cookie)).status === 400,
      'CT-02: Primeiro acesso bloqueia APIs (403) até trocar senha e valida tamanho mínimo e confirmação.'
    );
    const senhaNova = 'NovaSenhaSegura2026!';
    const trocaOk = await chamar('/auth/primeiro-acesso/senha', 'POST', { nova_senha: senhaNova, confirmar_senha: senhaNova }, loginTemp1.cookie);
    verificar(
      trocaOk.status === 200 &&
      !!trocaOk.cookie &&
      trocaOk.cookie !== loginTemp1.cookie &&
      (await chamar('/auth/me', 'GET', undefined, loginTemp2.cookie)).status === 401 &&
      (await chamar('/pacientes', 'GET', undefined, trocaOk.cookie)).status === 200 &&
      (await chamar('/auth/primeiro-acesso/senha', 'POST', { nova_senha: 'OutraSenha2026!', confirmar_senha: 'OutraSenha2026!' }, trocaOk.cookie)).status === 403 &&
      (await chamar('/auth/trocar-senha', 'POST', { nova_senha: 'OutraSenha2026!', confirmar_senha: 'OutraSenha2026!' }, trocaOk.cookie)).status === 400,
      'CT-02: Rota dedicada de primeiro acesso rotaciona cookie, revoga outras sessões, bloqueia reutilização (403) e exige senha_atual em trocas futuras.'
    );

    // ── CT-03: Personalização individual de procedimentos pelo PROFISSIONAL sem mutar catálogo global ──
    const bloqueioGlobal = await chamar(`/profissionais/${profProntId}/procedimentos`, 'POST', {
      nome: 'Procedimento Global Indevido', duracao_minutos: 45, preco: 999,
    }, sessaoProfPront.cookie);
    const [procAntes] = await pool.query<RowDataPacket[]>('SELECT duracao_minutos, preco, ativo FROM procedimento WHERE id_procedimento = 1');
    const vincularProc = await chamar(`/profissionais/${profProntId}/procedimentos`, 'POST', {
      procedimento_id: 1, duracao_minutos: 45, preco: 320,
    }, sessaoProfPront.cookie);
    const editarProcIndividual = await chamar(`/profissionais/${profProntId}/procedimentos/1`, 'PUT', {
      duracao_minutos: 50, preco: 350, ativo: 0,
    }, sessaoProfPront.cookie);
    const [procDepois] = await pool.query<RowDataPacket[]>('SELECT duracao_minutos, preco, ativo FROM procedimento WHERE id_procedimento = 1');
    const listaMeusProcs = await chamar(`/profissionais/${profProntId}/procedimentos`, 'GET', undefined, sessaoProfPront.cookie);
    const meuProc1 = (listaMeusProcs.json.dados || []).find((p: { id: number }) => Number(p.id) === 1);
    const profsElegiveisServico1 = await chamar('/servicos/1/profissionais', 'GET', undefined, cookie);
    const pausadoOcultoNaRecepcao = !(profsElegiveisServico1.json.dados || []).some(
      (p: { id: number }) => Number(p.id) === Number(profProntId)
    );
    verificar(
      bloqueioGlobal.status === 403 &&
      [200, 201].includes(vincularProc.status) &&
      editarProcIndividual.status === 200 &&
      Number(procDepois[0].duracao_minutos) === Number(procAntes[0].duracao_minutos) &&
      Number(procDepois[0].preco) === Number(procAntes[0].preco) &&
      Number(procDepois[0].ativo) === Number(procAntes[0].ativo) &&
      Number(meuProc1?.duracao_minutos) === 50 &&
      Number(meuProc1?.preco) === 350 &&
      Number(meuProc1?.ativo_profissional) === 0 &&
      pausadoOcultoNaRecepcao,
      'CT-03: PROFISSIONAL personaliza duração, preço e pausa apenas na própria agenda sem mutar catálogo global e pausa oculta da recepção.'
    );

    // ── CT-05: Validações de calendário, Horario_Especial, timezone, XSS e DELETE por ID numérico ──
    const janelasEspecial = resolverJanelasAgenda(
      '2040-04-10',
      { ativo: 1, horario_inicio: '08:00', horario_fim: '18:00', intervalo_inicio: '12:00', intervalo_fim: '13:00' },
      { tipo_excecao: 'Horario_Especial', horario_inicio: '09:00', horario_fim: '13:00' }
    );
    const fusoAnterior = process.env.LEMBRETE_FUSO;
    process.env.LEMBRETE_FUSO = 'Timezone/Invalida_XYZ';
    const janelaInvalida = janelaLembrete(new Date());
    if (fusoAnterior === undefined) delete process.env.LEMBRETE_FUSO; else process.env.LEMBRETE_FUSO = fusoAnterior;

    const profXss = await chamar('/profissionais', 'POST', { nome: 'Dr. <b>Seguro</b>', especialidade: '<script>x</script>Acupuntura' }, cookie);
    const pacDel = await chamar('/pacientes', 'POST', {
      nome_completo: 'Paciente Exclusao Numerica',
      cpf: '11144477735',
      telefone: '11988887777',
      endereco: 'Rua Exclusao, 50',
    }, cookie);
    const [pacDelRow] = await pool.query<RowDataPacket[]>('SELECT id_paciente FROM paciente WHERE uuid = ?', [pacDel.json.dados.id]);
    const putVersao = await chamar(`/pacientes/${pacDel.json.dados.id}`, 'PUT', {
      versao: 0,
      nome_completo: 'Paciente Exclusao Atualizado',
      cpf: '11144477735',
      telefone: '11988887777',
      endereco: 'Rua Exclusao, 50',
    }, cookie);
    const delPorId = await chamar(`/pacientes/${pacDelRow[0].id_paciente}`, 'DELETE', undefined, cookie);
    verificar(
      JSON.stringify(janelasEspecial) === JSON.stringify([[540, 780]]) &&
      validarPeriodoAgenda('2026-02-31', '2026-03-01').valido === false &&
      validarPeriodoAgenda('2026-01-01', '2028-01-01').valido === false &&
      janelaInvalida === null &&
      profXss.status === 201 && !/<|>/i.test(String(profXss.json.dados?.nome || '')) &&
      putVersao.status === 200 && putVersao.json.dados?.versao === 1 &&
      delPorId.status === 200,
      'CT-05: Horario_Especial preserva turno, datas inválidas/longas e timezones inválidos são tratados, HTML é sanitizado e PUT/DELETE de paciente funcionam.'
    );

    await pool.query('DELETE FROM prontuario_consulta WHERE paciente_uuid = ?', [pacProntUuid]);
    await pool.query('DELETE FROM agendamento WHERE id_agendamento = ?', [agExcId]);
    await pool.query('DELETE FROM paciente_evolucao WHERE paciente_uuid = ?', [pacProntUuid]);
    await pool.query('DELETE FROM paciente WHERE uuid = ?', [pacProntUuid]);

    process.env.NODE_ENV = 'production';
    const producao = await chamar('/auth/login', 'POST', recepcao, undefined, true);
    const semOrigemProd = await fetch(origem + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify(recepcao),
    });
    verificar(producao.status === 200 && /; Secure(;|$)/i.test(producao.setCookie) &&
      semOrigemProd.status === 403 &&
      (await chamar('/auth/login', 'POST', recepcao, undefined, false, true)).status === 403, 'Publicação exige HTTPS, valida Origin estritamente e emite cookie Secure pelo proxy local.');
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
