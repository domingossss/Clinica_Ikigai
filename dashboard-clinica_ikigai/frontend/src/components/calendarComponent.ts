/* =====================================================================
 * CLÍNICA IKIGAI - COMPONENTE: CALENDÁRIO OPERACIONAL (CLEAN CODE)
 * Arquivo: frontend/src/components/calendarComponent.ts
 * ===================================================================== */

import { Appointment, CalendarMetricKey } from '../types';
import {
  formatFullWeekday,
  MONTH_NAMES,
  MONTH_SEGMENTS,
  WEEKDAY_SHORT_NAMES
} from '../utils/dateUtils';
import { formatNumber, formatPercent } from '../utils/formatters';
import { calculateKpiStatus, TRAFFIC_LIGHT_THRESHOLDS } from '../core/trafficLight';

declare const Chart: any;

interface MetricConfig {
  name: string;
  shortLabel: string;
  isPercent: boolean;
  extractor: (item: { r: number; c: number; n: number; t: number }) => number;
}

export const METRIC_CONFIGS: Record<CalendarMetricKey, MetricConfig> = {
  NC: { name: 'Não comparecimento (%)', shortLabel: 'não comparecimento', isPercent: true, extractor: x => x.c + x.n },
  C: { name: 'Cancelamentos (%)', shortLabel: 'cancelamentos', isPercent: true, extractor: x => x.c },
  N: { name: 'No-show (%)', shortLabel: 'no-show', isPercent: true, extractor: x => x.n },
  R: { name: 'Atendimentos realizados (média diária)', shortLabel: 'atendimentos', isPercent: false, extractor: x => x.r },
  A: { name: 'Agendamentos (média diária)', shortLabel: 'agendamentos', isPercent: false, extractor: x => x.t }
};

interface DayRecord {
  dayOfMonth: number;
  dayOfWeek: number;
  isValid: boolean;
  completed: number;
  canceled: number;
  noShow: number;
  total: number;
}

interface MonthSummary {
  monthIndex: number;
  days: DayRecord[];
  validDays: DayRecord[];
  totalCompleted: number;
  totalCanceled: number;
  totalNoShow: number;
  totalAppointments: number;
  absenceRate: number;
  cancellationRate: number;
  noShowRate: number;
  metricAverage: number;
  weekdayAverages: number[];
  segmentAverages: number[];
}

export class CalendarView {
  private activeCharts: any[] = [];
  public selectedMonth: number | null = null;

  constructor() {}

  public destroyCharts(): void {
    this.activeCharts.forEach(chart => chart.destroy());
    this.activeCharts = [];
  }

  private getCssVariable(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
    appointments: Appointment[],
    year: number,
    metricKey: CalendarMetricKey,
    specialtyFilterIndex: number,
    baseDate = new Date()
  ): void {
    this.destroyCharts();

    const metricConfig = METRIC_CONFIGS[metricKey];
    const palette = this.getPalette();
    const muteColor = this.getCssVariable('--mute');
    const lineColor = this.getCssVariable('--line');
    const rgbAccent = this.getCssVariable('--rgb');
    const inkColor = this.getCssVariable('--ink');
    const onAccentColor = this.getCssVariable('--onacc');

    const oldestAllowedDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - 729);

