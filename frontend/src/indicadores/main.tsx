/* =====================================================================
 * CLÍNICA IKIGAI - APLICAÇÃO PRINCIPAL FRONTEND (CLEAN CODE TYPESCRIPT)
 * Arquivo: frontend/src/main.ts
 * ===================================================================== */

import { useEffect, useRef } from 'react';
import styles from './styles/main.css?inline';
import template from './index.html?raw';
import { type Appointment, type OperationalData, type CalendarMetricKey, type SpecialtyTuple } from './types';
import { apiService } from './services/apiService';
import { subscribeClinicChanges } from '../services/clinicUpdates';
import { calculatePeriodMetrics } from './core/metricsEngine';
import { renderAlertBanner } from './components/alertBanner';
import { renderMacroCards } from './components/macroCards';
import { renderInformativeCards, renderRulesTable } from './components/informativeCards';
import { CalendarView } from './components/calendarComponent';
import { DrilldownView } from './components/drilldownView';

class ClinicDashboardApp {
  private operationalData: OperationalData = { capacity: [], conversations: [], referenceDate: '' };
  private specialties: SpecialtyTuple[] = [];
  private appointments: Appointment[] = [];
  private abandonedSessions: number[] = [];

  private currentKpiDrilldownId: number | null = null;
  private calendarView: CalendarView;
  private drilldownView: DrilldownView;

  private controller = new AbortController();
  private disposed = false;
  private refreshing = false;
  private refreshPending = false;
  private loaded = false;

  private root: ShadowRoot;

  constructor(root: ShadowRoot) {
    this.root = root;
    this.calendarView = new CalendarView(root);
    this.drilldownView = new DrilldownView(root);
  }

