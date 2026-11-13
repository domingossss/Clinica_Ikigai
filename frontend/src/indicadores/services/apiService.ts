/* =====================================================================
 * CLÍNICA IKIGAI - CLIENTE DE API REST LOCAL (CLEAN CODE)
 * Arquivo: frontend/src/services/apiService.ts
 * ===================================================================== */

import { type Appointment, type OperationalData, type DashboardDataApiResponse, type SpecialtyTuple } from '../types';

export class ApiService {
  private baseUrl: string;

  constructor(baseUrl = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api`) {
    this.baseUrl = baseUrl;
  }

  /**
   * Obtém os dados completos da clínica persistidos no MySQL
   */
  async fetchDashboardData(signal?: AbortSignal): Promise<{
    operationalData: OperationalData;
    specialties: SpecialtyTuple[];
    appointments: Appointment[];
    abandonedSessions: number[];
  }> {
    const url = `${this.baseUrl}/dashboard/dados-painel`;

    try {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`Falha na requisição ao backend (Status: ${response.status} ${response.statusText})`);
      }

      const data: DashboardDataApiResponse = await response.json();

      if (!Array.isArray(data.D) || !Array.isArray(data.SP) || !Array.isArray(data.CA) || !Array.isArray(data.CHAT) || !/^\d{4}-\d{2}-\d{2}$/.test(data.referencia)) {
        throw new Error('Resposta incompleta da API de indicadores.');
      }
      // Mapeia os dados crus para a interface tipada e limpa de Appointment
      const appointments: Appointment[] = data.D.map(raw => ({
        wasRescheduled: Boolean(raw.reagendado),
        reservedMinutes: Number(raw.minutos),
        dayOffset: raw.d,
        dayOfWeek: raw.w,
        hour: raw.h,
        specialtyIndex: raw.sp,
        status: raw.s,
        delayMinutes: raw.dl,
        delayMeasured: Boolean(raw.atraso_registrado),
        priceCharged: raw.pr,
        npsRating: raw.nt,
        ageBracketIndex: raw.age,
        gender: raw.sx,
        paymentModality: raw.cv,
        isReturn: Boolean(raw.rt),
        isChatbotOrigin: Boolean(raw.bot),
        isEscalatedToHuman: Boolean(raw.esc)
      }));

      return {
        operationalData: { capacity: data.CA, conversations: data.CHAT, referenceDate: data.referencia },
        specialties: data.SP,
        appointments,
        abandonedSessions: data.AB
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error('[ApiService] Erro ao carregar dados do MySQL:', error);
      throw error;
    }
  }

  /**
   * Obtém a lista de especialidades cadastradas no banco
   */
  async fetchSpecialties(): Promise<Array<{ id_especialidade: number; nome: string }>> {
    const response = await fetch(`${this.baseUrl}/dashboard/especialidades`);
    if (!response.ok) {
      throw new Error(`Erro ao buscar especialidades (Status: ${response.status})`);
    }
    return response.json();
  }
}

export const apiService = new ApiService();

