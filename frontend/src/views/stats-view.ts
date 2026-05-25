import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, StatsData, TrackerState, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, statStyles } from "../styles";
import { formatDuration } from "../utils";

import "../components/averages-card";

@customElement("sleep-tracker-stats-view")
export class StatsView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) trackerState!: TrackerState;
  @property({ type: Boolean }) narrow = false;

  @state() private _stats: StatsData | null = null;
  @state() private _loading = true;
  @state() private _range = 30;

  connectedCallback(): void {
    super.connectedCallback();
    this._setToolbar();
    this._load();
  }

  private _setToolbar() {
    this.dispatchEvent(
      new CustomEvent<ToolbarConfig>("set-toolbar", {
        bubbles: true,
        composed: true,
        detail: { title: "Sleep Stats", backPath: "/" },
      })
    );
  }

  private async _load() {
    this._loading = true;
    try {
      this._stats = await this.api.getStats(this._range);
    } catch (err) {
      console.error("Failed to load stats:", err);
    } finally {
      this._loading = false;
    }
  }

  private _setRange(days: number) {
    this._range = days;
    this._load();
  }

  private _navigate(path: string) {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        bubbles: true,
        composed: true,
        detail: { path },
      })
    );
  }

  render() {
    if (this._loading) {
      return html`<div class="container"><p>Loading...</p></div>`;
    }
    if (!this._stats) {
      return html`<div class="container"><p>No data.</p></div>`;
    }

    const s = this._stats;

    return html`
      <div class="container">
        <div class="range-tabs">
          ${[7, 14, 30, 90].map(
            (d) => html`
              <button
                class="range-tab ${this._range === d ? "active" : ""}"
                @click=${() => this._setRange(d)}
              >
                ${d}d
              </button>
            `
          )}
        </div>

        <sleep-tracker-averages-card .stats=${s}></sleep-tracker-averages-card>

        ${s.daily.length > 0
          ? html`
              <ha-card>
                <div class="card-header">Sleep Duration</div>
                <div class="chart">
                  ${s.daily.map((d) => {
                    const maxMin = Math.max(...s.daily.map((x) => x.total_sleep_minutes), 1);
                    const pct = (d.total_sleep_minutes / maxMin) * 100;
                    const hrs = d.total_sleep_minutes / 60;
                    return html`
                      <div
                        class="chart-row"
                        @click=${() => this._navigate(`/night/${d.session_id}`)}
                      >
                        <span class="chart-label">${this._shortDate(d.date)}</span>
                        <div class="chart-bar-bg">
                          <div
                            class="chart-bar"
                            style="width: ${pct}%"
                          ></div>
                        </div>
                        <span class="chart-value">${hrs.toFixed(1)}h</span>
                      </div>
                    `;
                  })}
                </div>
              </ha-card>

              ${this._renderHistogram({
                title: "Sleep Duration Distribution",
                subtitle: "30 min buckets",
                values: s.daily.map((d) => d.total_sleep_minutes).filter((x) => x > 0),
                bucketSize: 30,
                formatLabel: (m) => this._formatBucketLabel(m),
                formatRange: (a, b) => `${formatDuration(a)}–${formatDuration(b)}`,
                unit: "night",
                barClass: "",
              })}

              <ha-card>
                <div class="card-header">Efficiency</div>
                <div class="chart">
                  ${s.daily.map((d) => {
                    const pct = d.sleep_efficiency * 100;
                    return html`
                      <div
                        class="chart-row"
                        @click=${() => this._navigate(`/night/${d.session_id}`)}
                      >
                        <span class="chart-label">${this._shortDate(d.date)}</span>
                        <div class="chart-bar-bg">
                          <div
                            class="chart-bar efficiency"
                            style="width: ${pct}%"
                          ></div>
                        </div>
                        <span class="chart-value">${Math.round(pct)}%</span>
                      </div>
                    `;
                  })}
                </div>
              </ha-card>

              <ha-card>
                <div class="card-header">Awakenings</div>
                <div class="chart">
                  ${s.daily.map((d) => {
                    const maxA = Math.max(...s.daily.map((x) => x.awakenings), 1);
                    const pct = (d.awakenings / maxA) * 100;
                    return html`
                      <div
                        class="chart-row"
                        @click=${() => this._navigate(`/night/${d.session_id}`)}
                      >
                        <span class="chart-label">${this._shortDate(d.date)}</span>
                        <div class="chart-bar-bg">
                          <div
                            class="chart-bar awakenings"
                            style="width: ${pct}%"
                          ></div>
                        </div>
                        <span class="chart-value">${d.awakenings}</span>
                      </div>
                    `;
                  })}
                </div>
              </ha-card>

              ${this._renderHistogram({
                title: "Awakenings Distribution",
                subtitle: "per night",
                values: s.daily.map((d) => d.awakenings),
                bucketSize: 1,
                formatLabel: (n) => `${n}`,
                formatRange: (a) => `${a} awakening${a !== 1 ? "s" : ""}`,
                unit: "night",
                barClass: "awakenings",
              })}
            `
          : html`<p class="empty">No sleep data in this range.</p>`}
      </div>
    `;
  }

  private _shortDate(iso: string): string {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  private _renderHistogram(opts: {
    title: string;
    subtitle: string;
    values: number[];
    bucketSize: number;
    formatLabel: (bucketStart: number) => string;
    formatRange: (bucketStart: number, bucketEnd: number) => string;
    unit: string;
    barClass: string;
  }) {
    const { title, subtitle, values, bucketSize, formatLabel, formatRange, unit, barClass } = opts;
    if (values.length === 0) return nothing;

    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const startBucket = Math.floor(minV / bucketSize) * bucketSize;
    const endBucket = Math.floor(maxV / bucketSize) * bucketSize;
    const bucketCount = (endBucket - startBucket) / bucketSize + 1;

    const counts = new Array(bucketCount).fill(0);
    for (const v of values) {
      const idx = Math.min(bucketCount - 1, Math.floor((v - startBucket) / bucketSize));
      counts[idx]++;
    }
    const maxCount = Math.max(...counts, 1);

    return html`
      <ha-card>
        <div class="card-header">
          ${title}
          <span class="session-count">${subtitle}</span>
        </div>
        <div class="histogram">
          ${counts.map((count, i) => {
            const bucketStart = startBucket + i * bucketSize;
            const heightPct = (count / maxCount) * 100;
            return html`
              <div class="hist-col" title="${formatRange(bucketStart, bucketStart + bucketSize)}: ${count} ${unit}${count !== 1 ? "s" : ""}">
                <span class="hist-count">${count > 0 ? count : ""}</span>
                <div class="hist-bar-track">
                  <div
                    class="hist-bar ${barClass}"
                    style="height: ${heightPct}%"
                  ></div>
                </div>
                <span class="hist-label">${formatLabel(bucketStart)}</span>
              </div>
            `;
          })}
        </div>
      </ha-card>
    `;
  }

  private _formatBucketLabel(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}:${String(m).padStart(2, "0")}`;
  }

  static styles = [
    tokens,
    viewStyles,
    statStyles,
    css`
      .range-tabs {
        display: flex;
        gap: var(--ha-space-2, 8px);
        margin-bottom: var(--ha-space-4, 16px);
        justify-content: center;
      }
      .range-tab {
        padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        background: var(--card-background-color, white);
        color: var(--primary-text-color);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
        font-family: inherit;
      }
      .range-tab.active {
        background: var(--primary-color, #03a9f4);
        color: white;
        border-color: var(--primary-color, #03a9f4);
      }
      ha-card {
        padding: var(--ha-space-4, 16px);
        margin-bottom: var(--ha-space-4, 16px);
      }
      .card-header {
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
        margin-bottom: var(--ha-space-4, 16px);
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .session-count {
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-normal, 400);
        color: var(--secondary-text-color);
      }
      .chart {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-1, 4px);
      }
      .chart-row {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        cursor: pointer;
        padding: 2px 0;
        border-radius: var(--ha-border-radius-sm, 4px);
      }
      .chart-row:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .chart-label {
        width: 50px;
        font-size: var(--ha-font-size-xs, 10px);
        color: var(--secondary-text-color);
        text-align: right;
        flex-shrink: 0;
      }
      .chart-bar-bg {
        flex: 1;
        height: 14px;
        background: var(--secondary-background-color, #f5f5f5);
        border-radius: 3px;
        overflow: hidden;
      }
      .chart-bar {
        height: 100%;
        background: var(--sleep-color-asleep, #0072B2);
        border-radius: 3px;
        transition: width 0.3s ease;
        min-width: 2px;
      }
      .chart-bar.efficiency {
        background: var(--sleep-color-success, #009E73);
      }
      .chart-bar.awakenings {
        background: var(--sleep-color-awake, #D55E00);
      }
      .chart-value {
        width: 40px;
        font-size: var(--ha-font-size-xs, 10px);
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }
      .empty {
        text-align: center;
        color: var(--secondary-text-color);
        padding: var(--ha-space-8, 32px);
      }
      .histogram {
        display: flex;
        align-items: stretch;
        gap: 2px;
        height: 160px;
        padding: 0 var(--ha-space-1, 4px);
      }
      .hist-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        min-width: 0;
      }
      .hist-count {
        font-size: var(--ha-font-size-xs, 10px);
        color: var(--secondary-text-color);
        height: 14px;
        line-height: 14px;
      }
      .hist-bar-track {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: flex-end;
        background: var(--secondary-background-color, #f5f5f5);
        border-radius: 3px 3px 0 0;
        overflow: hidden;
      }
      .hist-bar {
        width: 100%;
        background: var(--sleep-color-asleep, #0072B2);
        border-radius: 3px 3px 0 0;
        transition: height 0.3s ease;
        min-height: 1px;
      }
      .hist-bar.awakenings {
        background: var(--sleep-color-awake, #D55E00);
      }
      .hist-label {
        font-size: var(--ha-font-size-xs, 10px);
        color: var(--secondary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
    `,
  ];
}