  public async init(): Promise<void> {
    this.setupEventListeners();
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.refreshing) { this.refreshPending = true; return; }
    this.refreshing = true;
    try {
      do {
        this.refreshPending = false;
        await this.loadDataFromDatabase();
      } while (this.refreshPending && !this.disposed);
    } finally { this.refreshing = false; }
  }

  private async loadDataFromDatabase(): Promise<void> {
    const alertEl = this.root.getElementById('alerta');
    try {
      if (alertEl && !this.loaded) {
        alertEl.innerHTML = `
          <div class="note">
            Carregando dados da clínica a partir do banco de dados MySQL...
          </div>
        `;
      }

      const data = await apiService.fetchDashboardData(this.controller.signal);
      if (this.disposed) return;
      const seletor = this.root.getElementById('esp') as HTMLSelectElement | null;
      const indiceAnterior = Number(seletor?.value ?? '-1');
      const especialidadeAnterior = this.specialties[indiceAnterior];
      const chaveAnterior = especialidadeAnterior?.[4] ?? especialidadeAnterior?.[0];
      const anoAnterior = (this.root.getElementById('cy') as HTMLSelectElement | null)?.value;
      this.operationalData = data.operationalData;
      this.specialties = data.specialties;
      this.appointments = data.appointments;
      this.abandonedSessions = data.abandonedSessions;

      this.populateSpecialtyDropdown();
      this.populateYearDropdown();
      if (seletor && chaveAnterior !== undefined) {
        const novoIndice = this.specialties.findIndex(s => (s[4] ?? s[0]) === chaveAnterior);
        seletor.value = String(novoIndice);
      }
      const ano = this.root.getElementById('cy') as HTMLSelectElement | null;
      if (ano && anoAnterior && [...ano.options].some(o => o.value === anoAnterior)) ano.value = anoAnterior;
      this.loaded = true;

      this.render();
    } catch (error) {
      if (this.disposed) return;
      console.error('[DashboardApp] Erro crítico ao conectar ao MySQL:', error);
      if (alertEl) {
        alertEl.innerHTML = `
          <div class="alerta s0" role="alert">
            <span class="dot">✕</span>
            <div>
              <b>Não foi possível carregar os dados do MySQL local</b>
              <small>Verifique a conexão e tente atualizar os indicadores.</small>
            </div>
          </div>
        `;
      }
    }
  }

  private populateSpecialtyDropdown(): void {
    const espSelect = this.root.getElementById('esp') as HTMLSelectElement | null;
    if (!espSelect) return;
    espSelect.replaceChildren(new Option('Todas', '-1'), ...this.specialties.map((spec, index) => new Option(spec[0], String(index))));
  }

  private populateYearDropdown(): void {
    const cySelect = this.root.getElementById('cy') as HTMLSelectElement | null;
    if (!cySelect) return;
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 2, currentYear - 1, currentYear];
    cySelect.innerHTML = years.map(y => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`).join('');
  }

  private setupEventListeners(): void {
    // Filtros de cabeçalho
    ['per', 'esp', 'cm'].forEach(id => {
      this.root.getElementById(id)?.addEventListener('change', () => this.render(), { signal: this.controller.signal });
    });

    // Filtro de ano
    this.root.getElementById('cy')?.addEventListener('change', () => {
      this.calendarView.selectedMonth = null;
      this.render();
    }, { signal: this.controller.signal });

    // Navegação para drill-down do indicador ao clicar em data-kpi-id
    this.root.addEventListener('click', (event: Event) => {
      const target = (event.target as HTMLElement).closest('[data-kpi-id]') as HTMLElement | null;
      if (target && target.dataset.kpiId !== undefined) {
        this.navigateToDrilldown(Number(target.dataset.kpiId));
      }
    }, { signal: this.controller.signal });

    // Botão Voltar do Drill-down
    this.root.getElementById('bk')?.addEventListener('click', () => {
      this.navigateToDrilldown(null);
    }, { signal: this.controller.signal });

    // Seleção de mês no calendário
    this.root.addEventListener('click', (event: Event) => {
      const target = (event.target as HTMLElement).closest('[data-month-index]') as HTMLElement | null;
      if (target && target.dataset.monthIndex !== undefined) {
        this.calendarView.selectedMonth = Number(target.dataset.monthIndex);
        this.render();
        this.root.getElementById('cd')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, { signal: this.controller.signal });

    // Suporte ao botão voltar do navegador
    window.addEventListener('popstate', (event: PopStateEvent) => {
      const stateKpi = event.state?.kpiId ?? null;
      this.navigateToDrilldown(stateKpi, true);
    }, { signal: this.controller.signal });

    // Tecla ESC para fechar drill-down
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.currentKpiDrilldownId !== null) {
        this.navigateToDrilldown(null);
      }
    }, { signal: this.controller.signal });
  }

  private navigateToDrilldown(kpiId: number | null, isFromPopState = false): void {
    this.currentKpiDrilldownId = kpiId;
    if (!isFromPopState) {
      try {
        history.pushState({ kpiId }, '', kpiId !== null ? `#kpi-${kpiId}` : '#');
      } catch {
        // A navegação interna continua disponível quando o histórico está bloqueado.
      }
    }
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (kpiId !== null) {
      this.root.getElementById('bk')?.focus();
    }
  }

  public destroy(): void {
    this.disposed = true;
    this.controller.abort();
    this.calendarView.destroyCharts();
    this.drilldownView.destroyCharts();
  }

  public render(): void {
    const periodDays = Number((this.root.getElementById('per') as HTMLSelectElement)?.value || '30');
    const specialtyFilter = Number((this.root.getElementById('esp') as HTMLSelectElement)?.value || '-1');
    const calendarYear = Number((this.root.getElementById('cy') as HTMLSelectElement)?.value || `${new Date().getFullYear()}`);
    const calendarMetric = ((this.root.getElementById('cm') as HTMLSelectElement)?.value || 'NC') as CalendarMetricKey;

    // Métricas do período atual e anterior
    const currentMetrics = calculatePeriodMetrics(
      this.appointments,
      this.abandonedSessions,
      this.specialties,
      0,
      periodDays,
      specialtyFilter,
      this.operationalData
    );

    const previousMetrics = calculatePeriodMetrics(
      this.appointments,
      this.abandonedSessions,
      this.specialties,
      periodDays,
      periodDays * 2,
      specialtyFilter,
      this.operationalData
    );

    const allMetricsCurrent = specialtyFilter < 0
      ? currentMetrics
      : calculatePeriodMetrics(this.appointments, this.abandonedSessions, this.specialties, 0, periodDays, -1, this.operationalData);

    const allMetricsPrevious = specialtyFilter < 0
      ? previousMetrics
      : calculatePeriodMetrics(this.appointments, this.abandonedSessions, this.specialties, periodDays, periodDays * 2, -1, this.operationalData);

    const homeContainer = this.root.getElementById('home');
    const drilldownContainer = this.root.getElementById('det');

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
        this.operationalData
      );
    } else {
      if (homeContainer) homeContainer.hidden = false;
      if (drilldownContainer) drilldownContainer.hidden = true;

      // 1. Banner de Alerta Dinâmico
      const alertEl = this.root.getElementById('alerta');
      if (alertEl) renderAlertBanner(alertEl, currentMetrics);

      // 2. Cartões Macro com Semáforo
      const macrosEl = this.root.getElementById('macros');
      if (macrosEl) renderMacroCards(macrosEl, currentMetrics, previousMetrics);

      // 3. Cartões Informativos
      const kinfoEl = this.root.getElementById('kinfo');
      if (kinfoEl) renderInformativeCards(kinfoEl, currentMetrics);

      // 4. Tabela de Metas
      const rtEl = this.root.getElementById('rt');
      if (rtEl) renderRulesTable(rtEl);

      // 5. Calendário Anual e Mensal
      this.calendarView.render(
        this.appointments,
        calendarYear,
        calendarMetric,
        specialtyFilter,
        new Date(this.operationalData.referenceDate + 'T12:00:00')
      );
    }
  }
}

export default function Indicadores() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const root = host.current.shadowRoot || host.current.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + styles + '</style>' + template;
    const app = new ClinicDashboardApp(root);
    const unsubscribe = subscribeClinicChanges(() => { void app.refresh(); });
    void app.init();
    return () => { unsubscribe(); app.destroy(); root.replaceChildren(); };
  }, []);
  return <div ref={host} aria-label="Indicadores da clínica" />;
}
