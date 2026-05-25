import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { StatsData } from "../types";
import { tokens, statStyles } from "../styles";
import { formatDuration, efficiencyPercent } from "../utils";

@customElement("sleep-tracker-averages-card")
export class AveragesCard extends LitElement {
  @property({ attribute: false }) stats!: StatsData;

  render() {
    const s = this.stats;
    const avg = s.averages;
    return html`
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
    `;
  }

  static styles = [
    tokens,
    statStyles,
    css`
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
    `,
  ];
}
