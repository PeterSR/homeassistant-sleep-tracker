import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, TrackerState, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, buttonStyles, cardStyles } from "../styles";
import { formatTime, timeAgo, formatDuration } from "../utils";

import "../components/setup-prompt";
import "../components/timeline-bar";
import "../components/pulse-button";
import "../components/session-card";
import "../components/checklist-entity-item";
import "../components/checklist-text-item";
import "../components/custom-events-bar";

@customElement("sleep-tracker-main-view")
export class MainView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) trackerState!: TrackerState;
  @property({ type: Boolean }) narrow = false;

  connectedCallback(): void {
    super.connectedCallback();
    this._setToolbar();
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has("trackerState")) {
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
      const session = await this.api.stopSleep();
      if (session.status === "stopped") {
        this._navigate(`/review/${session.session_id}`);
      } else if (session.status === "completed") {
        this._navigate(`/night/${session.session_id}`);
      } else {
        // finalized (both skips enabled) — stay on main
        this._requestRefresh();
      }
    } catch (err) {
      console.error("Failed to stop sleep:", err);
    }
  }

  private async _pauseSleep() {
    try {
      await this.api.pauseSleep();
      this._requestRefresh();
    } catch (err) {
      console.error("Failed to pause sleep:", err);
    }
  }

  private _renderEnvironment() {
    const config = this.trackerState.config;
    if (!config?.show_environment || !config.environment_entities?.length) {
      return nothing;
    }

    return html`
      <div class="section">
        <h3>Environment</h3>
        <div class="env-list">
          ${config.environment_entities.map((entityId) => {
            const stateObj = this.hass.states[entityId];
            if (!stateObj) {
              return html`
                <div class="env-tile unavailable">
                  <ha-icon icon="mdi:help-circle-outline"></ha-icon>
                  <span class="env-name">${entityId}</span>
                  <span class="env-state">Unavailable</span>
                </div>
              `;
            }
            const name = stateObj.attributes.friendly_name || entityId;
            const unit = stateObj.attributes.unit_of_measurement || "";
            return html`
              <div
                class="env-tile"
                @click=${() => this._showEntity(entityId)}
              >
                <state-badge .stateObj=${stateObj}></state-badge>
                <span class="env-name">${name}</span>
                <span class="env-state">${stateObj.state}${unit ? ` ${unit}` : ""}</span>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  private _showEntity(entityId: string) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      })
    );
  }

  private _renderChecklist() {
    const checklist = this.trackerState.config?.checklist || [];
    if (checklist.length === 0) return nothing;

    return html`
      <div class="checklist-section">
        <h3>Bedtime Checklist</h3>
        <div class="checklist-items">
          ${checklist.map((item) =>
            item.type === "entity"
              ? html`
                  <sleep-tracker-checklist-entity-item
                    .hass=${this.hass}
                    .entityId=${item.entity_id ?? ""}
                    .desiredState=${item.desired_state ?? null}
                  ></sleep-tracker-checklist-entity-item>
                `
              : html`
                  <sleep-tracker-checklist-text-item
                    .text=${item.text ?? ""}
                  ></sleep-tracker-checklist-text-item>
                `
          )}
        </div>
      </div>
    `;
  }

  render() {
    // Not set up
    if (!this.trackerState.config) {
      return html`
        <sleep-tracker-setup-prompt .hass=${this.hass} .api=${this.api}></sleep-tracker-setup-prompt>
      `;
    }

    const active = this.trackerState.active_session;

    // Active session
    if (active) {
      const paused = active.status === "paused";
      return html`
        <div class="container">
          <ha-card>
            <div class="session-header">
              <ha-icon icon=${paused ? "mdi:pause-circle-outline" : "mdi:sleep"} class=${paused ? "paused-icon" : "sleeping-icon"}></ha-icon>
              <div>
                <div class="status">${paused ? "Paused" : "Sleeping"}</div>
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

            ${paused
              ? nothing
              : html`
                  <sleep-tracker-pulse-button .api=${this.api}></sleep-tracker-pulse-button>
                `}

            <sleep-tracker-custom-events-bar
              .api=${this.api}
              .customEvents=${this.trackerState.config?.custom_events ?? []}
            ></sleep-tracker-custom-events-bar>

            ${paused
              ? html`
                  <div class="resume-section">
                    <button class="big-button start" @click=${this._startSleep}>
                      <ha-icon icon="mdi:sleep"></ha-icon>
                      Resume Sleep
                    </button>
                  </div>
                `
              : html`
                  <div class="pause-section">
                    <button class="big-button pause" @click=${this._pauseSleep}>
                      <ha-icon icon="mdi:pause"></ha-icon>
                      Pause
                    </button>
                  </div>
                `}

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
    const last = this.trackerState.last_session;
    const unfinalized = this.trackerState.unfinalized_sessions || [];
    return html`
      <div class="container">
        ${unfinalized.length > 0
          ? html`
              <div class="unfinalized-section">
                <h3>Needs Review</h3>
                ${unfinalized.map(
                  (s) => {
                    const path = s.status === "stopped"
                      ? `/review/${s.session_id}`
                      : `/night/${s.session_id}`;
                    const hint = s.status === "stopped"
                      ? "Tap to review events"
                      : "Tap to review and finalize";
                    return html`
                      <div class="unfinalized-card" @click=${() => this._navigate(path)}>
                        <ha-icon icon="mdi:pencil-circle-outline" class="review-icon"></ha-icon>
                        <div class="unfinalized-info">
                          <span class="unfinalized-date">${formatTime(s.started_at)} — ${s.ended_at ? formatTime(s.ended_at) : ""}</span>
                          <span class="unfinalized-hint">${hint}</span>
                        </div>
                        <ha-icon icon="mdi:chevron-right"></ha-icon>
                      </div>
                    `;
                  }
                )}
              </div>
            `
          : nothing}

        ${this._renderChecklist()}

        <button class="big-button start" @click=${this._startSleep}>
          <ha-icon icon="mdi:sleep" style="--mdc-icon-size: 48px"></ha-icon>
          Start Sleep
        </button>

        ${last
          ? html`
              <div class="section">
                <h3>Last Night</h3>
                <sleep-tracker-session-card
                  .session=${last}
                  .goalMinutes=${this.trackerState.config?.sleep_goal_minutes ?? 0}
                ></sleep-tracker-session-card>
              </div>
            `
          : html`
              <div class="empty-hint">
                <p>Tap the button above when you lay down to sleep.</p>
              </div>
            `}

        ${this._renderEnvironment()}
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
        color: var(--sleep-color-asleep, #0072B2);
      }
      .paused-icon {
        --mdc-icon-size: 40px;
        color: var(--sleep-color-pulse, #E69F00);
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
      .pause-section, .resume-section {
        margin-top: var(--ha-space-4, 16px);
      }
      .stop-section {
        margin-top: var(--ha-space-4, 16px);
      }
      .empty-hint {
        text-align: center;
        padding: var(--ha-space-8, 32px);
        color: var(--secondary-text-color);
      }
      .checklist-section {
        margin-bottom: var(--ha-space-4, 16px);
      }
      .checklist-section h3 {
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        text-transform: uppercase;
        color: var(--secondary-text-color);
        margin: 0 0 var(--ha-space-2, 8px);
      }
      .checklist-items {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-2, 8px);
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
      .env-list {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-2, 8px);
      }
      .env-tile {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
        background: var(--card-background-color, white);
        border-radius: var(--ha-border-radius-md, 8px);
        cursor: pointer;
        border: 1px solid var(--divider-color, #e0e0e0);
        transition: background 0.15s;
      }
      .env-tile:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .env-tile.unavailable {
        opacity: 0.5;
        cursor: default;
      }
      .env-name {
        flex: 1;
        font-size: var(--ha-font-size-m, 14px);
      }
      .env-state {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
    `,
  ];
}
