/* =====================================================================
 * CLÍNICA IKIGAI - DEFINIÇÕES DE TIPOS E INTERFACES (CLEAN CODE)
 * Arquivo: frontend/src/types/index.ts
 * ===================================================================== */

/** Situação clínica de um agendamento */
export type AppointmentStatus = 'R' | 'C' | 'N' | 'M';

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  R: 'Realizada',
  C: 'Cancelada',
  N: 'No-show',
  M: 'Reagendada'
};

/** Tupla de definição de especialidade [Nome, Preço Base, Share %, Taxa Cancel %] */
export type SpecialtyTuple = [string, number, number, number];

export interface Specialty {
  id: number;
  name: string;
  basePrice: number;
  estimatedSharePercent: number;
  estimatedCancellationRate: number;
}

/** Registro de um agendamento individual */
export interface Appointment {
  dayOffset: number;          // Dias passados desde hoje (0 = hoje, 1 = ontem...)
  dayOfWeek: number;          // 0 = Domingo, 1 = Segunda ... 6 = Sábado
  hour: number;               // Hora marcada (8 a 17)
  specialtyIndex: number;     // Índice da especialidade (0 a 5)
  status: AppointmentStatus;  // R, C, N, M
  delayMinutes: number;       // Minutos de atraso real (apenas se Realizado)
  priceCharged: number;       // Valor histórico cobrado (R$)
  npsRating: number | null;   // Nota de satisfação (0 a 10) ou null
  ageBracketIndex: number;    // 0: 0-17, 1: 18-30, 2: 31-45, 3: 46-60, 4: 60+
  gender: 'Feminino' | 'Masculino' | string;
  paymentModality: 'Convênio' | 'Particular' | string;
  isReturn: boolean;          // true se for retorno
  isChatbotOrigin: boolean;   // true se agendado via chatbot
  isEscalatedToHuman: boolean;// true se transferido para humano
}

/** Resumo consolidado de uma especialidade no período */
export interface SpecialtySummary {
  name: string;
  totalAppointments: number;
  completedAppointments: number;
  cancellationRate: number;
  absenceRate: number;
  reschedulingRate: number;
  noShowRate: number;
  averageDelayMinutes: number;
  averageTicket: number;
  totalRevenue: number;
  returnRate: number;
  npsScore: number;
  chatbotOriginRate: number;
}

/** Métricas calculadas para um período específico */
export interface PeriodMetrics {
  filteredAppointments: Appointment[];
  completedAppointments: Appointment[];
  specialtySummaries: SpecialtySummary[];
  ageDistribution: number[];
  totalAppointments: number;
  totalCompleted: number;
  canceledCount: number;
  noShowCount: number;
  rescheduledCount: number;
  totalCapacity: number;
  ratedEvaluationsCount: number;

  reschedulingRate: number;
  noShowRate: number;
  absenceRate: number;
  cancellationRate: number;
  occupancyRate: number;
  averageDelayMinutes: number;

  topSpecialty: { name: string; completedCount: number };
  worstSpecialty: SpecialtySummary | null;
  predominantAgeBracket: string;
  predominantAgeShare: number;
  healthInsuranceShare: number;
  netPromoterScore: number;
  averageTicket: number;
  returnRate: number;

  botAppointmentsCount: number;
  botResolutionRate: number;
  botConversionRate: number;
  totalChatbotConversations: number;
  botCompletedWithoutHuman: number;
}

/** Status do Semáforo (Farol): 0 = Vermelho, 1 = Amarelo, 2 = Verde */
export type TrafficLightStatus = 0 | 1 | 2;

export interface TrafficLightThreshold {
  okThreshold: number;       // Limite para ser verde
  badThreshold: number;      // Limite além do qual se torna vermelho
  direction: -1 | 1;         // -1: menor é melhor; 1: maior é melhor
}

export interface SubKpiScore {
  kpiIndex: number;
  weight: number;
  status: TrafficLightStatus;
  gap: number;
}

export interface MacroAreaScore {
  subKpis: SubKpiScore[];
  score: number;             // Nota de 0 a 100
  status: TrafficLightStatus;// Verde, Amarelo ou Vermelho
}

export interface MacroAreaDefinition {
  name: string;
  description: string;
  subKpis: Array<[number, number]>; // [kpiIndex, peso]
}

export interface KpiDefinition {
  groupId: number;
  title: string;
  formatValue: (metrics: PeriodMetrics) => string;
  getRawValue: ((metrics: PeriodMetrics) => number) | null;
  preferredDirection: 1 | -1 | 0; // 1: maior melhor, -1: menor melhor, 0: informativo
  unit: 'pp' | 'min' | 'rel' | 'pts' | '';
  getSubtitle: (metrics: PeriodMetrics) => string;
}

/** Resposta do endpoint /api/dashboard/dados-painel */
export interface DashboardDataApiResponse {
  SP: SpecialtyTuple[];
  D: Array<{
    d: number;
    w: number;
    h: number;
    sp: number;
    s: AppointmentStatus;
    dl: number;
    pr: number;
    nt: number | null;
    age: number;
    sx: string;
    cv: string;
    rt: boolean;
    bot: boolean;
    esc: boolean;
  }>;
  AB: number[];
}

/** Métrica de coloração do calendário */
export type CalendarMetricKey = 'NC' | 'C' | 'N' | 'R' | 'A';
