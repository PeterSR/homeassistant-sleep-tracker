/**
 * Additional Lovelace cards for Sleep Tracker.
 *
 * - sleep-tracker-last-night-card: Compact summary of the last completed night
 */

import { LitElement, html, css, nothing } from "lit";
import { state } from "lit/decorators.js";
import type { HomeAssistant, UserState } from "./types";
import { SleepTrackerApi } from "./api";
import { tokens } from "./styles";
import { formatDate, formatTime, formatDuration } from "./utils";

import "./components/timeline-bar";

// ---------------------------------------------------------------------------
// Last Night Card
// ---------------------------------------------------------------------------

class SleepTrackerLastNightCard extends LitElement {
  @state() private _config: any = {};
  @state() private _userState: UserState | null = null;

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
    return 2;
  }

  private _navigate(): void {
    const last = this._userState?.last_session;
    if (last) {
      window.location.href = `/sleep-tracker/night/${last.session_id}`;
    }
  }

  render() {
    if (!this._userState) {
      return html`<ha-card><div class="loading">Loading...</div></ha-card>`;
    }

    const last = this._userState.last_session;
    if (!last || !last.stats) {
      return html`
        <ha-card>
          <div class="content empty">
            <ha-icon icon="mdi:sleep" style="--mdc-icon-size: 24px; opacity: 0.4"></ha-icon>
            <span>No sleep data yet</span>
          </div>
        </ha-card>
      `;
    }

    const s = last.stats;

    return html`
      <ha-card class="clickable" @click=${this._navigate}>
        <div class="content">
          <div class="header">
            <span class="title">Last Night</span>
            <span class="date">
              ${formatDate(last.started_at)}
              ${formatTime(last.started_at)} — ${last.ended_at ? formatTime(last.ended_at) : ""}
            </span>
          </div>

          <timeline-bar
            .intervals=${last.intervals}
            .pulses=${last.pulses}
            .startedAt=${last.started_at}
            .endedAt=${last.ended_at}
            compact
          ></timeline-bar>

          <div class="stats">
            <div class="stat">
              <span class="stat-value">${formatDuration(s.total_sleep_minutes)}</span>
              <span class="stat-label">Sleep</span>
            </div>
            <div class="stat">
              <span class="stat-value">${Math.round(s.sleep_efficiency * 100)}%</span>
              <span class="stat-label">Efficiency</span>
            </div>
            <div class="stat">
              <span class="stat-value">${s.awakenings}</span>
              <span class="stat-label">Wakeups</span>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  static styles = [
    tokens,
    css`
      ha-card.clickable {
        cursor: pointer;
      }
      ha-card.clickable:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .content {
        padding: var(--ha-space-4, 16px);
      }
      .empty {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        color: var(--secondary-text-color);
      }
      .loading {
        padding: var(--ha-space-4, 16px);
        color: var(--secondary-text-color);
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: var(--ha-space-2, 8px);
      }
      .title {
        font-weight: var(--ha-font-weight-medium, 500);
        font-size: var(--ha-font-size-m, 14px);
      }
      .date {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .stats {
        display: flex;
        justify-content: space-around;
        margin-top: var(--ha-space-3, 12px);
      }
      .stat {
        text-align: center;
      }
      .stat-value {
        display: block;
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-bold, 700);
      }
      .stat-label {
        font-size: var(--ha-font-size-xs, 10px);
        color: var(--secondary-text-color);
        text-transform: uppercase;
      }
    `,
  ];
}

// ---------------------------------------------------------------------------
// Register cards
// ---------------------------------------------------------------------------

if (!customElements.get("sleep-tracker-last-night-card")) {
  customElements.define("sleep-tracker-last-night-card", SleepTrackerLastNightCard);
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "sleep-tracker-last-night-card",
  name: "Sleep Tracker Last Night",
  description: "Compact summary of the last completed sleep session",
  preview: true,
});
