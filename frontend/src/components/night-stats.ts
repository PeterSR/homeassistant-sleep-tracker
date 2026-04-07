import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionStats } from "../types";
import { tokens, statStyles } from "../styles";
import { formatDuration, efficiencyPercent } from "../utils";

@customElement("sleep-tracker-night-stats")
export class NightStats extends LitElement {
  @property({ attribute: false }) stats: SessionStats | null = null;

  render() {
    if (!this.stats) return nothing;
    const s = this.stats;

    return html`
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value">${formatDuration(s.total_sleep_minutes)}</div>
          <div class="stat-label">Total Sleep</div>
        </div>
        <div class="stat">
          <div class="stat-value">${efficiencyPercent(s.sleep_efficiency)}</div>
          <div class="stat-label">Efficiency</div>
        </div>
        <div class="stat">
          <div class="stat-value">${s.awakenings}</div>
          <div class="stat-label">Awakenings</div>
        </div>
        <div class="stat">
          <div class="stat-value">
            ${formatDuration(s.time_to_fall_asleep_minutes)}
          </div>
          <div class="stat-label">Time to Sleep</div>
        </div>
      </div>
    `;
  }

  static styles = [tokens, statStyles];
}
