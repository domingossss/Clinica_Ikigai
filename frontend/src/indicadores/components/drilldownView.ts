/* =====================================================================
 * CLÍNICA IKIGAI - COMPONENTE: VISÃO DETALHADA / DRILL-DOWN (CLEAN CODE)
 * Arquivo: frontend/src/components/drilldownView.ts
 * ===================================================================== */

import { type Appointment, type OperationalData, type PeriodMetrics, type SpecialtyTuple } from '../types';
import { KPI_REGISTRY } from '../core/kpiDefinitions';
import {
  calculateKpiStatus,
  formatMetaDescription,
  TRAFFIC_LIGHT_ICONS,
  TRAFFIC_LIGHT_NAMES,
  TRAFFIC_LIGHT_THRESHOLDS
} from '../core/trafficLight';
import { formatCurrency, formatDeltaHtml, formatPercent } from '../utils/formatters';
import { calculatePeriodMetrics } from '../core/metricsEngine';

import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';
import type { SpecialtySummary } from '../types';

interface DrilldownPanel {
  title: string;
  subtitle?: string;
  isFullWidth?: boolean;
  chartConfig?: ChartConfiguration;
  customHtml?: string;
}

export class DrilldownView {
  private activeCharts: Chart[] = [];
  public currentProfileDimension: 'age' | 'sx' | 'cv' | 'tx' = 'age';

  private root: ShadowRoot;

  constructor(root: ShadowRoot) {
    this.root = root;
  }

  public destroyCharts(): void {
    this.activeCharts.forEach(c => c.destroy());
    this.activeCharts = [];
  }

  private getCssVariable(name: string): string {
    return getComputedStyle(this.root.host).getPropertyValue(name).trim();
  }

  private getPalette(): string[] {
    return [
      this.getCssVariable('--acc'),
      this.getCssVariable('--acc2'),
      this.getCssVariable('--bad'),
      this.getCssVariable('--slate'),
      this.getCssVariable('--ok'),
      '#b58aa5'
    ];
  }

