import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, statStyles } from "../styles";
import { formatDuration, efficiencyPercent } from "../utils";

interface DailyStat {
  session_id: string;
  date: string;
  started_at: string;
  ended_at: string;
  time_in_bed_minutes: number;
  sleep_period_minutes: number;
  total_sleep_minutes: number;
  sleep_efficiency: number;
  awakenings: number;
  time_to_fall_asleep_minutes: number;
  time_before_getting_up_minutes: number;
}

interface StatsData {
  days: number;
  session_count: number;
  daily: DailyStat[];
  averages: {
    total_sleep_minutes: number;
    sleep_period_minutes: number;
    sleep_efficiency: number;
    awakenings: number;
    time_to_fall_asleep_minutes: number;
    time_before_getting_up_minutes: number;
  };
}

@customElement("sleep-tracker-stats-view")
export class StatsView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
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
    const avg = s.averages;

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

        <ha-card>
          <div class="card-header">
            Averages
            <span class="session-count">${s.session_count} night${s.session_count !== 1 ? "s" : ""}</span>
          </div>
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-value">${formatDuration(avg.total_sleep_minutes)}</div>
              <div class="stat-label">Avg Sleep</div>
            </div>
            <div class="stat">
              <div class="stat-value">${efficiencyPercent(avg.sleep_efficiency)}</div>
              <div class="stat-label">Avg Efficiency</div>
            </div>
            <div class="stat">
              <div class="stat-value">${avg.awakenings.toFixed(1)}</div>
              <div class="stat-label">Avg Awakenings</div>
            </div>
            <div class="stat">
              <div class="stat-value">${formatDuration(avg.time_to_fall_asleep_minutes)}</div>
              <div class="stat-label">Avg Time to Sleep</div>
            </div>
            <div class="stat">
              <div class="stat-value">${formatDuration(avg.sleep_period_minutes)}</div>
              <div class="stat-label">Avg Sleep Period</div>
            </div>
            <div class="stat">
              <div class="stat-value">${formatDuration(avg.time_before_getting_up_minutes)}</div>
              <div class="stat-label">Avg Awake Before Up</div>
            </div>
          </div>
        </ha-card>

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
            `
          : html`<p class="empty">No sleep data in this range.</p>`}
      </div>
    `;
  }

  private _shortDate(iso: string): string {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
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
        background: var(--sleep-color-asleep, #42a5f5);
        border-radius: 3px;
        transition: width 0.3s ease;
        min-width: 2px;
      }
      .chart-bar.efficiency {
        background: var(--sleep-color-success, #66bb6a);
      }
      .chart-bar.awakenings {
        background: var(--sleep-color-awake, #ef5350);
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
    `,
  ];
}
