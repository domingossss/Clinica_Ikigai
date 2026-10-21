/* =====================================================================
 * CLÍNICA IKIGAI - APLICAÇÃO PRINCIPAL FRONTEND (CLEAN CODE TYPESCRIPT)
 * Arquivo: frontend/src/main.ts
 * ===================================================================== */

import './styles/main.css';
import { Appointment, CalendarMetricKey, SpecialtyTuple } from './types';
import { apiService } from './services/apiService';
import { calculatePeriodMetrics } from './core/metricsEngine';
import { renderAlertBanner } from './components/alertBanner';
import { renderMacroCards } from './components/macroCards';
import { renderInformativeCards, renderRulesTable } from './components/informativeCards';
import { CalendarView } from './components/calendarComponent';
import { DrilldownView } from './components/drilldownView';

class ClinicDashboardApp {
  private specialties: SpecialtyTuple[] = [];
  private appointments: Appointment[] = [];
  private abandonedSessions: number[] = [];

  private currentKpiDrilldownId: number | null = null;
  private calendarView: CalendarView;
  private drilldownView: DrilldownView;

  constructor() {
    this.calendarView = new CalendarView();
    this.drilldownView = new DrilldownView();
  }

  public async init(): Promise<void> {
    this.setupEventListeners();
    await this.loadDataFromDatabase();
  }

  private async loadDataFromDatabase(): Promise<void> {
    const alertEl = document.getElementById('alerta');
    try {
      if (alertEl) {
        alertEl.innerHTML = `
          <div class="note">
            Carregando dados da clínica a partir do banco de dados MySQL...
          </div>
        `;
      }

      const data = await apiService.fetchDashboardData();
      this.specialties = data.specialties;
      this.appointments = data.appointments;
      this.abandonedSessions = data.abandonedSessions;

      this.populateSpecialtyDropdown();
      this.populateYearDropdown();

      this.render();
    } catch (error) {
      console.error('[DashboardApp] Erro crítico ao conectar ao MySQL:', error);
      if (alertEl) {
        alertEl.innerHTML = `
          <div class="alerta s0" role="alert">
            <span class="dot">✕</span>
            <div>
              <b>Não foi possível carregar os dados do MySQL local</b>
              <small>Verifique se o backend está em execução na porta 3000 (cd backend && npm run dev).</small>
            </div>
          </div>
        `;
      }
    }
  }

  private populateSpecialtyDropdown(): void {
    const espSelect = document.getElementById('esp') as HTMLSelectElement | null;
    if (!espSelect) return;
    espSelect.innerHTML = '<option value="-1">Todas</option>' +
      this.specialties.map((spec, index) => `<option value="${index}">${spec[0]}</option>`).join('');
  }

