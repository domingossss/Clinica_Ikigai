/* =====================================================================
 * CLÍNICA IKIGAI - CLIENTE DE API REST LOCAL (CLEAN CODE)
 * Arquivo: frontend/src/services/apiService.ts
 * ===================================================================== */

import { Appointment, DashboardDataApiResponse, SpecialtyTuple } from '../types';

export class ApiService {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:3000/api') {
    this.baseUrl = baseUrl;
  }

  /**
   * Obtém os dados completos da clínica persistidos no MySQL
   */
  async fetchDashboardData(): Promise<{
    specialties: SpecialtyTuple[];
    appointments: Appointment[];
    abandonedSessions: number[];
  }> {
    const url = `${this.baseUrl}/dashboard/dados-painel`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Falha na requisição ao backend (Status: ${response.status} ${response.statusText})`);
      }

      const data: DashboardDataApiResponse = await response.json();

      // Mapeia os dados crus para a interface tipada e limpa de Appointment
      const appointments: Appointment[] = data.D.map(raw => ({
        dayOffset: raw.d,
        dayOfWeek: raw.w,
        hour: raw.h,
        specialtyIndex: raw.sp,
        status: raw.s,
        delayMinutes: raw.dl,
        priceCharged: raw.pr,
        npsRating: raw.nt,
        ageBracketIndex: raw.age,
        gender: raw.sx,
        paymentModality: raw.cv,
        isReturn: raw.rt,
        isChatbotOrigin: raw.bot,
        isEscalatedToHuman: raw.esc
      }));

      return {
        specialties: data.SP,
        appointments,
        abandonedSessions: data.AB
      };
    } catch (error) {
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
