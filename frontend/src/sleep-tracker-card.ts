/**
 * Lovelace card: Sleep Tracker Status
 *
 * Shows current sleep status with start/stop and pulse controls.
 * Auto-loaded on all dashboards via add_extra_js_url().
 * No config required — uses connection.user for per-user scoping.
 */

import { LitElement, html, css, nothing } from "lit";
import { state } from "lit/decorators.js";
import type { HomeAssistant, UserState } from "./types";
import { SleepTrackerApi } from "./api";
import { tokens } from "./styles";
import { formatTime, timeAgo, formatDuration } from "./utils";

import "./components/timeline-bar";

class SleepTrackerStatusCard extends LitElement {
  @state() private _config: any = {};
  @state() private _userState: UserState | null = null;
  @state() private _sending = false;

  private _hass?: HomeAssistant;
  private _api?: SleepTrackerApi;
  private _unsub?: () => void;

  setConfig(config: any): void {
    this._config = config;
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    if (!this._api && hass) {
      this._api = new SleepTrackerApi(hass);
      this._subscribe();
    } else if (this._api && hass) {
      this._api = new SleepTrackerApi(hass);
    }
    this.requestUpdate();
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this._api && !this._unsub) this._subscribe();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._unsub) {
      this._unsub();
      this._unsub = undefined;
    }
  }

  private async _subscribe(): Promise<void> {
    if (this._unsub) {
      this._unsub();
      this._unsub = undefined;
    }
    if (!this._api) return;
    try {
      this._unsub = await this._api.subscribe((state) => {
        this._userState = state;
        this.requestUpdate();
      });
    } catch (e) {
      console.error("Sleep Tracker card: subscribe failed", e);
    }
  }

  getCardSize(): number {
    return 3;
  }

  private async _startSleep() {
    if (!this._api || this._sending) return;
    this._sending = true;
    try {
      await this._api.startSleep();
    } catch (e) {
      console.error("Start sleep failed:", e);
    } finally {
      this._sending = false;
    }
  }

  private async _stopSleep() {
    if (!this._api || this._sending) return;
    this._sending = true;
    try {
      await this._api.stopSleep();
    } catch (e) {
      console.error("Stop sleep failed:", e);
    } finally {
      this._sending = false;
    }
  }

  private async _pulse(type: "awake" | "still_awake") {
    if (!this._api || this._sending) return;
    this._sending = true;
    try {
      await this._api.pulse(type);
    } catch (e) {
      console.error("Pulse failed:", e);
    } finally {
      this._sending = false;
    }
  }

  render() {
    if (!this._userState) {
      return html`<ha-card><div class="loading">Loading...</div></ha-card>`;
    }

    // User not set up
    if (!this._userState.config) {
      return html`
        <ha-card>
          <div class="content not-setup">
            <ha-icon icon="mdi:sleep" class="dim-icon"></ha-icon>
            <span>Sleep tracking not enabled</span>
          </div>
        </ha-card>
      `;
    }

    const active = this._userState.active_session;

    // Active session
    if (active) {
      return html`
        <ha-card>
          <div class="content">
            <div class="status-row">
              <div class="status sleeping">
                <ha-icon icon="mdi:sleep"></ha-icon>
                <span>Sleeping</span>
              </div>
              <span class="time-info">${timeAgo(active.started_at)}</span>
            </div>

            <timeline-bar
              .intervals=${active.intervals}
              .pulses=${active.pulses}
              .startedAt=${active.started_at}
              .endedAt=${null}
              compact
            ></timeline-bar>

            <div class="actions">
              <button
                class="action-btn pulse-awake"
                ?disabled=${this._sending}
                @click=${() => this._pulse("awake")}
              >
                I woke up
              </button>
              <button
                class="action-btn pulse-still"
                ?disabled=${this._sending}
                @click=${() => this._pulse("still_awake")}
              >
                Still awake
              </button>
              <button
                class="action-btn stop"
                ?disabled=${this._sending}
                @click=${this._stopSleep}
              >
                End
              </button>
            </div>
          </div>
        </ha-card>
      `;
    }

    // Not sleeping
    const last = this._userState.last_session;
    return html`
      <ha-card>
        <div class="content">
          <div class="status-row">
            <div class="status awake">
              <ha-icon icon="mdi:sleep-off"></ha-icon>
              <span>Awake</span>
            </div>
            ${last?.stats
              ? html`<span class="time-info">Last: ${formatDuration(last.stats.total_sleep_minutes)}</span>`
              : nothing}
          </div>

          ${last
            ? html`
                <timeline-bar
                  .intervals=${last.intervals}
                  .pulses=${last.pulses}
                  .startedAt=${last.started_at}
                  .endedAt=${last.ended_at}
                  compact
                ></timeline-bar>
              `
            : nothing}

          <div class="actions">
            <button
              class="action-btn start"
              ?disabled=${this._sending}
              @click=${this._startSleep}
            >
              <ha-icon icon="mdi:sleep"></ha-icon>
              Start Sleep
            </button>
          </div>
        </div>
      </ha-card>
    `;
  }

  static styles = [
    tokens,
    css`
      .content {
        padding: var(--ha-space-4, 16px);
      }
      .not-setup {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        color: var(--secondary-text-color);
      }
      .dim-icon {
        --mdc-icon-size: 24px;
        opacity: 0.5;
      }
      .loading {
        padding: var(--ha-space-4, 16px);
        color: var(--secondary-text-color);
      }
      .status-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--ha-space-3, 12px);
      }
      .status {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        font-weight: var(--ha-font-weight-medium, 500);
        font-size: var(--ha-font-size-l, 16px);
      }
      .status.sleeping {
        color: var(--sleep-color-asleep, #42a5f5);
      }
      .status.awake {
        color: var(--primary-text-color);
      }
      .time-info {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .actions {
        display: flex;
        gap: var(--ha-space-2, 8px);
        margin-top: var(--ha-space-3, 12px);
      }
      .action-btn {
        flex: 1;
        padding: var(--ha-space-2, 8px);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        background: var(--card-background-color, white);
        color: var(--primary-text-color);
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-medium, 500);
        cursor: pointer;
        font-family: inherit;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--ha-space-1, 4px);
      }
      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .action-btn.start {
        background: var(--sleep-color-asleep, #42a5f5);
        color: white;
        border-color: var(--sleep-color-asleep, #42a5f5);
      }
      .action-btn.stop {
        background: var(--sleep-color-awake, #ef5350);
        color: white;
        border-color: var(--sleep-color-awake, #ef5350);
      }
      .action-btn ha-icon {
        --mdc-icon-size: 18px;
      }
    `,
  ];
}

customElements.define("sleep-tracker-status-card", SleepTrackerStatusCard);

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "sleep-tracker-status-card",
  name: "Sleep Tracker Status",
  description:
    "Shows sleep status with start/stop and pulse controls",
  preview: true,
});