  public render(
    kpiId: number,
    currentMetrics: PeriodMetrics,
    previousMetrics: PeriodMetrics,
    allMetricsCurrent: PeriodMetrics,
    allMetricsPrevious: PeriodMetrics,
    allAppointments: Appointment[],
    abandonedSessions: number[],
    specialties: SpecialtyTuple[],
    periodDays: number,
    specialtyFilter: number,
    operationalData: OperationalData
  ): void {
    this.destroyCharts();

    const kpi = KPI_REGISTRY[kpiId];
    if (!kpi) return;

    const palette = this.getPalette();
    const muteColor = this.getCssVariable('--mute');
    const lineColor = this.getCssVariable('--line');
    const inkColor = this.getCssVariable('--ink');
    const status = calculateKpiStatus(kpiId, currentMetrics);
    const hasThreshold = kpiId in TRAFFIC_LIGHT_THRESHOLDS;
    const badgeHtml = hasThreshold
      ? `
        <span class="badge s${status}">
          <i>${TRAFFIC_LIGHT_ICONS[status]}</i>
          ${TRAFFIC_LIGHT_NAMES[status]}
        </span>
        <span class="s">${formatMetaDescription(kpiId)}</span>
      `
      : '';

    const deltaHtml = formatDeltaHtml(kpi, currentMetrics, previousMetrics);

    // 1. Header do Drill-down (#dh)
    const dhElement = this.root.getElementById('dh');
    if (dhElement) {
      dhElement.innerHTML = `
        <div class="dh">
          <div>
            <div class="t">${kpi.title}</div>
            <div class="big">${kpi.formatValue(currentMetrics)}</div>
          </div>
          <div>
            ${badgeHtml}
            ${deltaHtml}
            <div class="s">${kpi.getSubtitle(currentMetrics)}</div>
          </div>
        </div>
      `;
    }

    // Gerador de Gráfico de Tendência (Atual x Anterior em blocos de dias)
    const buildTrendChart = (
      title: string,
      valueExtractor: (m: PeriodMetrics) => number
    ): DrilldownPanel => {
      const blocksCount = periodDays <= 7 ? 7 : periodDays <= 30 ? 10 : 12;
      const daysPerBlock = Math.ceil(periodDays / blocksCount);
      const labels: string[] = [];
      const currentValues: Array<number | null> = [];
      const previousValues: Array<number | null> = [];

      const today = new Date(operationalData.referenceDate + 'T12:00:00');
      for (let i = 0; i < blocksCount; i++) {
        const high = periodDays - i * daysPerBlock;
        const low = Math.max(0, high - daysPerBlock);
        if (high <= 0) break;

        const curBlockMetrics = calculatePeriodMetrics(allAppointments, abandonedSessions, specialties, low, high, specialtyFilter, operationalData);
        const prevBlockMetrics = calculatePeriodMetrics(allAppointments, abandonedSessions, specialties, low + periodDays, high + periodDays, specialtyFilter, operationalData);

        const blockDate = new Date(today.getTime() - (high - 1) * 864e5);
        labels.push(`${String(blockDate.getDate()).padStart(2, '0')}/${String(blockDate.getMonth() + 1).padStart(2, '0')}`);

        currentValues.push(curBlockMetrics.filteredAppointments.length ? +valueExtractor(curBlockMetrics).toFixed(1) : null);
        previousValues.push(prevBlockMetrics.filteredAppointments.length ? +valueExtractor(prevBlockMetrics).toFixed(1) : null);
      }

      return {
        title,
        subtitle: 'Linha cheia: período atual · tracejada: período anterior',
        chartConfig: {
          type: 'line',
          data: {
            labels,
            datasets: [
              { label: 'Atual', data: currentValues, borderColor: palette[0], backgroundColor: palette[0] + '26', tension: 0.3, pointRadius: 2, fill: true },
              { label: 'Anterior', data: previousValues, borderColor: palette[3], backgroundColor: palette[3] + '26', tension: 0.3, pointRadius: 2, borderDash: [5, 4] }
            ]
          },
          options: {
            maintainAspectRatio: false,
            scales: { x: { grid: { display: false }, ticks: { color: muteColor } }, y: { beginAtZero: true, grid: { color: lineColor }, ticks: { color: muteColor } } },
            plugins: { legend: { display: true, position: 'bottom', labels: { color: muteColor } } }
          }
        }
      };
    };

    // Gerador de Gráfico Radar por Terapia
    const buildRadarByTherapy = (
      title: string,
      subtitle: string,
      extractor: (summary: SpecialtySummary) => number
    ): DrilldownPanel => {
      const specialtyNames = specialties.map(s => s[0]);
      const getRadarData = (metrics: PeriodMetrics) => specialtyNames.map(name => {
        const found = metrics.specialtySummaries.find(s => s.name === name);
        return found ? +extractor(found).toFixed(1) : 0;
      });

      return {
        title,
        subtitle: subtitle || 'Compara todas as terapias (ignora o filtro de especialidade)',
        chartConfig: {
          type: 'radar',
          data: {
            labels: specialtyNames.map(name => name.split(' ')),
            datasets: [
              { label: 'Atual', data: getRadarData(allMetricsCurrent), borderColor: palette[0], backgroundColor: palette[0] + '33', pointBackgroundColor: palette[0] },
              { label: 'Anterior', data: getRadarData(allMetricsPrevious), borderColor: palette[3], backgroundColor: palette[3] + '33', pointBackgroundColor: palette[3] }
            ]
          },
          options: {
            maintainAspectRatio: false,
            scales: {
              r: {
                beginAtZero: true,
                grid: { color: lineColor },
                angleLines: { color: lineColor },
                pointLabels: { color: inkColor, font: { size: 11 } },
                ticks: { color: muteColor, backdropColor: 'transparent' }
              }
            },
            plugins: { legend: { display: true, position: 'bottom', labels: { color: muteColor } } }
          }
        }
      };
    };

    // Configuração dos Conteúdos Específicos de Cada KPI
    let chipsData: Array<[string, string | number]>;
    let panels: DrilldownPanel[];

    switch (kpiId) {
      case 0: // Taxa de Reagendamento
        chipsData = [
          ['Reagendamentos', `${currentMetrics.rescheduledCount} (${formatPercent(currentMetrics.reschedulingRate)})`],
          ['Terapia com maior taxa', `${[...currentMetrics.specialtySummaries].sort((a, b) => b.reschedulingRate - a.reschedulingRate)[0]?.name || '—'}`]
        ];
        panels = [
          buildTrendChart('Evolução da taxa de reagendamento', m => m.reschedulingRate),
          buildRadarByTherapy('Reagendamento por terapia', 'Taxa de remarcação por especialidade', s => s.reschedulingRate)
        ];
        break;

      case 1: // Não comparecimento
        chipsData = [
          ['Consultas perdidas', `${currentMetrics.canceledCount + currentMetrics.noShowCount} (${formatPercent(currentMetrics.absenceRate)})`],
          ['Cancelamentos', `${currentMetrics.canceledCount} (${formatPercent(currentMetrics.cancellationRate)})`],
          ['No-show', `${currentMetrics.noShowCount} (${formatPercent(currentMetrics.noShowRate)})`],
          ['Receita potencial perdida', formatCurrency((currentMetrics.canceledCount + currentMetrics.noShowCount) * currentMetrics.averageTicket)]
        ];
        panels = [
          buildTrendChart('Evolução do não comparecimento (%)', m => m.absenceRate),
          buildRadarByTherapy('Não comparecimento por terapia', 'Perdas de agenda por terapia', s => s.absenceRate),
          {
            title: 'Situação final dos agendamentos',
            subtitle: 'Distribuição dos desfechos da agenda no período',
            chartConfig: {
              type: 'doughnut',
              data: {
                labels: ['Realizadas', 'Reagendadas', 'Canceladas', 'No-show'],
                datasets: [{
                  data: [currentMetrics.totalCompleted, currentMetrics.rescheduledCount, currentMetrics.canceledCount, currentMetrics.noShowCount],
                  backgroundColor: palette,
                  borderColor: this.getCssVariable('--card')
                }]
              },
              options: { maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { color: muteColor } } } }
            }
          }
        ];
        break;

