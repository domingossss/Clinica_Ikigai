import { escaparTextoHtml } from './renderizacao.js';

export const SURVEY_STORAGE_KEY = 'ikigai.patient-survey.v1';
export const SURVEY_SOURCES = ['Indicação', 'Instagram', 'Google', 'WhatsApp', 'Facebook', 'Profissional de saúde', 'Outro'];
const localTimestamp = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString(); };
const SURVEY_RATING_FIELDS = ['schedulingEase', 'waitAcceptability', 'receptionAttention', 'professionalClarity', 'safeComfort', 'priceFairness'];

function isSurveyResponse(value) {
  return value !== null && typeof value === 'object' && typeof value.submittedAt === 'string' && !Number.isNaN(Date.parse(value.submittedAt)) &&
    SURVEY_RATING_FIELDS.every(key => Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= 5) &&
    typeof value.aiResolution === 'boolean' && typeof value.wouldReturn === 'boolean' &&
    Number.isInteger(value.recommendation) && value.recommendation >= 0 && value.recommendation <= 10 &&
    SURVEY_SOURCES.includes(value.discovery);
}

export function carregarRespostasPesquisa() {
  let raw;
  try { raw = localStorage.getItem(SURVEY_STORAGE_KEY); }
  catch { return { respostas: [], erro: 'Armazenamento local indisponível.' }; }
  if (raw === null) return { respostas: [], erro: '' };

  let dados;
  try { dados = JSON.parse(raw); }
  catch { return { respostas: [], erro: 'Dados de pesquisa inválidos.' }; }
  if (!Array.isArray(dados) || !dados.every(isSurveyResponse)) {
    return { respostas: [], erro: 'Formato inválido de pesquisa.' };
  }
  return { respostas: dados, erro: '' };
}

export function lerRespostaPesquisa(dados) {
  if (['aiResolution', 'wouldReturn'].some(campo => !['true', 'false'].includes(dados.get(campo)))) return null;
  if (!/^(?:[0-9]|10)$/.test(dados.get('recommendation') ?? '')) return null;
  const resposta = { submittedAt: localTimestamp() };
  for (const campo of SURVEY_RATING_FIELDS) resposta[campo] = Number(dados.get(campo));
  resposta.aiResolution = dados.get('aiResolution') === 'true';
  resposta.wouldReturn = dados.get('wouldReturn') === 'true';
  resposta.recommendation = Number(dados.get('recommendation'));
  resposta.discovery = dados.get('discovery');
  return isSurveyResponse(resposta) ? resposta : null;
}

export function salvarRespostasPesquisa(respostas) {
  try { localStorage.setItem(SURVEY_STORAGE_KEY, JSON.stringify(respostas)); }
  catch { return 'Não foi possível salvar as respostas neste navegador.'; }
  return '';
}

export function apagarRespostasPesquisa() {
  try { localStorage.removeItem(SURVEY_STORAGE_KEY); }
  catch { return 'Não foi possível apagar as respostas salvas.'; }
  return '';
}

const surveyRatingOptions = '<option value="">Selecione</option>' + [1, 2, 3, 4, 5].map(value => `<option value="${value}">${value}</option>`).join('');
function surveyQuestionField(key, label) {
  return `<label class="survey-field" for="survey-${key}">${label}<select id="survey-${key}" name="${key}" required aria-label="${label}">${surveyRatingOptions}</select></label>`;
}
function surveyChoiceField(key, label, options) {
  return `<label class="survey-field" for="survey-${key}">${label}<select id="survey-${key}" name="${key}" required aria-label="${label}"><option value="">Selecione</option>${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
}
function surveyGroup(title, destination, fields) {
  return `<section class="survey-group"><h4>${title}</h4><p>${destination}</p><div class="survey-fields">${fields.join('')}</div></section>`;
}
export function surveyFormHtml({ erro, aviso, total }) {
  const status = aviso ?? (erro ? { texto: erro, falha: true } : null);
  return `<div class="survey-box">
    <h3>Pesquisa anônima de experiência</h3>
    <p class="survey-help" id="survey-help">Leva cerca de 1 minuto. Não informe dados pessoais. As respostas ficam salvas somente neste navegador e alimentam os indicadores após o envio.</p>
    ${status ? `<p class="survey-notice${status.falha ? ' error' : ''}" id="survey-notice" role="${status.falha ? 'alert' : 'status'}" tabindex="-1">${escaparTextoHtml(status.texto)}</p>` : ''}
    <form id="patient-survey" aria-describedby="survey-help">
      ${surveyGroup('1. Agendamento e chatbot', 'Alimenta o dashboard de Agenda.', [
        surveyQuestionField('schedulingEase', 'Foi fácil marcar sua consulta?'),
        surveyChoiceField('aiResolution', 'Você conseguiu resolver tudo sem precisar de ajuda de uma pessoa?', [['true', 'Sim'], ['false', 'Não']])
      ])}
      ${surveyGroup('2. Tempo de espera', 'Alimenta o painel Produção/Operacional.', [
        surveyQuestionField('waitAcceptability', 'O tempo de espera foi aceitável?')
      ])}
      ${surveyGroup('3. Recepção e equipe', 'Alimenta o núcleo de Pesquisa de Satisfação.', [
        surveyQuestionField('receptionAttention', 'Como você avalia a educação e a atenção da recepção?'),
        surveyQuestionField('professionalClarity', 'O profissional explicou tudo de forma que você entendeu?')
      ])}
      ${surveyGroup('4. Ambiente e acessibilidade', 'Alimenta Pesquisa de Satisfação.', [
        surveyQuestionField('safeComfort', 'Você se sentiu seguro e confortável na clínica (acesso, rampas, piso, banheiros e sinalização)?')
      ])}
      ${surveyGroup('5. Preço e pagamento', 'Alimenta o painel Financeiro.', [
        surveyQuestionField('priceFairness', 'O valor e as formas de pagamento foram claros e justos?')
      ])}
      ${surveyGroup('6. Fidelidade e recomendação', 'Alimenta Perfil de Clientes/Evasão.', [
        surveyChoiceField('wouldReturn', 'Você voltaria à clínica?', [['true', 'Sim'], ['false', 'Não']]),
        surveyChoiceField('recommendation', 'Você indicaria a clínica a um amigo ou familiar? (0 = não indicaria; 10 = indicaria com certeza)', Array.from({ length: 11 }, (_, value) => [String(value), String(value)]))
      ])}
      ${surveyGroup('7. Origem do paciente', 'Alimenta Redes Sociais.', [
        surveyChoiceField('discovery', 'Como você ficou sabendo da clínica?', SURVEY_SOURCES.map(source => [source, source]))
      ])}
      <div class="survey-actions">
        <button class="bk" type="submit"${erro ? ' disabled' : ''}>Enviar respostas</button>
        <button class="survey-clear" type="button" id="clear-survey"${total || erro ? '' : ' disabled'}>Apagar respostas deste navegador</button>
      </div>
    </form>
  </div>`;
}
