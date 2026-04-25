import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SleepSession } from "../types";
import { tokens } from "../styles";
import { formatDate, formatTime, formatDuration } from "../utils";

import "./timeline-bar";

@customElement("sleep-tracker-session-card")
export class SessionCard extends LitElement {
  @property({ attribute: false }) session!: SleepSession;
  @property({ type: Number }) goalMinutes = 0;

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
        <sleep-tracker-timeline-bar
          .phases=${s.phases}
          .events=${s.events}
          .startedAt=${s.started_at}
          .endedAt=${s.ended_at}
          compact
        ></sleep-tracker-timeline-bar>
        ${s.stats
          ? html`
              <div class="summary">
                <span>
                  ${this.goalMinutes > 0
                    ? html`<ha-icon
                        icon=${s.stats.total_sleep_minutes >= this.goalMinutes
                          ? "mdi:check-circle"
                          : "mdi:circle-outline"}
                        class="goal-icon ${s.stats.total_sleep_minutes >= this.goalMinutes ? "met" : "unmet"}"
                      ></ha-icon>`
                    : nothing}
                  ${formatDuration(s.stats.total_sleep_minutes)} sleep
                </span>
                <span>${s.stats.awakenings} awakenings</span>
                <span>${Math.round(s.stats.sleep_efficiency * 100)}%</span>
              </div>
            `
          : nothing}
        ${s.rating_quality || s.tags?.length
          ? html`
              <div class="meta-row">
                ${s.rating_quality
                  ? html`<span class="meta-rating" title="Sleep quality">${"★".repeat(s.rating_quality)}${"☆".repeat(5 - s.rating_quality)}</span>`
                  : nothing}
                ${s.tags?.length
                  ? html`<span class="meta-tags">${s.tags.join(", ")}</span>`
                  : nothing}
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
        align-items: center;
        margin-top: var(--ha-space-2, 8px);
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .summary span {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      .goal-icon {
        --mdc-icon-size: 14px;
      }
      .goal-icon.met {
        color: var(--sleep-color-success, #009E73);
      }
      .goal-icon.unmet {
        color: var(--secondary-text-color);
      }
      .meta-row {
        display: flex;
        gap: var(--ha-space-3, 12px);
        margin-top: var(--ha-space-1, 4px);
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .meta-rating {
        color: var(--sleep-color-pulse, #E69F00);
        letter-spacing: 1px;
      }
      .meta-tags {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];
}
