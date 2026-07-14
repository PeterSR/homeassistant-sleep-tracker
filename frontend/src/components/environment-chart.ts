import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant } from "../types";
import { tokens } from "../styles";
import { formatTime } from "../utils";

interface HistoryEntry {
  state: string;
  last_changed?: string;
  lc?: number;
  lu?: number;
}

interface NumericPoint {
  t: number;
  v: number;
}

const CHART_W = 1000;
const CHART_H = 80;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;
const INNER_H = CHART_H - PAD_TOP - PAD_BOTTOM;

@customElement("sleep-tracker-environment-chart")
export class EnvironmentChart extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property() entityId = "";
  @property() startedAt = "";
  @property() endedAt: string | null = null;

  @state() private _history: HistoryEntry[] = [];
  @state() private _loading = true;
  @state() private _error = "";

  willUpdate(changed: PropertyValues): void {
    if (
      changed.has("entityId") ||
      changed.has("startedAt") ||
      changed.has("endedAt")
    ) {
      this._fetchHistory();
    }
  }

  private _fetchGeneration = 0;

  private async _fetchHistory() {
    if (!this.entityId || !this.startedAt) return;
    // Discard superseded responses: if the entity/window changes while a
    // request is in flight, an older response must not overwrite a newer one.
    const gen = ++this._fetchGeneration;
    this._loading = true;
    this._error = "";
    try {
      const start = new Date(this.startedAt).toISOString();
      const end = (this.endedAt
        ? new Date(this.endedAt)
        : new Date()
      ).toISOString();
      const result = await this.hass.callWS<Record<string, HistoryEntry[]>>({
        type: "history/history_during_period",
        start_time: start,
        end_time: end,
        entity_ids: [this.entityId],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      if (gen !== this._fetchGeneration) return;
      this._history = result?.[this.entityId] ?? [];
    } catch (err) {
      if (gen !== this._fetchGeneration) return;
      console.error("Failed to fetch history for", this.entityId, err);
      this._error = "Failed to load history";
    } finally {
      if (gen === this._fetchGeneration) {
        this._loading = false;
      }
    }
  }

  private _stateObj() {
    return this.hass?.states[this.entityId];
  }

  private _name(): string {
    return this._stateObj()?.attributes?.friendly_name || this.entityId;
  }

  private _unit(): string {
    return this._stateObj()?.attributes?.unit_of_measurement || "";
  }

  private _entryTime(h: HistoryEntry): number {
    if (typeof h.lc === "number") return h.lc * 1000;
    if (typeof h.lu === "number") return h.lu * 1000;
    if (h.last_changed) return new Date(h.last_changed).getTime();
    return 0;
  }

  private _numericPoints(): NumericPoint[] {
    const points: NumericPoint[] = [];
    for (const h of this._history) {
      const v = parseFloat(h.state);
      if (Number.isNaN(v)) continue;
      points.push({ t: this._entryTime(h), v });
    }
    return points;
  }

  private get _isNumeric(): boolean {
    if (!this._history.length) return false;
    return this._numericPoints().length > 0;
  }

  private _openMoreInfo(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId: this.entityId },
      })
    );
  }

  private _fmtNum(v: number): string {
    if (Number.isInteger(v)) return v.toString();
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }

  render() {
    const stateObj = this._stateObj();
    const name = this._name();

    if (!stateObj) {
      return html`
        <div class="card unavailable" @click=${this._openMoreInfo}>
          <div class="header">
            <ha-icon icon="mdi:help-circle-outline"></ha-icon>
            <span class="name">${this.entityId}</span>
            <span class="value">unavailable</span>
          </div>
        </div>
      `;
    }

    const unit = this._unit();
    const currentVal = `${stateObj.state}${unit ? ` ${unit}` : ""}`;

    return html`
      <div class="card" @click=${this._openMoreInfo}>
        <div class="header">
          <state-badge .stateObj=${stateObj}></state-badge>
          <span class="name">${name}</span>
          <span class="value">${currentVal}</span>
        </div>
        ${this._loading
          ? html`<div class="status">Loading…</div>`
          : this._error
          ? html`<div class="status error">${this._error}</div>`
          : !this._history.length
          ? html`<div class="status">No history during this session.</div>`
          : this._isNumeric
          ? this._renderLineChart()
          : html`<div class="status">No numeric data during this session.</div>`}
      </div>
    `;
  }

  private _renderLineChart() {
    const startMs = new Date(this.startedAt).getTime();
    const endMs = (this.endedAt
      ? new Date(this.endedAt)
      : new Date()
    ).getTime();
    const totalMs = endMs - startMs;
    if (totalMs <= 0) return nothing;

    const raw = this._numericPoints();
    if (!raw.length) return html`<div class="status">No numeric data</div>`;

    raw.sort((a, b) => a.t - b.t);
    const points: NumericPoint[] = raw.map((p) => ({
      t: Math.min(Math.max(p.t, startMs), endMs),
      v: p.v,
    }));
    if (points[0].t > startMs) {
      points.unshift({ t: startMs, v: points[0].v });
    } else {
      points[0] = { t: startMs, v: points[0].v };
    }
    points.push({ t: endMs, v: points[points.length - 1].v });

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of points) {
      if (p.v < yMin) yMin = p.v;
      if (p.v > yMax) yMax = p.v;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    const yLo = yMin - pad;
    const yHi = yMax + pad;
    const yRange = yHi - yLo;

    const x = (t: number) => ((t - startMs) / totalMs) * CHART_W;
    const y = (v: number) => PAD_TOP + (1 - (v - yLo) / yRange) * INNER_H;

    let lineD = `M${x(points[0].t).toFixed(1)} ${y(points[0].v).toFixed(1)}`;
    let fillD = `M${x(points[0].t).toFixed(1)} ${(PAD_TOP + INNER_H).toFixed(1)} L${x(points[0].t).toFixed(1)} ${y(points[0].v).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const xx = x(points[i].t).toFixed(1);
      const yy = y(points[i].v).toFixed(1);
      lineD += ` H${xx} V${yy}`;
      fillD += ` H${xx} V${yy}`;
    }
    fillD += ` L${x(points[points.length - 1].t).toFixed(1)} ${(PAD_TOP + INNER_H).toFixed(1)} Z`;

    const unit = this._unit();
    const unitSuffix = unit ? ` ${unit}` : "";

    return html`
      <div class="chart-wrap">
        <svg
          class="chart"
          width="100%"
          height=${CHART_H}
          viewBox="0 0 ${CHART_W} ${CHART_H}"
          preserveAspectRatio="none"
        >
          <line
            class="grid"
            x1="0"
            y1=${PAD_TOP}
            x2=${CHART_W}
            y2=${PAD_TOP}
            vector-effect="non-scaling-stroke"
          ></line>
          <line
            class="grid"
            x1="0"
            y1=${PAD_TOP + INNER_H}
            x2=${CHART_W}
            y2=${PAD_TOP + INNER_H}
            vector-effect="non-scaling-stroke"
          ></line>
          <path class="fill" d=${fillD}></path>
          <path
            class="line"
            d=${lineD}
            vector-effect="non-scaling-stroke"
          ></path>
        </svg>
        <span class="y-label y-max">${this._fmtNum(yMax)}${unitSuffix}</span>
        <span class="y-label y-min">${this._fmtNum(yMin)}${unitSuffix}</span>
      </div>
      <div class="x-labels">
        <span>${formatTime(this.startedAt)}</span>
        <span>${this.endedAt ? formatTime(this.endedAt) : "now"}</span>
      </div>
    `;
  }

  static styles = [
    tokens,
    css`
      :host {
        display: block;
      }
      .card {
        background: var(--card-background-color, white);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
        cursor: pointer;
        transition: background 0.15s;
      }
      .card:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .card.unavailable {
        opacity: 0.5;
        cursor: default;
      }
      .header {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        margin-bottom: var(--ha-space-2, 8px);
      }
      .name {
        flex: 1;
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .value {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .status {
        padding: var(--ha-space-3, 12px) 0;
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        text-align: center;
      }
      .status.error {
        color: var(--sleep-color-awake, #d55e00);
      }

      /* Line chart */
      .chart-wrap {
        position: relative;
        width: 100%;
      }
      .chart {
        display: block;
        width: 100%;
        height: 80px;
      }
      .chart .line {
        fill: none;
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 2;
        stroke-linejoin: round;
      }
      .chart .fill {
        fill: var(--primary-color, #03a9f4);
        fill-opacity: 0.12;
        stroke: none;
      }
      .chart .grid {
        stroke: var(--divider-color, #e0e0e0);
        stroke-width: 1;
        stroke-dasharray: 2 3;
        opacity: 0.6;
      }
      .y-label {
        position: absolute;
        right: 4px;
        font-size: 11px;
        color: var(--secondary-text-color);
        background: var(--card-background-color, white);
        padding: 0 3px;
        border-radius: 2px;
        pointer-events: none;
      }
      .y-max {
        top: 0;
      }
      .y-min {
        bottom: 0;
      }

      /* Common */
      .x-labels {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }
    `,
  ];
}
