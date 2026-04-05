import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, SleepSession, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, sectionStyles, cardStyles } from "../styles";
import { formatDate, formatTime, formatDateTime } from "../utils";

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
  @state() private _exporting = false;

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

  private async _export() {
    if (!this._session || this._exporting) return;
    this._exporting = true;
    try {
      await this.api.exportSession(this._session.session_id);
      this._session = { ...this._session, exported: true };
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      this._exporting = false;
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
    const hasExportUrl = this.userState.config?.export_url;

    return html`
      <div class="container">
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

        ${s.pulses.length > 0
          ? html`
              <div class="section">
                <h3>Pulses (${s.pulses.length})</h3>
                <div class="pulse-list">
                  ${s.pulses.map(
                    (p) => html`
                      <div class="pulse-item">
                        <span class="pulse-type ${p.pulse_type}">
                          ${p.pulse_type === "awake" ? "Woke up" : "Still awake"}
                        </span>
                        <span class="pulse-time">${formatTime(p.timestamp)}</span>
                        <span class="pulse-source">${p.source}</span>
                      </div>
                    `
                  )}
                </div>
              </div>
            `
          : nothing}

        ${hasExportUrl
          ? html`
              <div class="export-section">
                <button
                  class="export-btn"
                  ?disabled=${s.exported || this._exporting}
                  @click=${this._export}
                >
                  ${s.exported
                    ? "Exported"
                    : this._exporting
                      ? "Exporting..."
                      : "Export to REST"}
                </button>
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
      }
      .pulse-type.awake {
        background: var(--sleep-color-awake, #ef5350);
      }
      .pulse-type.still_awake {
        background: var(--sleep-color-pulse, #ff9800);
      }
      .pulse-time {
        font-size: var(--ha-font-size-m, 14px);
        flex: 1;
      }
      .pulse-source {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .export-section {
        margin-top: var(--ha-space-6, 24px);
        text-align: center;
      }
      .export-btn {
        padding: var(--ha-space-2, 8px) var(--ha-space-6, 24px);
        background: var(--primary-color, #03a9f4);
        color: white;
        border: none;
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
        font-family: inherit;
      }
      .export-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];
}