      case 2: // Ocupação da agenda
        chipsData = [
          ['Horários ocupados', currentMetrics.totalAppointments - currentMetrics.canceledCount],
          ['Minutos disponíveis', currentMetrics.totalCapacity],
          ['Minutos livres', Math.max(0, currentMetrics.totalCapacity - currentMetrics.occupiedMinutes)]
        ];
        panels = [
          buildTrendChart('Evolução da ocupação da agenda', m => m.occupancyRate)
        ];
        break;

      case 3: // Atraso Médio
        chipsData = [
          ['Pontuais (até 5 min)', formatPercent((currentMetrics.completedAppointments.filter(a => a.delayMinutes <= 5).length / Math.max(1, currentMetrics.totalCompleted)) * 100)],
          ['Atrasos acima de 30 min', currentMetrics.completedAppointments.filter(a => a.delayMinutes > 30).length],
          ['Atraso médio geral', `${Math.round(currentMetrics.averageDelayMinutes)} min`]
        ];
        panels = [
          buildTrendChart('Evolução do atraso médio (minutos)', m => m.averageDelayMinutes),
          buildRadarByTherapy('Atraso médio por terapia (min)', 'Pontualidade por terapia', s => s.averageDelayMinutes)
        ];
        break;

      case 6: // NPS
        chipsData = [
          ['Avaliações recebidas', currentMetrics.ratedEvaluationsCount],
          ['NPS Score', `${Math.round(currentMetrics.netPromoterScore)} pts`]
        ];
        panels = [
          buildTrendChart('Evolução da satisfação (NPS)', m => m.netPromoterScore),
          buildRadarByTherapy('NPS por terapia', 'Satisfação percebida por terapia', s => s.npsScore)
        ];
        break;