  private populateYearDropdown(): void {
    const cySelect = document.getElementById('cy') as HTMLSelectElement | null;
    if (!cySelect) return;
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 2, currentYear - 1, currentYear];
    cySelect.innerHTML = years.map(y => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`).join('');
  }

  private setupEventListeners(): void {
    // Filtros de cabeçalho
    ['per', 'esp', 'cm'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this.render());
    });

    // Filtro de ano
    document.getElementById('cy')?.addEventListener('change', () => {
      this.calendarView.selectedMonth = null;
      this.render();
    });

    // Navegação para drill-down do indicador ao clicar em data-kpi-id
    document.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest('[data-kpi-id]') as HTMLElement | null;
      if (target && target.dataset.kpiId !== undefined) {
        this.navigateToDrilldown(Number(target.dataset.kpiId));
      }
    });

    // Botão Voltar do Drill-down
    document.getElementById('bk')?.addEventListener('click', () => {
      this.navigateToDrilldown(null);
    });

    // Seleção de mês no calendário
    document.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest('[data-month-index]') as HTMLElement | null;
      if (target && target.dataset.monthIndex !== undefined) {
        this.calendarView.selectedMonth = Number(target.dataset.monthIndex);
        this.render();
        document.getElementById('cd')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // Suporte ao botão voltar do navegador
    window.addEventListener('popstate', (event: PopStateEvent) => {
      const stateKpi = event.state?.kpiId ?? null;
      this.navigateToDrilldown(stateKpi, true);
    });

    // Tecla ESC para fechar drill-down
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.currentKpiDrilldownId !== null) {
        this.navigateToDrilldown(null);
      }
    });
  }

  private navigateToDrilldown(kpiId: number | null, isFromPopState = false): void {
    this.currentKpiDrilldownId = kpiId;
    if (!isFromPopState) {
      try {
        history.pushState({ kpiId }, '', kpiId !== null ? `#kpi-${kpiId}` : '#');
      } catch (e) {}
    }
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (kpiId !== null) {
      document.getElementById('bk')?.focus();
    }
  }

  public render(): void {
    const periodDays = Number((document.getElementById('per') as HTMLSelectElement)?.value || '30');
    const specialtyFilter = Number((document.getElementById('esp') as HTMLSelectElement)?.value || '-1');
    const calendarYear = Number((document.getElementById('cy') as HTMLSelectElement)?.value || `${new Date().getFullYear()}`);
    const calendarMetric = ((document.getElementById('cm') as HTMLSelectElement)?.value || 'NC') as CalendarMetricKey;

    // Métricas do período atual e anterior
    const currentMetrics = calculatePeriodMetrics(
      this.appointments,
      this.abandonedSessions,
      this.specialties,
      0,
      periodDays,
      specialtyFilter
    );

    const previousMetrics = calculatePeriodMetrics(
      this.appointments,
      this.abandonedSessions,
      this.specialties,
      periodDays,
      periodDays * 2,
      specialtyFilter
    );

    const allMetricsCurrent = specialtyFilter < 0
      ? currentMetrics
      : calculatePeriodMetrics(this.appointments, this.abandonedSessions, this.specialties, 0, periodDays, -1);

    const allMetricsPrevious = specialtyFilter < 0
      ? previousMetrics
      : calculatePeriodMetrics(this.appointments, this.abandonedSessions, this.specialties, periodDays, periodDays * 2, -1);

    const homeContainer = document.getElementById('home');
    const drilldownContainer = document.getElementById('det');

    if (this.currentKpiDrilldownId !== null) {
      if (homeContainer) homeContainer.hidden = true;
      if (drilldownContainer) drilldownContainer.hidden = false;

      this.drilldownView.render(
        this.currentKpiDrilldownId,
        currentMetrics,
        previousMetrics,
        allMetricsCurrent,
        allMetricsPrevious,
        this.appointments,
        this.abandonedSessions,
        this.specialties,
        periodDays,
        specialtyFilter,
        (dim) => {
          this.drilldownView.currentProfileDimension = dim;
          this.render();
        }
      );
    } else {
      if (homeContainer) homeContainer.hidden = false;
      if (drilldownContainer) drilldownContainer.hidden = true;

      // 1. Banner de Alerta Dinâmico
      const alertEl = document.getElementById('alerta');
      if (alertEl) renderAlertBanner(alertEl, currentMetrics);

      // 2. Cartões Macro com Semáforo
      const macrosEl = document.getElementById('macros');
      if (macrosEl) renderMacroCards(macrosEl, currentMetrics, previousMetrics);

      // 3. Cartões Informativos
      const kinfoEl = document.getElementById('kinfo');
      if (kinfoEl) renderInformativeCards(kinfoEl, currentMetrics);

      // 4. Tabela de Metas
      const rtEl = document.getElementById('rt');
      if (rtEl) renderRulesTable(rtEl);

      // 5. Calendário Anual e Mensal
      this.calendarView.render(
        this.appointments,
        calendarYear,
        calendarMetric,
        specialtyFilter
      );
    }
  }
}

// Inicializa a aplicação
const app = new ClinicDashboardApp();
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