    // Agrupa agendamentos do ano selecionado por dia do ano (mês * 32 + dia)
    const dailyMap: Record<number, { r: number; c: number; n: number; m: number; t: number }> = {};
    appointments.forEach(app => {
      if (specialtyFilterIndex >= 0 && app.specialtyIndex !== specialtyFilterIndex) return;
      const appDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - app.dayOffset);
      if (appDate.getFullYear() !== year) return;

      const key = appDate.getMonth() * 32 + appDate.getDate();
      if (!dailyMap[key]) {
        dailyMap[key] = { r: 0, c: 0, n: 0, m: 0, t: 0 };
      }
      dailyMap[key].t++;
      if (app.status === 'R') dailyMap[key].r++;
      if (app.status === 'C') dailyMap[key].c++;
      if (app.status === 'N') dailyMap[key].n++;
      if (app.status === 'M') dailyMap[key].m++;
    });

    const calculateGroupRate = (
      list: DayRecord[],
      extractor: (d: { r: number; c: number; n: number; t: number }) => number
    ): number => {
      const total = list.reduce((sum, item) => sum + item.total, 0);
      if (total === 0) return 0;
      const metricSum = list.reduce((sum, item) => sum + extractor({ r: item.completed, c: item.canceled, n: item.noShow, t: item.total }), 0);
      return (metricSum / total) * 100;
    };

    const calculateGroupAverage = (list: DayRecord[]): number => {
      if (metricConfig.isPercent) {
        return calculateGroupRate(list, metricConfig.extractor);
      }
      if (list.length === 0) return 0;
      const sum = list.reduce((acc, item) => acc + metricConfig.extractor({ r: item.completed, c: item.canceled, n: item.noShow, t: item.total }), 0);
      return sum / list.length;
    };

    const splitSegments = (list: DayRecord[]): [DayRecord[], DayRecord[], DayRecord[]] => [
      list.filter(d => d.dayOfMonth <= 10),
      list.filter(d => d.dayOfMonth > 10 && d.dayOfMonth <= 20),
      list.filter(d => d.dayOfMonth > 20)
    ];

    const monthsSummary: MonthSummary[] = [];
    const weekdaysOrder = [1, 2, 3, 4, 5, 6]; // Seg..Sáb

    for (let monthIdx = 0; monthIdx < 12; monthIdx++) {
      const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
      const daysList: DayRecord[] = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, monthIdx, day);
        const isValid = currentDate >= oldestAllowedDate && currentDate <= baseDate && currentDate.getDay() !== 0;
        const key = monthIdx * 32 + day;
        const record = (isValid && dailyMap[key]) ? dailyMap[key] : { r: 0, c: 0, n: 0, m: 0, t: 0 };

        daysList.push({
          dayOfMonth: day,
          dayOfWeek: currentDate.getDay(),
          isValid,
          completed: record.r,
          canceled: record.c,
          noShow: record.n,
          total: record.t
        });
      }

      const validDays = daysList.filter(d => d.isValid);
      const totalCompleted = validDays.reduce((acc, d) => acc + d.completed, 0);
      const totalCanceled = validDays.reduce((acc, d) => acc + d.canceled, 0);
      const totalNoShow = validDays.reduce((acc, d) => acc + d.noShow, 0);
      const totalAppointments = validDays.reduce((acc, d) => acc + d.total, 0);

      monthsSummary.push({
        monthIndex: monthIdx,
        days: daysList,
        validDays,
        totalCompleted,
        totalCanceled,
        totalNoShow,
        totalAppointments,
        absenceRate: totalAppointments ? ((totalCanceled + totalNoShow) / totalAppointments) * 100 : 0,
        cancellationRate: totalAppointments ? (totalCanceled / totalAppointments) * 100 : 0,
        noShowRate: totalAppointments ? (totalNoShow / totalAppointments) * 100 : 0,
        metricAverage: calculateGroupAverage(validDays),
        weekdayAverages: weekdaysOrder.map(w => calculateGroupAverage(validDays.filter(d => d.dayOfWeek === w))),
        segmentAverages: splitSegments(validDays).map(calculateGroupAverage)
      });
    }

    const allValidDays = monthsSummary.flatMap(m => m.validDays);
    const annualWeekdayAverages = weekdaysOrder.map(w => calculateGroupAverage(allValidDays.filter(d => d.dayOfWeek === w)));
    const annualSegmentAverages = splitSegments(allValidDays).map(calculateGroupAverage);
    const annualAverage = calculateGroupAverage(allValidDays);

    const absenceExtractor = (x: { r: number; c: number; n: number; t: number }) => x.c + x.n;
    const weekdayAbsenceRates = weekdaysOrder.map(w => calculateGroupRate(allValidDays.filter(d => d.dayOfWeek === w), absenceExtractor));
    const weekdayCanceledRates = weekdaysOrder.map(w => calculateGroupRate(allValidDays.filter(d => d.dayOfWeek === w), x => x.c));
    const weekdayNoShowRates = weekdaysOrder.map(w => calculateGroupRate(allValidDays.filter(d => d.dayOfWeek === w), x => x.n));
    const annualAbsenceRate = calculateGroupRate(allValidDays, absenceExtractor);
    const segmentAbsenceRates = splitSegments(allValidDays).map(l => calculateGroupRate(l, absenceExtractor));

    const activeMonths = monthsSummary.filter(m => m.validDays.length >= 5);
    const bestMonth = [...activeMonths].sort((a, b) => b.metricAverage - a.metricAverage)[0];
    const worstAbsenceMonth = [...activeMonths].sort((a, b) => b.absenceRate - a.absenceRate)[0];

    if (this.selectedMonth === null || !monthsSummary[this.selectedMonth]?.validDays.length) {
      this.selectedMonth = year === baseDate.getFullYear() ? baseDate.getMonth() : (bestMonth ? bestMonth.monthIndex : 0);
    }

    // Helper de estilização de calor
    const getHeatColorStyle = (value: number, maxVal: number): string => {
      const intensity = (0.08 + 0.87 * Math.min(1, value / maxVal)).toFixed(2);
      const color = value / maxVal > 0.55 ? onAccentColor : inkColor;
      return `background: rgba(${rgbAccent}, ${intensity}); color: ${color};`;
    };

    const formatVal = (v: number): string => metricConfig.isPercent ? `${formatNumber(v, 1)}%` : formatNumber(v, 1);
    const maxDayVal = Math.max(1e-9, ...allValidDays.map(d => metricConfig.isPercent ? (d.total ? metricConfig.extractor(d) / d.total * 100 : 0) : metricConfig.extractor(d)));

    // 1. Resumo textual de Ausências (#ci)
    const worstWeekdayIdx = weekdayAbsenceRates.indexOf(Math.max(...weekdayAbsenceRates));
    const worstSegmentIdx = segmentAbsenceRates.indexOf(Math.max(...segmentAbsenceRates));
    const ciElement = document.getElementById('ci');
    if (ciElement) {
      ciElement.innerHTML = worstAbsenceMonth
        ? `<b>Onde as ausências pesam mais em ${year}:</b> <strong>${formatFullWeekday(worstWeekdayIdx)}</strong> com ${formatNumber(Math.max(...weekdayAbsenceRates))}% de não comparecimento (média anual de ${formatNumber(annualAbsenceRate)}%) · pior mês: <strong>${MONTH_NAMES[worstAbsenceMonth.monthIndex]}</strong> (${formatNumber(worstAbsenceMonth.absenceRate)}%) · parte do mês: <strong>${MONTH_SEGMENTS[worstSegmentIdx].split(' (')[0].toLowerCase()}</strong> (${formatNumber(Math.max(...segmentAbsenceRates))}%).`
        : 'Sem dados para este ano.';
    }

    // 2. Chips do Ano (#cc)
    const ccElement = document.getElementById('cc');
    if (ccElement) {
      const bestWeekdayAnnual = annualWeekdayAverages.indexOf(Math.max(...annualWeekdayAverages));
      const bestSegmentAnnual = annualSegmentAverages.indexOf(Math.max(...annualSegmentAverages));
      ccElement.innerHTML = [
        [`Mês com maior ${metricConfig.shortLabel}`, bestMonth ? `${MONTH_NAMES[bestMonth.monthIndex]} · ${formatVal(bestMonth.metricAverage)}` : '—'],
        [`Dia da semana com maior ${metricConfig.shortLabel}`, allValidDays.length ? `${WEEKDAY_SHORT_NAMES[bestWeekdayAnnual]} · ${formatVal(Math.max(...annualWeekdayAverages))}` : '—'],
        [`Parte do mês com maior ${metricConfig.shortLabel}`, allValidDays.length ? `${MONTH_SEGMENTS[bestSegmentAnnual].split(' (')[0]} · ${formatVal(Math.max(...annualSegmentAverages))}` : '—']
      ].map(([label, val]) => `<div><b>${val}</b><span>${label}</span></div>`).join('');
    }

    // 3. Grid Consolidado do Ano: Matriz Mês × Dia da Semana (#cyr)
    const cyrElement = document.getElementById('cyr');
    if (cyrElement) {
      const maxWeekdayVal = Math.max(1e-9, ...monthsSummary.flatMap(m => m.weekdayAverages));
      const getCellStyle = (v: number) => metricKey === 'NC'
        ? `class="f${calculateKpiStatus(1, { absenceRate: v } as any)}"`
        : `style="${getHeatColorStyle(v, maxWeekdayVal)}"`;

      const matrixRows = monthsSummary.map(ms => {
        const monthLabel = `<div class="l">${MONTH_NAMES[ms.monthIndex].slice(0, 3)}</div>`;
        if (!ms.validDays.length) return monthLabel + '<div class="l">–</div>'.repeat(7);
        const cells = ms.weekdayAverages.map(v => `<div ${getCellStyle(v)}>${formatVal(v)}</div>`).join('');
        return monthLabel + cells + `<div ${getCellStyle(ms.metricAverage)}><b>${formatVal(ms.metricAverage)}</b></div>`;
      }).join('');

      const matrixHtml = `
        <div class="hm" style="grid-template-columns: 44px repeat(6, 1fr) 58px; min-width: 470px;">
          <div class="l"></div>
          ${WEEKDAY_SHORT_NAMES.map(d => `<div class="l">${d}</div>`).join('')}
          <div class="l">Mês</div>
          ${matrixRows}
          <div class="l"><b>Ano</b></div>
          ${annualWeekdayAverages.map(v => `<div ${getCellStyle(v)}><b>${formatVal(v)}</b></div>`).join('')}
          <div ${getCellStyle(annualAverage)}><b>${formatVal(annualAverage)}</b></div>
        </div>
      `;

      cyrElement.innerHTML = `
        <div class="p w">
          <h3>Mês × dia da semana · ${metricConfig.name}</h3>
          <div class="h">${metricKey === 'NC' ? `Cor pelo semáforo: verde ≤ 15% · amarelo ≤ 20% · vermelho acima` : 'Cores mais intensas indicam maior volume/taxa'}</div>
          <div style="overflow-x: auto;">${matrixHtml}</div>
        </div>
        <div class="p">
          <h3>Ausências por dia da semana (Ano todo)</h3>
          <div class="h">% dos agendamentos · cancelamentos e no-show empilhados</div>
          <div class="cv"><canvas id="cwd"></canvas></div>
        </div>
        <div class="p">
          <h3>Dia da semana ao longo dos meses</h3>
          <div class="h">${metricConfig.name} por dia da semana</div>
          <div class="cv"><canvas id="cwm"></canvas></div>
        </div>
      `;

      // Gráficos do Ano
      const cwdCtx = document.getElementById('cwd') as HTMLCanvasElement;
      if (cwdCtx) {
        this.activeCharts.push(new Chart(cwdCtx, {
          type: 'bar',
          data: {
            labels: [...WEEKDAY_SHORT_NAMES],
            datasets: [
              { label: 'Cancelamentos', data: weekdayCanceledRates.map(v => +v.toFixed(1)), backgroundColor: palette[2] },
              { label: 'No-show', data: weekdayNoShowRates.map(v => +v.toFixed(1)), backgroundColor: palette[1] }
            ]
          },
          options: {
            maintainAspectRatio: false,
            scales: { x: { stacked: true, grid: { display: false }, ticks: { color: muteColor } }, y: { stacked: true, beginAtZero: true, grid: { color: lineColor }, ticks: { color: muteColor } } },
            plugins: { legend: { display: true, position: 'bottom', labels: { color: muteColor } } }
          }
        }));
      }

      const cwmCtx = document.getElementById('cwm') as HTMLCanvasElement;
      if (cwmCtx) {
        this.activeCharts.push(new Chart(cwmCtx, {
          type: 'line',
          data: {
            labels: MONTH_NAMES.map(m => m.slice(0, 3)),
            datasets: WEEKDAY_SHORT_NAMES.map((name, i) => ({
              label: name,
              data: monthsSummary.map(ms => ms.validDays.length ? +ms.weekdayAverages[i].toFixed(1) : null),
              borderColor: palette[i],
              backgroundColor: palette[i] + '33',
              tension: 0.3,
              pointRadius: 2,
              spanGaps: true
            }))
          },
          options: {
            maintainAspectRatio: false,
            scales: { x: { grid: { display: false }, ticks: { color: muteColor } }, y: { beginAtZero: true, grid: { color: lineColor }, ticks: { color: muteColor } } },
            plugins: { legend: { display: true, position: 'bottom', labels: { color: muteColor } } }
          }
        }));
      }
    }

    // 4. Cartões dos 12 Meses (#cal)
    const calElement = document.getElementById('cal');
    if (calElement) {
      calElement.innerHTML = monthsSummary.map(ms => {
        const isCurrentSelected = ms.monthIndex === this.selectedMonth;
        const statusClass = ms.validDays.length
          ? ` s${calculateKpiStatus(1, { absenceRate: ms.absenceRate } as any)}`
          : '';
        const selectedClass = isCurrentSelected ? ' on' : '';
        const disabledAttr = ms.validDays.length ? '' : ' disabled';

        const firstWeekdayOffset = (new Date(year, ms.monthIndex, 1).getDay() + 6) % 7;
        const emptyDaysHtml = '<i></i>'.repeat(firstWeekdayOffset);

        const miniGridHtml = ms.days.map(d => {
          if (!d.isValid) return `<i class="off">${d.dayOfMonth}</i>`;
          const val = metricConfig.isPercent ? (d.total ? metricConfig.extractor(d) / d.total * 100 : 0) : metricConfig.extractor(d);
          return `<i style="${getHeatColorStyle(val, maxDayVal)}">${d.dayOfMonth}</i>`;
        }).join('');

        return `
          <button class="mc${statusClass}${selectedClass}" data-month-index="${ms.monthIndex}" aria-pressed="${isCurrentSelected}"${disabledAttr}>
            <b>${MONTH_NAMES[ms.monthIndex]}</b>
            ${ms.validDays.length
              ? `<span>Atend. ${ms.totalCompleted} · NC <strong>${formatNumber(ms.absenceRate)}%</strong></span><br><span>Cancel. ${formatNumber(ms.cancellationRate)}% · No-show ${formatNumber(ms.noShowRate)}%</span>`
              : '<span>Sem dados</span>'
            }
            <div class="mg">
              ${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(l => `<i class="l">${l}</i>`).join('')}
              ${emptyDaysHtml}
              ${miniGridHtml}
            </div>
          </button>
        `;
      }).join('');
    }

    // 5. Detalhe do Mês Selecionado (#cd)
    this.renderMonthDetail(monthsSummary, year, metricConfig, palette, muteColor, lineColor, rgbAccent);
  }

  private renderMonthDetail(
    monthsSummary: MonthSummary[],
    year: number,
    metricConfig: MetricConfig,
    palette: string[],
    muteColor: string,
    lineColor: string,
    rgbAccent: string
  ): void {
    const cdElement = document.getElementById('cd');
    if (!cdElement || this.selectedMonth === null) return;

    const monthData = monthsSummary[this.selectedMonth];
    if (!monthData) return;

    const bestWeekday = monthData.weekdayAverages.indexOf(Math.max(...monthData.weekdayAverages));
    const bestSegment = monthData.segmentAverages.indexOf(Math.max(...monthData.segmentAverages));

    const statsChips = [
      ['Atendimentos realizados', monthData.totalCompleted],
      ['Não comparecimento', `${formatNumber(monthData.absenceRate)}% · ${monthData.totalCanceled + monthData.totalNoShow} consultas`],
      ['Cancelamentos', `${formatNumber(monthData.cancellationRate)}% · ${monthData.totalCanceled}`],
      ['No-show', `${formatNumber(monthData.noShowRate)}% · ${monthData.totalNoShow}`],
      [`Dia da semana com maior ${metricConfig.shortLabel}`, monthData.validDays.length ? `${WEEKDAY_SHORT_NAMES[bestWeekday]} · ${formatNumber(monthData.weekdayAverages[bestWeekday])}${metricConfig.isPercent ? '%' : ''}` : '—'],
      [`Parte do mês com maior ${metricConfig.shortLabel}`, monthData.validDays.length ? `${MONTH_SEGMENTS[bestSegment].split(' (')[0]} · ${formatNumber(monthData.segmentAverages[bestSegment])}${metricConfig.isPercent ? '%' : ''}` : '—']
    ];

    const firstWeekdayOffset = (new Date(year, this.selectedMonth, 1).getDay() + 6) % 7;
    const maxDayVal = Math.max(1e-9, ...monthData.validDays.map(d => metricConfig.isPercent ? (d.total ? metricConfig.extractor(d) / d.total * 100 : 0) : metricConfig.extractor(d)));

    const daysGridHtml = `
      <div class="cg">
        ${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(d => `<i class="l">${d}</i>`).join('')}
        ${'<i></i>'.repeat(firstWeekdayOffset)}
        ${monthData.days.map(d => {
          if (!d.isValid) return `<i class="off">${d.dayOfMonth}</i>`;
          const val = metricConfig.isPercent ? (d.total ? metricConfig.extractor(d) / d.total * 100 : 0) : metricConfig.extractor(d);
          const intensity = (0.08 + 0.87 * Math.min(1, val / maxDayVal)).toFixed(2);
          const ncPercent = d.total ? Math.round((d.canceled + d.noShow) / d.total * 100) : 0;
          return `
            <i style="background: rgba(${rgbAccent}, ${intensity});">
              ${d.dayOfMonth}
              <b>${d.completed}</b>
              <small>${d.total ? `NC ${ncPercent}%` : '—'}</small>
            </i>
          `;
        }).join('')}
      </div>
    `;

    cdElement.innerHTML = `
      <div class="chips">
        ${statsChips.map(([label, val]) => `<div><b>${val}</b><span>${label}</span></div>`).join('')}
      </div>
      <div class="grid">
        <div class="p w">
          <h3>${MONTH_NAMES[this.selectedMonth]} de ${year}</h3>
          <div class="h">Atendimentos diários realizados e % de não comparecimento</div>
          ${daysGridHtml}
        </div>
        <div class="p w">
          <h3>Evolução dia a dia em ${MONTH_NAMES[this.selectedMonth]} (%)</h3>
          <div class="h">Não comparecimento, cancelamentos e no-show por dia</div>
          <div class="cv"><canvas id="cdl"></canvas></div>
        </div>
      </div>
    `;

    // Gráfico de Linha do Dia a Dia do Mês
    const cdlCtx = document.getElementById('cdl') as HTMLCanvasElement;
    if (cdlCtx) {
      const labels = monthData.days.map(d => d.dayOfMonth);
      const toPercent = (d: DayRecord, fn: (x: DayRecord) => number) => d.isValid && d.total ? +(fn(d) / d.total * 100).toFixed(1) : null;

      this.activeCharts.push(new Chart(cdlCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Não comparecimento', data: monthData.days.map(d => toPercent(d, x => x.canceled + x.noShow)), borderColor: palette[2], backgroundColor: palette[2] + '33', tension: 0.3, pointRadius: 2, spanGaps: true },
            { label: 'Cancelamentos', data: monthData.days.map(d => toPercent(d, x => x.canceled)), borderColor: palette[1], backgroundColor: palette[1] + '33', tension: 0.3, pointRadius: 2, spanGaps: true },
            { label: 'No-show', data: monthData.days.map(d => toPercent(d, x => x.noShow)), borderColor: palette[3], backgroundColor: palette[3] + '33', tension: 0.3, pointRadius: 2, spanGaps: true }
          ]
        },
        options: {
          maintainAspectRatio: false,
          scales: { x: { grid: { display: false }, ticks: { color: muteColor } }, y: { beginAtZero: true, grid: { color: lineColor }, ticks: { color: muteColor } } },
          plugins: { legend: { display: true, position: 'bottom', labels: { color: muteColor } } }
        }
      }));
    }
  }
}
