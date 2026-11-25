import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql, { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(raiz, 'backend/.env') });

interface PacienteFicticio {
  nome: string;
  cpf: string;
  rg: string;
  nasc: string;
  sexo: 'Feminino' | 'Masculino' | 'Outro';
  filiacao: string;
  nat: string;
  tel: string;
  email: string;
  end: string;
  etapa: 'Avaliação' | 'Em Tratamento' | 'Retorno' | 'Manutenção';
  at: 'IA' | 'Humano';
  obs: string;
  hist: string;
}

interface PacienteDbRow extends RowDataPacket {
  id_paciente: number;
  uuid: string;
  nome: string;
  whatsapp: string | null;
}

interface AgendamentoItem {
  pac: PacienteDbRow;
  prof: number;
  proc: number;
  data: string;
  hora: string;
  isSabado: boolean;
  status: 'Realizado' | 'Em Atendimento' | 'Na Recepção' | 'Confirmado' | 'Agendado' | 'Reagendado' | 'Cancelado' | 'No_Show';
  origem: 'Chatbot' | 'Humano_Recepcao' | 'Telefone';
  tipo: 'Primeira_Consulta' | 'Retorno';
  pag: 'Particular' | 'Convenio';
  atraso: number;
  nps: number | null;
  foiReagendado: boolean;
}

