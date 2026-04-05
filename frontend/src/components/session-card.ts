import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SleepSession } from "../types";
import { tokens } from "../styles";
import { formatDate, formatTime, formatDuration } from "../utils";

import "./timeline-bar";

@customElement("session-card")
export class SessionCard extends LitElement {
  @property({ attribute: false }) session!: SleepSession;

  private _navigate() {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        bubbles: true,
        composed: true,
        detail: { path: `/night/${this.session.session_id}` },
      })
    );
  }

  render() {
    const s = this.session;
    if (!s) return nothing;

    return html`
      <ha-card class="clickable" @click=${this._navigate}>
        <div class="header">
          <span class="date">${formatDate(s.started_at)}</span>
          <span class="time">
            ${formatTime(s.started_at)} — ${s.ended_at ? formatTime(s.ended_at) : "..."}
          </span>
        </div>
        <timeline-bar
          .intervals=${s.intervals}
          .pulses=${s.pulses}
          .startedAt=${s.started_at}
          .endedAt=${s.ended_at}
          compact
        ></timeline-bar>
        ${s.stats
          ? html`
              <div class="summary">
                <span>${formatDuration(s.stats.total_sleep_minutes)} sleep</span>
                <span>${s.stats.awakenings} awakenings</span>
                <span>${Math.round(s.stats.sleep_efficiency * 100)}%</span>
              </div>
            `
          : nothing}
      </ha-card>
    `;
  }

  static styles = [
    tokens,
    css`
      ha-card {
        padding: var(--ha-space-4, 16px);
        cursor: pointer;
      }
      ha-card:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: var(--ha-space-2, 8px);
      }
      .date {
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .time {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .summary {
        display: flex;
        justify-content: space-between;
        margin-top: var(--ha-space-2, 8px);
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
    `,
  ];
}
