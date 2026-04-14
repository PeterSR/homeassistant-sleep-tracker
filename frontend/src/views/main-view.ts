import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, UserState, ToolbarConfig, ChecklistItem } from "../types";
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
    const checklist = this.userState.config?.checklist || [];
    if (checklist.length === 0) return nothing;

    return html`
      <div class="checklist-section">
        <h3>Bedtime Checklist</h3>
        <div class="checklist-items">
          ${checklist.map((item) =>
            item.type === "entity"
              ? this._renderEntityTile(item)
              : this._renderTextItem(item)
          )}
        </div>
      </div>
    `;
  }

  private _renderEntityTile(item: ChecklistItem) {
    const stateObj = item.entity_id
      ? this.hass.states?.[item.entity_id]
      : undefined;

    if (!stateObj) {
      return html`
        <div class="entity-tile unavailable">
          <ha-icon icon="mdi:help-circle-outline"></ha-icon>
          <span class="tile-name">${item.entity_id}</span>
          <span class="tile-state">Unavailable</span>
        </div>
      `;
    }

    const name = stateObj.attributes.friendly_name || item.entity_id;
    const state = stateObj.state;
    const hasDesired = item.desired_state != null;
    const isOk = hasDesired && state === item.desired_state;
    const isWarn = hasDesired && state !== item.desired_state;

    return html`
      <div
        class="entity-tile ${isOk ? "ok" : ""} ${isWarn ? "warn" : ""}"
        @click=${() => this._showEntity(item.entity_id!)}
      >
        <state-badge .stateObj=${stateObj}></state-badge>
        <span class="tile-name">${name}</span>
        <span class="tile-state">${state}</span>
      </div>
    `;
  }

  private _renderTextItem(item: ChecklistItem) {
    return html`
      <div class="text-item">
        <ha-icon icon="mdi:circle-small"></ha-icon>
        <span>${item.text}</span>
      </div>
    `;
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
              ? html`
                  <div class="resume-section">
                    <button class="big-button start" @click=${this._startSleep}>
                      <ha-icon icon="mdi:sleep"></ha-icon>
                      Resume Sleep
                    </button>
                  </div>
                `
              : html`
                  <sleep-tracker-pulse-button .api=${this.api}></sleep-tracker-pulse-button>

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
    const last = this.userState.last_session;
    const unfinalized = this.userState.unfinalized_sessions || [];
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
                  .goalMinutes=${this.userState.config?.sleep_goal_minutes ?? 0}
                ></sleep-tracker-session-card>
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
      .paused-icon {
        --mdc-icon-size: 40px;
        color: var(--sleep-color-pulse, #ff9800);
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
      .entity-tile {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
        background: var(--card-background-color, white);
        border-radius: var(--ha-border-radius-md, 8px);
        cursor: pointer;
        border: 1px solid var(--divider-color, #e0e0e0);
        transition: background 0.15s, border-color 0.15s;
      }
      .entity-tile:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .entity-tile.ok {
        border-color: var(--sleep-color-success, #66bb6a);
        background: rgba(102, 187, 106, 0.08);
      }
      .entity-tile.warn {
        border-color: var(--sleep-color-awake, #ef5350);
        background: rgba(239, 83, 80, 0.08);
      }
      .entity-tile.unavailable {
        opacity: 0.5;
      }
      .tile-name {
        flex: 1;
        font-size: var(--ha-font-size-m, 14px);
      }
      .tile-state {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        text-transform: capitalize;
      }
      .text-item {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-m, 14px);
      }
      .text-item ha-icon {
        --mdc-icon-size: 18px;
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