function gerarCpfValido(base9: string): string {
  const nums = base9.split('').map(Number);
  const calc = (slice: number[], peso: number) => {
    const soma = slice.reduce((acc, n, i) => acc + n * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(nums, 10);
  const d2 = calc([...nums, d1], 11);
  return base9 + String(d1) + String(d2);
}

// 30 pacientes fictícios com CPFs matematicamente válidos cobrindo todas as faixas etárias (0-17 a 60+)
const PACIENTES_APRESENTACAO: PacienteFicticio[] = [
  { nome: 'Beatriz Almeida Vasconcelos', cpf: gerarCpfValido('529982247'), rg: '43.812.904-1', nasc: '1991-04-18', sexo: 'Feminino', filiacao: 'Carlos Vasconcelos e Sonia Almeida', nat: 'São Paulo - SP', tel: '5511984120101', email: 'beatriz.vasconcelos@exemplo.ikigai.br', end: 'Rua Vergueiro, 1420, Apto 62 - Vila Mariana, São Paulo/SP', etapa: 'Avaliação', at: 'Humano', obs: 'Prefere horários no período da manhã (08h às 11h).', hist: 'Queixa principal de tensão cervical e insônia leve há 3 meses. Sem alergias conhecidas.' },
  { nome: 'Rafael Henrique Nogueira', cpf: gerarCpfValido('614283950'), rg: '39.205.718-4', nasc: '1985-09-22', sexo: 'Masculino', filiacao: 'Eduardo Nogueira e Cláudia Mendes', nat: 'Campinas - SP', tel: '5511984120102', email: 'rafael.nogueira@exemplo.ikigai.br', end: 'Av. Paulista, 2100, Conj. 84 - Bela Vista, São Paulo/SP', etapa: 'Em Tratamento', at: 'IA', obs: 'Confirma consultas com antecedência pelo WhatsApp.', hist: 'Em acompanhamento semanal para lombalgia mecânica. Boa resposta às sessões de acupuntura e quiropraxia.' },
  { nome: 'Juliana Peixoto Carvalho', cpf: gerarCpfValido('731549208'), rg: '47.619.332-8', nasc: '1994-11-05', sexo: 'Feminino', filiacao: 'Marcos Carvalho e Renata Peixoto', nat: 'São José dos Campos - SP', tel: '5512984120103', email: 'juliana.carvalho@exemplo.ikigai.br', end: 'Rua das Acácias, 315 - Jardim Aquarius, São José dos Campos/SP', etapa: 'Retorno', at: 'IA', obs: 'Retorno quinzenal para reavaliação postural.', hist: 'Histórico de enxaqueca tensional. Apresentou redução significativa da frequência das crises após 4 sessões.' },
  { nome: 'Marcelo Augusto Teixeira', cpf: gerarCpfValido('842691357'), rg: '28.940.115-0', nasc: '1976-02-14', sexo: 'Masculino', filiacao: 'Antônio Teixeira e Maria José Teixeira', nat: 'Santos - SP', tel: '5511984120104', email: 'marcelo.teixeira@exemplo.ikigai.br', end: 'Rua Oscar Freire, 890, Apto 110 - Jardins, São Paulo/SP', etapa: 'Manutenção', at: 'Humano', obs: 'Sessões mensais preventivas. Gosta de lembrete 24h antes.', hist: 'Corredor amador. Reabilitado de tendinite patelar; segue em plano mensal de liberação miofascial.' },
  { nome: 'Carolina Duarte Bittencourt', cpf: gerarCpfValido('915374628'), rg: '45.108.477-9', nasc: '1989-07-30', sexo: 'Feminino', filiacao: 'Fernando Bittencourt e Lúcia Duarte', nat: 'Ribeirão Preto - SP', tel: '5511984120105', email: 'carolina.bittencourt@exemplo.ikigai.br', end: 'Rua Harmonia, 512 - Vila Madalena, São Paulo/SP', etapa: 'Em Tratamento', at: 'Humano', obs: 'Disponibilidade às terças e quintas após as 16h.', hist: 'Em protocolo integrativo para manejo de ansiedade e qualidade do sono. Evolução positiva.' },
  { nome: 'Gustavo Azevedo Monteiro', cpf: gerarCpfValido('368247519'), rg: '41.773.209-6', nasc: '1997-01-12', sexo: 'Masculino', filiacao: 'Paulo Monteiro e Patrícia Azevedo', nat: 'Belo Horizonte - MG', tel: '5511984120106', email: 'gustavo.monteiro@exemplo.ikigai.br', end: 'Rua Augusta, 1650, Apto 45 - Consolação, São Paulo/SP', etapa: 'Avaliação', at: 'IA', obs: 'Primeiro contato realizado pelo autoatendimento no WhatsApp.', hist: 'Relata desconforto em ombro direito associado a trabalho prolongado em computador.' },
  { nome: 'Larissa Fernandes Queiroz', cpf: gerarCpfValido('482915630'), rg: '49.331.820-2', nasc: '1992-06-27', sexo: 'Feminino', filiacao: 'Roberto Queiroz e Denise Fernandes', nat: 'Curitiba - PR', tel: '5511984120107', email: 'larissa.queiroz@exemplo.ikigai.br', end: 'Alameda Santos, 980, Apto 121 - Cerqueira César, São Paulo/SP', etapa: 'Retorno', at: 'Humano', obs: 'Solicita recibo detalhado ao final de cada consulta.', hist: 'Acompanhamento de dores articulares leves e reeducação postural. Boa adesão aos exercícios domiciliares.' },
  { nome: 'Eduardo Siqueira Cavalcanti', cpf: gerarCpfValido('274839165'), rg: '22.516.849-3', nasc: '1968-12-03', sexo: 'Masculino', filiacao: 'José Cavalcanti e Helena Siqueira', nat: 'Recife - PE', tel: '5511984120108', email: 'eduardo.cavalcanti@exemplo.ikigai.br', end: 'Rua Joaquim Floriano, 410, Apto 74 - Itaim Bibi, São Paulo/SP', etapa: 'Manutenção', at: 'Humano', obs: 'Prefere atendimento presencial com confirmação por telefone/WhatsApp.', hist: 'Hipertensão controlada com medicação. Faz manutenção quinzenal de acupuntura para bem-estar e mobilidade.' },
  { nome: 'Amanda Ribeiro Pacheco', cpf: gerarCpfValido('693518427'), rg: '51.204.663-5', nasc: '1999-08-19', sexo: 'Feminino', filiacao: 'Sérgio Pacheco e Eliane Ribeiro', nat: 'Taubaté - SP', tel: '5512984120109', email: 'amanda.pacheco@exemplo.ikigai.br', end: 'Av. Nove de Julho, 740 - Vila Adyana, São José dos Campos/SP', etapa: 'Em Tratamento', at: 'IA', obs: 'Horário preferencial no final da tarde.', hist: 'Queixa de bruxismo e dor na ATM. Em tratamento complementar com acupuntura auricular e relaxamento miofascial.' },
  { nome: 'Vinícius Moraes Tavares', cpf: gerarCpfValido('159753486'), rg: '36.890.512-7', nasc: '1983-03-09', sexo: 'Masculino', filiacao: 'Cláudio Tavares e Márcia Moraes', nat: 'Sorocaba - SP', tel: '5511984120110', email: 'vinicius.tavares@exemplo.ikigai.br', end: 'Rua Haddock Lobo, 1230, Apto 33 - Cerqueira César, São Paulo/SP', etapa: 'Avaliação', at: 'Humano', obs: 'Indicação de outro paciente da clínica.', hist: 'Praticante de ciclismo. Busca avaliação preventiva para sobrecarga em região lombar e quadríceps.' },
  { nome: 'Renata Campos Silveira', cpf: gerarCpfValido('804629315'), rg: '33.482.991-0', nasc: '1979-10-25', sexo: 'Feminino', filiacao: 'Jorge Silveira e Tereza Campos', nat: 'Florianópolis - SC', tel: '5511984120111', email: 'renata.silveira@exemplo.ikigai.br', end: 'Rua Bela Cintra, 775, Apto 92 - Consolação, São Paulo/SP', etapa: 'Retorno', at: 'IA', obs: 'Acompanhamento contínuo sem restrições de horário.', hist: 'Retorno após 30 dias de protocolo de redução de estresse e melhora da qualidade do sono.' },
  { nome: 'Alex Santana Moreira', cpf: gerarCpfValido('427961853'), rg: '48.912.304-X', nasc: '1995-05-11', sexo: 'Outro', filiacao: 'Fábio Moreira e Adriana Santana', nat: 'São Paulo - SP', tel: '5511984120112', email: 'alex.moreira@exemplo.ikigai.br', end: 'Rua Mourato Coelho, 640, Apto 28 - Pinheiros, São Paulo/SP', etapa: 'Em Tratamento', at: 'Humano', obs: 'Prefere comunicação escrita via WhatsApp.', hist: 'Em sessões quinzenais para fadiga muscular e melhora de ergonomia no trabalho remoto.' },
  { nome: 'Dona Clarice Nogueira Sampaio', cpf: gerarCpfValido('104829371'), rg: '14.520.881-2', nasc: '1954-03-14', sexo: 'Feminino', filiacao: 'Joaquim Sampaio e Iracema Nogueira', nat: 'São Paulo - SP', tel: '5511984120201', email: 'clarice.sampaio@exemplo.ikigai.br', end: 'Rua Cardoso de Almeida, 620 - Perdizes, São Paulo/SP', etapa: 'Manutenção', at: 'Humano', obs: 'Prefere horários no meio da manhã (09h30 às 11h).', hist: 'Acompanhamento de mobilidade articular e qualidade do sono com acupuntura semanal.' },
  { nome: 'Antônio Carlos Figueiredo', cpf: gerarCpfValido('205938412'), rg: '16.901.344-5', nasc: '1958-08-27', sexo: 'Masculino', filiacao: 'Manoel Figueiredo e Aparecida Dias', nat: 'Guarulhos - SP', tel: '5511984120202', email: 'antonio.figueiredo@exemplo.ikigai.br', end: 'Av. Angélica, 1840, Apto 71 - Higienópolis, São Paulo/SP', etapa: 'Em Tratamento', at: 'Humano', obs: 'Confirmar presença na véspera por WhatsApp.', hist: 'Lombalgia crônica leve; apresenta ótima resposta à combinação de acupuntura e massoterapia.' },
  { nome: 'Sueli Aparecida Rezende', cpf: gerarCpfValido('316482953'), rg: '18.230.419-0', nasc: '1961-11-09', sexo: 'Feminino', filiacao: 'Benedito Rezende e Nair Silva', nat: 'Sorocaba - SP', tel: '5511984120203', email: 'sueli.rezende@exemplo.ikigai.br', end: 'Rua Domingos de Morais, 2240 - Vila Mariana, São Paulo/SP', etapa: 'Retorno', at: 'IA', obs: 'Utiliza o autoatendimento no WhatsApp para confirmar consultas.', hist: 'Acompanhamento nutricional integrativo e fitoterapia para disposição e controle glicêmico.' },
  { nome: 'Dr. Roberto Cândido Peçanha', cpf: gerarCpfValido('427593064'), rg: '12.874.102-8', nasc: '1951-06-03', sexo: 'Masculino', filiacao: 'Cândido Peçanha e Olga Martins', nat: 'Rio de Janeiro - RJ', tel: '5511984120204', email: 'roberto.pecanha@exemplo.ikigai.br', end: 'Alameda Campinas, 1105, Apto 94 - Jardins, São Paulo/SP', etapa: 'Manutenção', at: 'Humano', obs: 'Sessões quinzenais preventivas às quartas-feiras.', hist: 'Plano preventivo de longevidade e naturopatia.' },
  { nome: 'Isabela Cristina Mendonça', cpf: gerarCpfValido('538604175'), rg: '42.198.765-3', nasc: '1990-02-21', sexo: 'Feminino', filiacao: 'Sérgio Mendonça e Cristina Lopes', nat: 'Campinas - SP', tel: '5511984120205', email: 'isabela.mendonca@exemplo.ikigai.br', end: 'Rua Fradique Coutinho, 910 - Pinheiros, São Paulo/SP', etapa: 'Em Tratamento', at: 'IA', obs: 'Prefere horários após as 15h.', hist: 'Psicoterapia integrativa para gestão de estresse ocupacional e melhora do foco.' },
  { nome: 'Thiago Augusto Ferraz', cpf: gerarCpfValido('649715286'), rg: '38.652.019-7', nasc: '1986-07-16', sexo: 'Masculino', filiacao: 'Augusto Ferraz e Mônica Duarte', nat: 'Santo André - SP', tel: '5511984120206', email: 'thiago.ferraz@exemplo.ikigai.br', end: 'Rua Ministro Jesuíno Cardoso, 445 - Vila Olímpia, São Paulo/SP', etapa: 'Retorno', at: 'IA', obs: 'Agendamento recorrente pelo robô do WhatsApp.', hist: 'Liberação miofascial para corredor de meia-maratona.' },
  { nome: 'Vanessa Lopes Guimarães', cpf: gerarCpfValido('750826397'), rg: '44.019.284-1', nasc: '1988-12-02', sexo: 'Feminino', filiacao: 'Hélio Guimarães e Vera Lopes', nat: 'São Bernardo do Campo - SP', tel: '5511984120207', email: 'vanessa.guimaraes@exemplo.ikigai.br', end: 'Rua Turiassu, 1180, Apto 52 - Perdizes, São Paulo/SP', etapa: 'Em Tratamento', at: 'Humano', obs: 'Gosta de receber orientações nutricionais por escrito.', hist: 'Reeducação alimentar integrativa com foco em saúde intestinal.' },
  { nome: 'Bruno César Alencar', cpf: gerarCpfValido('861937408'), rg: '46.783.910-4', nasc: '1993-05-19', sexo: 'Masculino', filiacao: 'César Alencar e Patrícia Nunes', nat: 'Fortaleza - CE', tel: '5511984120208', email: 'bruno.alencar@exemplo.ikigai.br', end: 'Rua Pamplona, 1450, Apto 108 - Jardim Paulista, São Paulo/SP', etapa: 'Avaliação', at: 'IA', obs: 'Novo paciente vindo de indicação.', hist: 'Primeira avaliação para dor cervical e bruxismo.' },
  { nome: 'Letícia Prado Mesquita', cpf: gerarCpfValido('972048519'), rg: '52.340.118-9', nasc: '2001-09-08', sexo: 'Feminino', filiacao: 'Ricardo Mesquita e Elaine Prado', nat: 'São José dos Campos - SP', tel: '5512984120209', email: 'leticia.mesquita@exemplo.ikigai.br', end: 'Av. Cassiano Ricardo, 601 - Jardim Aquarius, São José dos Campos/SP', etapa: 'Em Tratamento', at: 'IA', obs: 'Estudante universitária; prefere período vespertino.', hist: 'Protocolo de acupuntura e fitoterapia para ansiedade pré-provas e enxaqueca.' },
  { nome: 'Felipe Eduardo Bastos', cpf: gerarCpfValido('183159620'), rg: '50.892.473-6', nasc: '1998-04-28', sexo: 'Masculino', filiacao: 'Eduardo Bastos e Sandra Lima', nat: 'São Paulo - SP', tel: '5511984120210', email: 'felipe.bastos@exemplo.ikigai.br', end: 'Rua dos Pinheiros, 760, Apto 31 - Pinheiros, São Paulo/SP', etapa: 'Retorno', at: 'Humano', obs: 'Prefere atendimento com o mesmo profissional.', hist: 'Massoterapia terapêutica para recuperação pós-treino.' },
  { nome: 'Sofia Helena Cordeiro', cpf: gerarCpfValido('294260731'), rg: '55.102.839-2', nasc: '2011-10-12', sexo: 'Feminino', filiacao: 'Daniel Cordeiro e Helena Cordeiro', nat: 'São Paulo - SP', tel: '5511984120211', email: 'helena.cordeiro@exemplo.ikigai.br', end: 'Rua Itapeva, 518, Apto 44 - Bela Vista, São Paulo/SP', etapa: 'Avaliação', at: 'Humano', obs: 'Menor acompanhada pela mãe (Helena Cordeiro).', hist: 'Avaliação nutricional integrativa para rotina escolar e prática esportiva.' },
  { nome: 'Pedro Lucas Marcondes', cpf: gerarCpfValido('305371842'), rg: '56.418.290-0', nasc: '2010-01-25', sexo: 'Masculino', filiacao: 'Fábio Marcondes e Tatiana Marcondes', nat: 'Jundiaí - SP', tel: '5511984120212', email: 'tatiana.marcondes@exemplo.ikigai.br', end: 'Rua Heitor Penteado, 1340 - Sumarezinho, São Paulo/SP', etapa: 'Em Tratamento', at: 'Humano', obs: 'Acompanhado pelos responsáveis no final da tarde.', hist: 'Acompanhamento psicoterápico integrativo e hábitos de sono.' },
  { nome: 'Cláudia Regina Fonseca', cpf: gerarCpfValido('416482953'), rg: '24.671.509-1', nasc: '1972-08-04', sexo: 'Feminino', filiacao: 'Waldemar Fonseca e Diva Fonseca', nat: 'Bauru - SP', tel: '5511984120213', email: 'claudia.fonseca@exemplo.ikigai.br', end: 'Rua Maranhão, 620, Apto 85 - Higienópolis, São Paulo/SP', etapa: 'Manutenção', at: 'IA', obs: 'Paciente fiel há mais de 1 ano.', hist: 'Manutenção mensal de naturopatia e fitoterapia.' },
  { nome: 'André Luiz Vasconcellos', cpf: gerarCpfValido('527593064'), rg: '27.310.948-4', nasc: '1974-11-30', sexo: 'Masculino', filiacao: 'Luiz Vasconcellos e Rosa Maria', nat: 'Santos - SP', tel: '5511984120214', email: 'andre.vasconcellos@exemplo.ikigai.br', end: 'Av. Ibirapuera, 2410, Apto 112 - Moema, São Paulo/SP', etapa: 'Em Tratamento', at: 'Humano', obs: 'Prefere horários no início da manhã (08h).', hist: 'Protocolo combinado de acupuntura e reeducação nutricional.' },
  { nome: 'Mônica Tavares Bezerra', cpf: gerarCpfValido('638604175'), rg: '31.904.622-7', nasc: '1978-03-17', sexo: 'Feminino', filiacao: 'Geraldo Bezerra e Lúcia Tavares', nat: 'Salvador - BA', tel: '5511984120215', email: 'monica.bezerra@exemplo.ikigai.br', end: 'Rua Bela Vista, 310 - Brooklin, São Paulo/SP', etapa: 'Retorno', at: 'IA', obs: 'Responde rápido às confirmações de WhatsApp.', hist: 'Retorno de psicoterapia integrativa e acompanhamento do sono.' },
  { nome: 'Henrique Dias Lacerda', cpf: gerarCpfValido('749715286'), rg: '34.512.087-3', nasc: '1981-06-22', sexo: 'Masculino', filiacao: 'Otávio Lacerda e Beatriz Dias', nat: 'Porto Alegre - RS', tel: '5511984120216', email: 'henrique.lacerda@exemplo.ikigai.br', end: 'Rua Clodomiro Amazonas, 820 - Itaim Bibi, São Paulo/SP', etapa: 'Em Tratamento', at: 'Humano', obs: 'Solicita nota fiscal por e-mail.', hist: 'Tratamento de dor lombar e fadiga crônica com acupuntura sistêmica.' },
  { nome: 'Natália Borges Pinheiro', cpf: gerarCpfValido('850826397'), rg: '47.209.115-8', nasc: '1996-12-15', sexo: 'Feminino', filiacao: 'Marcelo Pinheiro e Simone Borges', nat: 'Uberlândia - MG', tel: '5511984120217', email: 'natalia.pinheiro@exemplo.ikigai.br', end: 'Rua Frei Caneca, 1140, Apto 76 - Consolação, São Paulo/SP', etapa: 'Avaliação', at: 'IA', obs: 'Agendou primeira consulta pelo WhatsApp.', hist: 'Interesse em fitoterapia e nutrição integrativa para energia diária.' },
  { nome: 'Sérgio Ricardo Paiva', cpf: gerarCpfValido('961937408'), rg: '19.845.320-6', nasc: '1963-09-01', sexo: 'Masculino', filiacao: 'Armando Paiva e Célia Paiva', nat: 'São Paulo - SP', tel: '5511984120218', email: 'sergio.paiva@exemplo.ikigai.br', end: 'Rua Alagoas, 475, Apto 63 - Higienópolis, São Paulo/SP', etapa: 'Manutenção', at: 'Humano', obs: 'Preferência por atendimento presencial às terças e quintas.', hist: 'Acompanhamento de bem-estar, pressão controlada e sessões quinzenais de acupuntura.' },
];

const PROCS: Record<number, { dur: number; preco: number; esp: number }> = {
  1: { dur: 60, preco: 220, esp: 1 },
  2: { dur: 60, preco: 280, esp: 2 },
  3: { dur: 50, preco: 250, esp: 3 },
  4: { dur: 60, preco: 180, esp: 4 },
  5: { dur: 45, preco: 200, esp: 5 },
  6: { dur: 60, preco: 300, esp: 6 },
};

const PARES = [
  { prof: 1, proc: 1 },
  { prof: 2, proc: 2 },
  { prof: 3, proc: 3 },
  { prof: 4, proc: 4 },
  { prof: 5, proc: 5 },
  { prof: 6, proc: 6 },
  { prof: 1, proc: 2 },
  { prof: 2, proc: 1 },
  { prof: 2, proc: 4 },
];

const COMENTARIOS_NPS: Record<number, string[]> = {
  10: [
    'Atendimento impecável, me senti muito acolhido desde a recepção.',
    'Profissional extremamente atencioso e pontual. Recomendo muito a Clínica Ikigai!',
    'Ambiente tranquilo e resultado perceptível já nas primeiras sessões.',
    'Experiência excelente! Agendamento rápido pelo WhatsApp e equipe muito cordial.',
    'Superou todas as expectativas, saio renovado de cada atendimento.',
  ],
  9: [
    'Muito satisfeito com a consulta e com o plano terapêutico personalizado.',
    'Ótima estrutura e explicações muito claras durante todo o atendimento.',
    'Pontualidade e cuidado em cada detalhe da consulta.',
    'Equipe muito preparada e ambiente super agradável.',
  ],
  8: [
    'Bom atendimento, equipe educada e consultório muito organizado.',
    'Consulta produtiva, apenas alguns minutinhos de espera na recepção.',
  ],
  7: ['Atendimento bom, mas tive dificuldade para estacionar próximo à clínica.'],
  6: ['Profissional excelente, porém aguardei um pouco mais do que o previsto.'],
};

const MOTIVOS_CANCEL = [
  'Imprevisto profissional no horário da consulta',
  'Viagem a trabalho inesperada',
  'Indisposição no dia, solicitou remarcar para outra semana',
  'Compromisso familiar urgente',
  'Conflito de agenda, optou por reagendar pelo WhatsApp',
];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addMinutesToTime(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

let seed = 20261130;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

async function main(): Promise<void> {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || process.env.DB_ADMIN_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD || process.env.DB_ADMIN_PASS,
    database: process.env.DB_NAME || 'clinica_ikigai_db',
  });

  try {
    const [hojeRow] = await conn.query<(RowDataPacket & { hoje: string })[]>(
      "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje"
    );
    const hojeStr = hojeRow[0].hoje;
    const inicioPeriodo = new Date('2026-06-01T12:00:00');
    const fimPeriodo = new Date('2026-11-30T12:00:00');

    await conn.beginTransaction();

    // 1. Inserir os 30 pacientes fictícios (idempotente por CPF)
    let novosPacientesInseridos = 0;
    const sqlPac =
      'INSERT INTO paciente (uuid, nome, cpf, rg, data_nascimento, sexo, filiacao, naturalidade, telefone, whatsapp, email, endereco, etapa_tratamento, atendimento_status, observacoes, historico_clinico) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    for (const p of PACIENTES_APRESENTACAO) {
      const [existe] = await conn.query<RowDataPacket[]>('SELECT id_paciente FROM paciente WHERE cpf = ? LIMIT 1', [p.cpf]);
      if (existe.length > 0) continue;
      await conn.query(sqlPac, [
        randomUUID(), p.nome, p.cpf, p.rg, p.nasc, p.sexo, p.filiacao,
        p.nat, p.tel, p.tel, p.email, p.end, p.etapa, p.at, p.obs, p.hist,
      ]);
      novosPacientesInseridos++;
    }

    const [pacs] = await conn.query<PacienteDbRow[]>('SELECT id_paciente, uuid, nome, whatsapp FROM paciente ORDER BY id_paciente');
    if (pacs.length === 0) {
      throw new Error('Nenhum paciente encontrado no banco. Execute o schema.sql e seed.sql antes.');
    }

    // 2. Limpar apenas registros anteriores deste script de apresentação (idempotência)
    const [antigos] = await conn.query<(RowDataPacket & { id_agendamento: number })[]>(
      "SELECT id_agendamento FROM agendamento WHERE observacoes LIKE '%[DEMO-APRESENTACAO]%'"
    );
    if (antigos.length > 0) {
      const oldIds = antigos.map(r => r.id_agendamento);
      await conn.query('DELETE FROM avaliacao_atendimento WHERE id_agendamento IN (?)', [oldIds]);
      await conn.query('DELETE FROM comunicacao_agendamento WHERE id_agendamento IN (?)', [oldIds]);
      await conn.query('DELETE FROM historico_status_agendamento WHERE id_agendamento IN (?)', [oldIds]);
      await conn.query('DELETE FROM agendamento WHERE id_agendamento IN (?)', [oldIds]);
    }
    await conn.query("DELETE FROM whatsapp_sessao_conversa WHERE conversation_id LIKE 'demo_ap_%'");
    await conn.query("DELETE FROM sessao_chatbot WHERE identificador_chat LIKE 'DEMO-CHAT-%'");

    // 3. Snapshots de capacidade diária de 2026-06-01 até 2026-11-30
    for (let d = new Date(inicioPeriodo); d <= fimPeriodo; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      const dStr = fmtDate(d);
      const fator = dow === 0 ? 0 : dow === 6 ? 0.5 : 1;
      const caps: [number, number][] = [
        [-1, Math.round(3240 * fator)],
        [1, Math.round(1080 * fator)],
        [2, Math.round(1080 * fator)],
        [3, Math.round(540 * fator)],
        [4, Math.round(1080 * fator)],
        [5, Math.round(540 * fator)],
        [6, Math.round(540 * fator)],
      ];
      for (const [esp, minutos] of caps) {
        await conn.query(
          'INSERT IGNORE INTO agenda_capacidade_snapshot (data, especialidade, minutos) VALUES (?, ?, ?)',
          [dStr, esp, minutos]
        );
      }
    }

    // Controle de ocupação para evitar conflito de horário
    const ocupados = new Set<string>();
    const [existentes] = await conn.query<(RowDataPacket & { id_profissional: number; data: string; hhmm: string })[]>(
      "SELECT id_profissional, DATE_FORMAT(data, '%Y-%m-%d') AS data, LEFT(horario_inicio, 5) AS hhmm FROM agendamento"
    );
    for (const r of existentes) {
      ocupados.add(`${r.id_profissional}|${r.data}|${r.hhmm}`);
    }

    const slotsSemana = ['08:00', '09:15', '10:30', '11:45', '13:30', '14:45', '16:00', '17:15'];
    const slotsSabado = ['08:00', '09:15', '10:30', '11:45'];

    let totalAgendamentos = 0;
    let totalNps = 0;
    let totalComunicacoes = 0;
    const porStatus: Record<string, number> = {};

    async function inserirAgendamento(item: AgendamentoItem): Promise<number | null> {
      const slots = item.isSabado ? slotsSabado : slotsSemana;
      let horaEscolhida = item.hora;
      let chave = `${item.prof}|${item.data}|${horaEscolhida}`;
      if (ocupados.has(chave)) {
        const livre = slots.find(h => !ocupados.has(`${item.prof}|${item.data}|${h}`));
        if (!livre) return null;
        horaEscolhida = livre;
        chave = `${item.prof}|${item.data}|${horaEscolhida}`;
      }
      ocupados.add(chave);

      const procInfo = PROCS[item.proc];
      const horaInicio = `${horaEscolhida}:00`;
      const horaFim = addMinutesToTime(horaEscolhida, procInfo.dur);
      const dataHoraAg = `${item.data} ${horaInicio}`;
      const comCheckin = ['Realizado', 'Em Atendimento', 'Na Recepção'].includes(item.status);
      const comInicio = ['Realizado', 'Em Atendimento'].includes(item.status);
      const checkin = comCheckin ? `${item.data} ${horaInicio}` : null;
      const inicioAtend = comInicio ? `${item.data} ${addMinutesToTime(horaEscolhida, item.atraso)}` : null;
      const motivoCancel = item.status === 'Cancelado' ? pick(MOTIVOS_CANCEL) : null;

      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO agendamento
          (id_paciente, paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim,
           data_hora_agendamento, status, origem, tipo_atendimento, modalidade_pagamento,
           data_hora_checkin, data_hora_inicio_atendimento, minutos_atraso, valor_cobrado,
           escalonado_humano, motivo_cancelamento, observacoes, checkin_recepcao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          item.pac.id_paciente,
          item.pac.uuid,
          item.prof,
          item.proc,
          item.data,
          horaInicio,
          horaFim,
          dataHoraAg,
          item.status,
          item.origem,
          item.tipo,
          item.pag,
          checkin,
          inicioAtend,
          comInicio ? item.atraso : 0,
          procInfo.preco,
          motivoCancel,
          '[DEMO-APRESENTACAO] Registro fictício criado para apresentação.',
          comCheckin ? 1 : 0,
        ]
      );

      const agId = res.insertId;
      totalAgendamentos++;
      porStatus[item.status] = (porStatus[item.status] || 0) + 1;

      if (item.foiReagendado) {
        await conn.query(
          `INSERT INTO historico_status_agendamento
            (id_agendamento, status_anterior, status_novo, motivo, alterado_por, data_alteracao, tipo_evento, ocorrencia_anterior, ocorrencia_nova)
           VALUES (?, 'Agendado', 'Reagendado', 'Remarcação solicitada pelo paciente', 'Recepção Clínica Ikigai', ?, 'REAGENDAMENTO', ?, ?)`,
          [agId, dataHoraAg, dataHoraAg, dataHoraAg]
        );
      }

      if (item.status === 'Realizado' && item.nps !== null) {
        const lista = COMENTARIOS_NPS[item.nps] || COMENTARIOS_NPS[9];
        await conn.query(
          `INSERT INTO avaliacao_atendimento (id_agendamento, nota_nps, comentario, data_resposta)
           VALUES (?, ?, ?, DATE_ADD(?, INTERVAL 3 HOUR))`,
          [agId, item.nps, pick(lista), dataHoraAg]
        );
        totalNps++;
      }

      if (item.data >= '2026-11-15' && item.status !== 'Cancelado' && rand() < 0.45 && totalComunicacoes < 45) {
        const tipoCom = item.data > hojeStr ? 'CONFIRMACAO' : 'LEMBRETE';
        const estadoCom =
          item.status === 'Confirmado' || item.status === 'Realizado'
            ? 'ENTREGUE'
            : rand() < 0.15
              ? 'FALHA'
              : 'SUBMETIDA';
        const erroCom = estadoCom === 'FALHA' ? 'Timeout temporário na entrega do WhatsApp.' : null;
        await conn.query(
          `INSERT INTO comunicacao_agendamento
            (id_agendamento, ocorrencia, tipo, canal, provedor, tentativa, estado, referencia_externa, erro)
           VALUES (?, ?, ?, 'WHATSAPP', 'whatsapp', 1, ?, ?, ?)`,
          [
            agId,
            dataHoraAg,
            tipoCom,
            estadoCom,
            estadoCom === 'FALHA' ? null : `wamid.demo.${agId}.${totalComunicacoes + 1}`,
            erroCom,
          ]
        );
        totalComunicacoes++;
      }

      return agId;
    }

    // 4. Gerar agenda completa de 2026-06-01 até 2026-11-30
    for (let d = new Date(inicioPeriodo); d <= fimPeriodo; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 0) continue;
      const isSabado = dow === 6;
      const dStr = fmtDate(d);
      const slots = isSabado ? slotsSabado : slotsSemana;

      if (dStr === hojeStr) {
        const hojeLista: Array<Omit<AgendamentoItem, 'pac' | 'data' | 'isSabado' | 'foiReagendado'> & { foiReagendado?: boolean }> = [
          { prof: 1, proc: 1, hora: '08:00', status: 'Realizado',      origem: 'Chatbot',         tipo: 'Retorno',           pag: 'Particular', atraso: 0, nps: 10 },
          { prof: 2, proc: 2, hora: '08:00', status: 'Realizado',      origem: 'Humano_Recepcao', tipo: 'Primeira_Consulta', pag: 'Convenio',   atraso: 3, nps: 9  },
          { prof: 3, proc: 3, hora: '08:00', status: 'Realizado',      origem: 'Chatbot',         tipo: 'Retorno',           pag: 'Particular', atraso: 2, nps: 10 },
          { prof: 4, proc: 4, hora: '09:15', status: 'Realizado',      origem: 'Chatbot',         tipo: 'Retorno',           pag: 'Particular', atraso: 5, nps: 9  },
          { prof: 5, proc: 5, hora: '09:15', status: 'Realizado',      origem: 'Humano_Recepcao', tipo: 'Primeira_Consulta', pag: 'Particular', atraso: 0, nps: 10 },
          { prof: 6, proc: 6, hora: '09:15', status: 'Em Atendimento', origem: 'Chatbot',         tipo: 'Retorno',           pag: 'Particular', atraso: 4, nps: null },
          { prof: 1, proc: 2, hora: '10:30', status: 'Em Atendimento', origem: 'Humano_Recepcao', tipo: 'Retorno',           pag: 'Convenio',   atraso: 2, nps: null },
          { prof: 2, proc: 4, hora: '10:30', status: 'Na Recepção',    origem: 'Chatbot',         tipo: 'Primeira_Consulta', pag: 'Particular', atraso: 0, nps: null },
          { prof: 3, proc: 3, hora: '10:30', status: 'Na Recepção',    origem: 'Humano_Recepcao', tipo: 'Retorno',           pag: 'Particular', atraso: 0, nps: null },
          { prof: 4, proc: 4, hora: '11:45', status: 'Confirmado',     origem: 'Chatbot',         tipo: 'Retorno',           pag: 'Particular', atraso: 0, nps: null },
          { prof: 5, proc: 5, hora: '13:30', status: 'Confirmado',     origem: 'Chatbot',         tipo: 'Primeira_Consulta', pag: 'Particular', atraso: 0, nps: null },
          { prof: 6, proc: 6, hora: '13:30', status: 'Agendado',       origem: 'Chatbot',         tipo: 'Primeira_Consulta', pag: 'Convenio',   atraso: 0, nps: null },
          { prof: 1, proc: 1, hora: '14:45', status: 'Confirmado',     origem: 'Humano_Recepcao', tipo: 'Retorno',           pag: 'Particular', atraso: 0, nps: null },
          { prof: 2, proc: 2, hora: '14:45', status: 'Agendado',       origem: 'Telefone',        tipo: 'Primeira_Consulta', pag: 'Particular', atraso: 0, nps: null },
          { prof: 3, proc: 3, hora: '16:00', status: 'Agendado',       origem: 'Chatbot',         tipo: 'Retorno',           pag: 'Particular', atraso: 0, nps: null },
          { prof: 4, proc: 4, hora: '16:00', status: 'Reagendado',     origem: 'Chatbot',         tipo: 'Retorno',           pag: 'Convenio',   atraso: 0, nps: null, foiReagendado: true },
          { prof: 5, proc: 5, hora: '17:15', status: 'Cancelado',      origem: 'Humano_Recepcao', tipo: 'Retorno',           pag: 'Particular', atraso: 0, nps: null },
          { prof: 6, proc: 6, hora: '17:15', status: 'Confirmado',     origem: 'Chatbot',         tipo: 'Retorno',           pag: 'Particular', atraso: 0, nps: null },
        ];
        for (let i = 0; i < hojeLista.length; i++) {
          const item = hojeLista[i];
          await inserirAgendamento({
            ...item,
            pac: pacs[(i * 2 + 8) % pacs.length],
            data: dStr,
            isSabado: false,
            foiReagendado: Boolean(item.foiReagendado),
          });
        }
        continue;
      }

      if (dStr > hojeStr) {
        const qtdDia = isSabado ? 8 : 14;
        for (let i = 0; i < qtdDia; i++) {
          const par = PARES[(i + d.getDate()) % PARES.length];
          const r = rand();
          const status: AgendamentoItem['status'] =
            r < 0.44 ? 'Confirmado'
              : r < 0.78 ? 'Agendado'
                : r < 0.90 ? 'Reagendado'
                  : 'Cancelado';
          await inserirAgendamento({
            pac: pacs[Math.floor(rand() * pacs.length)],
            prof: par.prof,
            proc: par.proc,
            data: dStr,
            hora: slots[(i + par.prof) % slots.length],
            isSabado,
            status,
            origem: rand() < 0.58 ? 'Chatbot' : rand() < 0.85 ? 'Humano_Recepcao' : 'Telefone',
            tipo: rand() < 0.62 ? 'Retorno' : 'Primeira_Consulta',
            pag: rand() < 0.24 ? 'Convenio' : 'Particular',
            atraso: 0,
            nps: null,
            foiReagendado: status === 'Reagendado',
          });
        }
        continue;
      }

      const mesAtual = d.getMonth() + 1;
      const qtdDia =
        mesAtual === 11
          ? (isSabado ? 8 : 16)
          : mesAtual === 10
            ? (isSabado ? 5 : 11)
            : (isSabado ? 3 : 6);

      for (let i = 0; i < qtdDia; i++) {
        const par = PARES[(i + d.getDate() + mesAtual) % PARES.length];
        const r = rand();
        const chanceRealizado = mesAtual === 11 ? 0.78 : mesAtual === 10 ? 0.72 : 0.70;
        const chanceCancel = mesAtual === 11 ? 0.09 : 0.12;
        const chanceNoShow = mesAtual === 11 ? 0.05 : 0.08;

        const status: AgendamentoItem['status'] =
          r < chanceRealizado ? 'Realizado'
            : r < chanceRealizado + chanceCancel ? 'Cancelado'
              : r < chanceRealizado + chanceCancel + chanceNoShow ? 'No_Show'
                : 'Reagendado';

        const atrasoBase =
          rand() < 0.50 ? 0
            : rand() < 0.80 ? Math.floor(rand() * 6) + 2
              : Math.floor(rand() * 10) + 7;

        const rNps = rand();
        const notaNps =
          status !== 'Realizado' || rand() > 0.74
            ? null
            : rNps < 0.48 ? 10
              : rNps < 0.80 ? 9
                : rNps < 0.92 ? 8
                  : rNps < 0.97 ? 7
                    : 6;

        await inserirAgendamento({
          pac: pacs[Math.floor(rand() * pacs.length)],
          prof: par.prof,
          proc: par.proc,
          data: dStr,
          hora: slots[(i + par.prof) % slots.length],
          isSabado,
          status,
          origem:
            mesAtual === 11
              ? (rand() < 0.56 ? 'Chatbot' : rand() < 0.86 ? 'Humano_Recepcao' : 'Telefone')
              : (rand() < 0.44 ? 'Chatbot' : rand() < 0.82 ? 'Humano_Recepcao' : 'Telefone'),
          tipo: rand() < 0.64 ? 'Retorno' : 'Primeira_Consulta',
          pag: rand() < 0.26 ? 'Convenio' : 'Particular',
          atraso: atrasoBase,
          nps: notaNps,
          foiReagendado: status === 'Reagendado' || (status === 'Realizado' && rand() < 0.06),
        });
      }
    }

    // 5. Sessões do Chatbot (2026-06-01 até hoje) + 3 transbordos humanos pendentes de hoje
    let sessoesInseridas = 0;
    const limiteChat = new Date(`${hojeStr}T12:00:00`) <= fimPeriodo ? new Date(`${hojeStr}T12:00:00`) : fimPeriodo;
    for (let d = new Date(inicioPeriodo); d <= limiteChat; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) continue;
      const dStr = fmtDate(d);
      const mes = d.getMonth() + 1;
      const qtdSessoes = mes === 11 ? 5 : mes === 10 ? 3 : 2;
      for (let s = 0; s < qtdSessoes; s++) {
        const r = rand();
        const statusSessao =
          r < 0.54 ? 'Agendamento_Concluido'
            : r < 0.86 ? 'Duvida_Resolvida'
              : 'Abandonada';
        const escalonado = statusSessao === 'Abandonada' ? 0 : (rand() < 0.10 ? 1 : 0);
        const hora = `${String(8 + Math.floor(rand() * 10)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00`;
        const inicio = `${dStr} ${hora}`;
        sessoesInseridas++;
        await conn.query(
          `INSERT INTO sessao_chatbot (identificador_chat, data_hora_inicio, data_hora_fim, status_sessao, escalonado_humano)
           VALUES (?, ?, DATE_ADD(?, INTERVAL 4 MINUTE), ?, ?)`,
          [`DEMO-CHAT-${String(sessoesInseridas).padStart(4, '0')}`, inicio, inicio, statusSessao, escalonado]
        );
      }
    }

    const transbordosHoje = [
      {
        chat: 'DEMO-CHAT-HOJE-01',
        convId: 'demo_ap_transbordo_01',
        pac: pacs[8 % pacs.length],
        motivo: 'Solicitação de atendimento humano via WhatsApp — dúvida sobre convênio e pacotes',
      },
      {
        chat: 'DEMO-CHAT-HOJE-02',
        convId: 'demo_ap_transbordo_02',
        pac: pacs[13 % pacs.length],
        motivo: 'Solicitação de atendimento humano via WhatsApp — pedido de encaixe para primeira avaliação',
      },
      {
        chat: 'DEMO-CHAT-HOJE-03',
        convId: 'demo_ap_transbordo_03',
        pac: pacs[22 % pacs.length],
        motivo: 'Solicitação de atendimento humano via WhatsApp — orientação para preparo de consulta nutricional',
      },
    ];
    for (const tb of transbordosHoje) {
      const contatoFinal = String(tb.pac.whatsapp || '0000').replace(/\D/g, '').slice(-4);
      const [sRes] = await conn.query<ResultSetHeader>(
        `INSERT INTO sessao_chatbot (identificador_chat, data_hora_inicio, data_hora_fim, status_sessao, escalonado_humano)
         VALUES (?, NOW(), NULL, 'Em_Andamento', 1)`,
        [tb.chat]
      );
      await conn.query(
        `INSERT INTO whatsapp_sessao_conversa
          (conversation_id, telefone_hash, id_sessao_chatbot, paciente_uuid, etapa, intencao_atual, contexto_json, expira_em)
         VALUES (?, ?, ?, ?, 'MENU_PRINCIPAL', 'menu', ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))
         ON DUPLICATE KEY UPDATE
           id_sessao_chatbot = VALUES(id_sessao_chatbot),
           paciente_uuid = VALUES(paciente_uuid),
           contexto_json = VALUES(contexto_json),
           expira_em = VALUES(expira_em)`,
        [
          tb.convId,
          tb.convId,
          sRes.insertId,
          tb.pac.uuid,
          JSON.stringify({ contatoFinal, escalonadoMotivo: tb.motivo, escalonadoEm: new Date().toISOString() }),
        ]
      );
      sessoesInseridas++;
    }

    await conn.commit();
    console.log(JSON.stringify({
      periodo: '2026-06-01 até 2026-11-30',
      novosPacientesInseridos,
      totalPacientesNoBanco: pacs.length,
      totalAgendamentosInseridos: totalAgendamentos,
      porStatus,
      avaliacoesNpsInseridas: totalNps,
      sessoesChatbotInseridas: sessoesInseridas,
      transbordosPendentesHoje: transbordosHoje.length,
      comunicacoesRegistradas: totalComunicacoes,
    }, null, 2));
  } catch (erro) {
    await conn.rollback();
    throw erro;
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('[Seed Apresentação] Falha ao popular dados fictícios:', err);
  process.exit(1);
});