      case 7: // Ticket Médio
        chipsData = [
          ['Receita total realizada', formatCurrency(currentMetrics.completedAppointments.reduce((sum, a) => sum + a.priceCharged, 0))],
          ['Ticket médio por atendimento', formatCurrency(currentMetrics.averageTicket)]
        ];
        panels = [
          buildTrendChart('Evolução do ticket médio (R$)', m => m.averageTicket)
        ];
        break;

      case 8: // Taxa de Retorno
        chipsData = [
          ['Consultas de retorno', currentMetrics.completedAppointments.filter(a => a.isReturn).length],
          ['Taxa de fidelização / retorno', formatPercent(currentMetrics.returnRate)]
        ];
        panels = [
          buildTrendChart('Evolução da taxa de retorno (%)', m => m.returnRate),
          buildRadarByTherapy('Retorno por terapia', '% de consultas de retorno por terapia', s => s.returnRate)
        ];
        break;

      case 9: // Resolução sem Humano
        chipsData = [
          ['Agendamentos pelo bot', currentMetrics.botAppointmentsCount],
          ['Concluídos sem humano', currentMetrics.botCompletedWithoutHuman],
          ['Taxa de resolução autônoma', formatPercent(currentMetrics.botResolutionRate)]
        ];
        panels = [
          buildTrendChart('Evolução da resolução autônoma (%)', m => m.botResolutionRate)
        ];
        break;

      case 10: // Conversão do Chatbot
        chipsData = [
          ['Conversas iniciadas', currentMetrics.totalChatbotConversations],
          ['Agendamentos gerados', currentMetrics.botAppointmentsCount],
          ['Taxa de conversão do bot', formatPercent(currentMetrics.botConversionRate)]
        ];
        panels = [
          buildTrendChart('Evolução da conversão de agendamento (%)', m => m.botConversionRate),
          {
            title: 'Origem dos agendamentos',
            subtitle: 'Chatbot com IA vs Atendimento humano tradicional',
            chartConfig: {
              type: 'doughnut',
              data: {
                labels: ['Chatbot de IA', 'Atendimento humano'],
                datasets: [{
                  data: [currentMetrics.botAppointmentsCount, Math.max(0, currentMetrics.totalAppointments - currentMetrics.botAppointmentsCount)],
                  backgroundColor: [palette[0], palette[3]],
                  borderColor: this.getCssVariable('--card')
                }]
              },
              options: { maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { color: muteColor } } } }
            }
          }
        ];
        break;

      default:
        chipsData = [
          ['Atendimentos concluídos', currentMetrics.totalCompleted],
          ['Total de agendamentos', currentMetrics.totalAppointments]
        ];
        panels = [
          buildTrendChart('Evolução do volume de consultas', m => m.totalCompleted)
        ];
    }

    // 2. Renderiza Chips (#ch)
    const chElement = this.root.getElementById('ch');
    if (chElement) {
      chElement.innerHTML = chipsData.map(([label, val]) => `
        <div><b>${val}</b><span>${label}</span></div>
      `).join('');
    }

    // 3. Renderiza Painéis e Gráficos (#dg)
    const dgElement = this.root.getElementById('dg');
    if (dgElement) {
      dgElement.innerHTML = panels.map((panel, idx) => `
        <div class="p${panel.isFullWidth ? ' w' : ''}">
          <h3>${panel.title}</h3>
          <div class="h">${panel.subtitle || ''}</div>
          ${panel.customHtml || `<div class="cv"><canvas id="drillChart${idx}"></canvas></div>`}
        </div>
      `).join('');

      // Instancia os gráficos Chart.js correspondentes
      panels.forEach((panel, idx) => {
        if (panel.chartConfig) {
          const canvas = this.root.getElementById(`drillChart${idx}`) as HTMLCanvasElement;
          if (canvas) {
            this.activeCharts.push(new Chart(canvas, panel.chartConfig));
          }
        }
      });
    }
  }
}
