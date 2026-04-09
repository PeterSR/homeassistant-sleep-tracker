import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, UserState, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, buttonStyles, cardStyles } from "../styles";
import { formatTime, timeAgo, formatDuration } from "../utils";

import "../components/setup-prompt";
import "../components/timeline-bar";
import "../components/pulse-button";
import "../components/session-card";

@customElement("sleep-tracker-main-view")
export class MainView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
  @property({ type: Boolean }) narrow = false;

  connectedCallback(): void {
    super.connectedCallback();
    this._setToolbar();
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has("userState")) {
      this._setToolbar();
    }
  }

  private _setToolbar() {
    this.dispatchEvent(
      new CustomEvent<ToolbarConfig>("set-toolbar", {
        bubbles: true,
        composed: true,
        detail: {
          title: "Sleep Tracker",
          actions: html`
            <ha-icon-button
              .label=${"Stats"}
              @click=${() => this._navigate("/stats")}
            >
              <ha-icon icon="mdi:chart-line"></ha-icon>
            </ha-icon-button>
            <ha-icon-button
              .label=${"History"}
              @click=${() => this._navigate("/history")}
            >
              <ha-icon icon="mdi:history"></ha-icon>
            </ha-icon-button>
            <ha-icon-button
              .label=${"Settings"}
              @click=${() => this._navigate("/settings")}
            >
              <ha-icon icon="mdi:cog"></ha-icon>
            </ha-icon-button>
          `,
        },
      })
    );
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

  private _requestRefresh() {
    this.dispatchEvent(
      new CustomEvent("sleep-tracker-state-update", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private async _startSleep() {
    try {
      await this.api.startSleep();
      this._requestRefresh();
    } catch (err) {
      console.error("Failed to start sleep:", err);
    }
  }

  private async _stopSleep() {
    try {
      await this.api.stopSleep();
      this._requestRefresh();
    } catch (err) {
      console.error("Failed to stop sleep:", err);
    }
  }

  render() {
    // Not set up
    if (!this.userState.config) {
      return html`
        <sleep-tracker-setup-prompt .hass=${this.hass} .api=${this.api}></sleep-tracker-setup-prompt>
      `;
    }

    const active = this.userState.active_session;

    // Active session
    if (active) {
      return html`
        <div class="container">
          <ha-card>
            <div class="session-header">
              <ha-icon icon="mdi:sleep" class="sleeping-icon"></ha-icon>
              <div>
                <div class="status">Sleeping</div>
                <div class="started">Started ${formatTime(active.started_at)} (${timeAgo(active.started_at)})</div>
              </div>
            </div>

            <div class="timeline-section">
              <sleep-tracker-timeline-bar
                .phases=${active.phases}
                .events=${active.events}
                .startedAt=${active.started_at}
                .endedAt=${null}
                .showEvents=${true}
              ></sleep-tracker-timeline-bar>
            </div>

            ${active.events.length > 0
              ? html`
                  <div class="event-count">
                    ${active.events.length} event${active.events.length !== 1 ? "s" : ""} recorded
                  </div>
                `
              : nothing}

            <sleep-tracker-pulse-button .api=${this.api}></sleep-tracker-pulse-button>

            <div class="stop-section">
              <button class="big-button stop" @click=${this._stopSleep}>
                <ha-icon icon="mdi:sleep-off"></ha-icon>
                End Sleep
              </button>
            </div>
          </ha-card>
        </div>
      `;
    }

    // No active session
    const last = this.userState.last_session;
    const unfinalized = this.userState.unfinalized_sessions || [];
    return html`
      <div class="container">
        ${unfinalized.length > 0
          ? html`
              <div class="unfinalized-section">
                <h3>Needs Review</h3>
                ${unfinalized.map(
                  (s) => html`
                    <div class="unfinalized-card" @click=${() => this._navigate(`/night/${s.session_id}`)}>
                      <ha-icon icon="mdi:pencil-circle-outline" class="review-icon"></ha-icon>
                      <div class="unfinalized-info">
                        <span class="unfinalized-date">${formatTime(s.started_at)} — ${s.ended_at ? formatTime(s.ended_at) : ""}</span>
                        <span class="unfinalized-hint">Tap to review and finalize</span>
                      </div>
                      <ha-icon icon="mdi:chevron-right"></ha-icon>
                    </div>
                  `
                )}
              </div>
            `
          : nothing}

        <button class="big-button start" @click=${this._startSleep}>
          <ha-icon icon="mdi:sleep" style="--mdc-icon-size: 48px"></ha-icon>
          Start Sleep
        </button>

        ${last
          ? html`
              <div class="section">
                <h3>Last Night</h3>
                <sleep-tracker-session-card .session=${last}></sleep-tracker-session-card>
              </div>
            `
          : html`
              <div class="empty-hint">
                <p>Tap the button above when you lay down to sleep.</p>
              </div>
            `}
      </div>
    `;
  }

  static styles = [
    tokens,
    viewStyles,
    buttonStyles,
    cardStyles,
    css`
      .section h3 {
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        text-transform: uppercase;
        color: var(--secondary-text-color);
        margin: var(--ha-space-6, 24px) 0 var(--ha-space-2, 8px);
      }
      .session-header {
        display: flex;
        align-items: center;
        gap: var(--ha-space-4, 16px);
        margin-bottom: var(--ha-space-4, 16px);
      }
      .sleeping-icon {
        --mdc-icon-size: 40px;
        color: var(--sleep-color-asleep, #42a5f5);
      }
      .status {
        font-size: var(--ha-font-size-xl, 20px);
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .started {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .timeline-section {
        margin: var(--ha-space-4, 16px) 0;
      }
      .event-count {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        text-align: center;
        margin-top: var(--ha-space-2, 8px);
      }
      .stop-section {
        margin-top: var(--ha-space-6, 24px);
      }
      .empty-hint {
        text-align: center;
        padding: var(--ha-space-8, 32px);
        color: var(--secondary-text-color);
      }
      .unfinalized-section {
        margin-bottom: var(--ha-space-4, 16px);
      }
      .unfinalized-section h3 {
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        text-transform: uppercase;
        color: #e65100;
        margin: 0 0 var(--ha-space-2, 8px);
      }
      .unfinalized-card {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
        background: #fff3e0;
        border-radius: var(--ha-border-radius-md, 8px);
        cursor: pointer;
        margin-bottom: var(--ha-space-2, 8px);
      }
      .unfinalized-card:hover {
        background: #ffe0b2;
      }
      .review-icon {
        color: #e65100;
        --mdc-icon-size: 24px;
        flex-shrink: 0;
      }
      .unfinalized-info {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      .unfinalized-date {
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .unfinalized-hint {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
    `,
  ];
}
