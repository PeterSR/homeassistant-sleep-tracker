import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, SleepSession, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, sectionStyles, cardStyles } from "../styles";
import { formatDate, formatTime } from "../utils";

import "../components/timeline-bar";
import "../components/night-stats";

@customElement("night-detail-view")
export class NightDetailView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
  @property() sessionId = "";
  @property({ type: Boolean }) narrow = false;

  @state() private _session: SleepSession | null = null;
  @state() private _loading = true;
  @state() private _busy = false;

  connectedCallback(): void {
    super.connectedCallback();
    this._load();
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has("sessionId") && this.sessionId) {
      this._load();
    }
  }

  private async _load() {
    this._loading = true;
    try {
      this._session = await this.api.getSession(this.sessionId);
      this._setToolbar();
    } catch (err) {
      console.error("Failed to load session:", err);
    } finally {
      this._loading = false;
    }
  }

  private _setToolbar() {
    const title = this._session
      ? formatDate(this._session.started_at)
      : "Night Detail";
    this.dispatchEvent(
      new CustomEvent<ToolbarConfig>("set-toolbar", {
        bubbles: true,
        composed: true,
        detail: { title, backPath: "/history" },
      })
    );
  }

  private get _editable(): boolean {
    return !!this._session && !this._session.finalized && !!this._session.ended_at;
  }

  private async _deletePulse(index: number) {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      this._session = await this.api.deletePulse(this._session.session_id, index);
    } catch (err) {
      console.error("Delete pulse failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _swapPulseType(index: number) {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      this._session = await this.api.swapPulseType(this._session.session_id, index);
    } catch (err) {
      console.error("Swap pulse type failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _finalize() {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      this._session = await this.api.finalizeSession(this._session.session_id);
    } catch (err) {
      console.error("Finalize failed:", err);
    } finally {
      this._busy = false;
    }
  }

  render() {
    if (this._loading) {
      return html`<div class="container"><p>Loading...</p></div>`;
    }
    if (!this._session) {
      return html`<div class="container"><p>Session not found.</p></div>`;
    }

    const s = this._session;
    const editable = this._editable;

    return html`
      <div class="container">
        ${!s.finalized && s.ended_at
          ? html`
              <div class="review-banner">
                <ha-icon icon="mdi:pencil-outline"></ha-icon>
                <span>This session is not finalized. Edit pulses below, then finalize when ready.</span>
              </div>
            `
          : nothing}
        ${s.finalized
          ? html`
              <div class="finalized-banner">
                <ha-icon icon="mdi:check-circle-outline"></ha-icon>
                <span>Finalized${s.exported ? " and exported" : ""}</span>
              </div>
            `
          : nothing}

        <ha-card>
          <div class="time-range">
            ${formatTime(s.started_at)} — ${s.ended_at ? formatTime(s.ended_at) : "ongoing"}
          </div>
          <div class="timeline-section">
            <timeline-bar
              .intervals=${s.intervals}
              .pulses=${s.pulses}
              .startedAt=${s.started_at}
              .endedAt=${s.ended_at}
            ></timeline-bar>
          </div>
        </ha-card>

        ${s.stats
          ? html`
              <div class="section">
                <h3>Statistics</h3>
                <night-stats .stats=${s.stats}></night-stats>
              </div>
            `
          : nothing}

        <div class="section">
          <h3>Pulses (${s.pulses.length})</h3>
          ${s.pulses.length > 0
            ? html`
                <div class="pulse-list">
                  ${s.pulses.map(
                    (p, i) => html`
                      <div class="pulse-item">
                        <span
                          class="pulse-type ${p.pulse_type} ${editable ? "clickable" : ""}"
                          @click=${editable ? () => this._swapPulseType(i) : nothing}
                          title=${editable ? "Click to swap type" : ""}
                        >
                          ${p.pulse_type === "awake" ? "Woke up" : "Still awake"}
                        </span>
                        <span class="pulse-time">${formatTime(p.timestamp)}</span>
                        <span class="pulse-source">${p.source}</span>
                        ${editable
                          ? html`
                              <button
                                class="delete-btn"
                                ?disabled=${this._busy}
                                @click=${() => this._deletePulse(i)}
                                title="Delete pulse"
                              >
                                <ha-icon icon="mdi:close"></ha-icon>
                              </button>
                            `
                          : nothing}
                      </div>
                    `
                  )}
                </div>
              `
            : html`<p class="no-pulses">No pulses recorded.</p>`}
        </div>

        ${editable
          ? html`
              <div class="finalize-section">
                <button
                  class="finalize-btn"
                  ?disabled=${this._busy}
                  @click=${this._finalize}
                >
                  ${this._busy ? "Finalizing..." : "Finalize Session"}
                </button>
                <p class="finalize-hint">
                  Finalizing locks edits${this.userState.config?.export_url ? " and exports to your REST endpoint" : ""}.
                </p>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  static styles = [
    tokens,
    viewStyles,
    sectionStyles,
    cardStyles,
    css`
      .review-banner {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
        background: #fff3e0;
        color: #e65100;
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-s, 12px);
        margin-bottom: var(--ha-space-4, 16px);
      }
      .finalized-banner {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
        background: #e8f5e9;
        color: #2e7d32;
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-s, 12px);
        margin-bottom: var(--ha-space-4, 16px);
      }
      .time-range {
        font-size: var(--ha-font-size-xl, 20px);
        font-weight: var(--ha-font-weight-medium, 500);
        text-align: center;
        margin-bottom: var(--ha-space-4, 16px);
      }
      .timeline-section {
        margin: var(--ha-space-4, 16px) 0;
      }
      .pulse-list {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-2, 8px);
      }
      .pulse-item {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        background: var(--card-background-color, white);
        border-radius: var(--ha-border-radius-md, 8px);
        border: 1px solid var(--divider-color, #e0e0e0);
      }
      .pulse-type {
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-medium, 500);
        padding: 2px var(--ha-space-2, 8px);
        border-radius: var(--ha-border-radius-sm, 4px);
        color: white;
        white-space: nowrap;
      }
      .pulse-type.awake {
        background: var(--sleep-color-awake, #ef5350);
      }
      .pulse-type.still_awake {
        background: var(--sleep-color-pulse, #ff9800);
      }
      .pulse-type.clickable {
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .pulse-type.clickable:hover {
        opacity: 0.75;
      }
      .pulse-time {
        font-size: var(--ha-font-size-m, 14px);
        flex: 1;
      }
      .pulse-source {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .delete-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
        --mdc-icon-size: 18px;
      }
      .delete-btn:hover {
        background: var(--sleep-color-awake, #ef5350);
        color: white;
      }
      .delete-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .no-pulses {
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
      }
      .finalize-section {
        margin-top: var(--ha-space-6, 24px);
        text-align: center;
      }
      .finalize-btn {
        padding: var(--ha-space-3, 12px) var(--ha-space-8, 32px);
        background: var(--sleep-color-success, #66bb6a);
        color: white;
        border: none;
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
        cursor: pointer;
        font-family: inherit;
      }
      .finalize-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .finalize-hint {
        margin-top: var(--ha-space-2, 8px);
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
    `,
  ];
}
