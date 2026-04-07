import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, SleepSession, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, sectionStyles, cardStyles } from "../styles";
import { formatDate, formatTime } from "../utils";

import "../components/timeline-bar";
import "../components/night-stats";

@customElement("sleep-tracker-night-detail-view")
export class NightDetailView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
  @property() sessionId = "";
  @property({ type: Boolean }) narrow = false;

  @state() private _session: SleepSession | null = null;
  @state() private _loading = true;
  @state() private _busy = false;
  @state() private _editingTimeIndex: number | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._load();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
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

  private async _undo() {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      this._session = await this.api.undoEdit(this._session.session_id);
    } catch (err) {
      console.error("Undo failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private _startEditTime(index: number) {
    if (!this._editable) return;
    this._editingTimeIndex = index;
  }

  private _cancelEditTime() {
    this._editingTimeIndex = null;
  }

  private async _commitEditTime(index: number) {
    if (!this._session) return;
    const input = this.shadowRoot?.querySelector(".time-input") as HTMLInputElement | null;
    if (!input) {
      this._editingTimeIndex = null;
      return;
    }
    const newTimeValue = input.value; // "HH:MM" or "HH:MM:SS"
    if (!newTimeValue) {
      this._editingTimeIndex = null;
      return;
    }

    // Build a new ISO timestamp by replacing the time portion of the existing pulse
    const oldTs = this._session.pulses[index].timestamp;
    const oldDate = new Date(oldTs);
    const [h, m] = newTimeValue.split(":").map(Number);
    oldDate.setHours(h, m, 0, 0);

    // Format as local ISO with TZ offset
    const newTs = this._toLocalIso(oldDate);

    this._busy = true;
    this._editingTimeIndex = null;
    try {
      this._session = await this.api.updatePulse(
        this._session.session_id,
        index,
        { timestamp: newTs }
      );
    } catch (err) {
      console.error("Update pulse time failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private _toLocalIso(d: Date): string {
    // Returns ISO 8601 with local TZ offset, e.g. "2026-04-06T04:18:00+02:00"
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    const offsetMin = -d.getTimezoneOffset();
    const sign = offsetMin >= 0 ? "+" : "-";
    const offHours = pad(Math.floor(Math.abs(offsetMin) / 60));
    const offMins = pad(Math.abs(offsetMin) % 60);
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offHours}:${offMins}`;
  }

  private _toTimeInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
            <sleep-tracker-timeline-bar
              .intervals=${s.intervals}
              .pulses=${s.pulses}
              .startedAt=${s.started_at}
              .endedAt=${s.ended_at}
            ></sleep-tracker-timeline-bar>
          </div>
        </ha-card>

        ${s.stats
          ? html`
              <div class="section">
                <h3>Statistics</h3>
                <sleep-tracker-night-stats .stats=${s.stats}></sleep-tracker-night-stats>
              </div>
            `
          : nothing}

        <div class="section">
          <div class="section-header">
            <h3>Pulses (${s.pulses.length})</h3>
            ${editable && (s.undo_count ?? 0) > 0
              ? html`
                  <button
                    class="undo-btn"
                    ?disabled=${this._busy}
                    @click=${this._undo}
                    title="Undo last edit"
                  >
                    <ha-icon icon="mdi:undo"></ha-icon>
                    Undo
                  </button>
                `
              : nothing}
          </div>
          ${s.pulses.length > 0
            ? html`
                <div class="pulse-list">
                  ${s.pulses.map(
                    (p, i) => html`
                      <div class="pulse-item ${this._editingTimeIndex === i ? "editing" : ""}">
                        <span
                          class="pulse-type ${p.pulse_type} ${editable ? "clickable" : ""}"
                          @click=${editable ? () => this._swapPulseType(i) : nothing}
                          title=${editable ? "Click to swap type" : ""}
                        >
                          ${p.pulse_type === "awake" ? "Woke up" : "Still awake"}
                        </span>
                        ${this._editingTimeIndex === i
                          ? html`
                              <input
                                type="time"
                                class="time-input"
                                .value=${this._toTimeInput(p.timestamp)}
                                @keydown=${(e: KeyboardEvent) => {
                                  if (e.key === "Enter") this._commitEditTime(i);
                                  if (e.key === "Escape") this._cancelEditTime();
                                }}
                                autofocus
                              />
                              <button
                                class="edit-action save"
                                ?disabled=${this._busy}
                                @click=${() => this._commitEditTime(i)}
                                title="Save"
                              >
                                <ha-icon icon="mdi:check"></ha-icon>
                              </button>
                              <button
                                class="edit-action cancel"
                                ?disabled=${this._busy}
                                @click=${this._cancelEditTime}
                                title="Cancel"
                              >
                                <ha-icon icon="mdi:close"></ha-icon>
                              </button>
                            `
                          : html`
                              <span
                                class="pulse-time ${editable ? "clickable" : ""}"
                                @click=${editable ? () => this._startEditTime(i) : nothing}
                                title=${editable ? "Click to edit time" : ""}
                              >${formatTime(p.timestamp)}</span>
                            `}
                        ${this._editingTimeIndex !== i
                          ? html`
                              <span class="pulse-source">${p.source}</span>
                              ${editable
                                ? html`
                                    <button
                                      class="delete-btn"
                                      ?disabled=${this._busy}
                                      @click=${() => this._deletePulse(i)}
                                      title="Delete pulse"
                                    >
                                      <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                                    </button>
                                  `
                                : nothing}
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
        position: relative;
      }
      .pulse-item.editing {
        border-color: var(--primary-color, #03a9f4);
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
      .pulse-time.clickable {
        cursor: pointer;
        padding: 2px 6px;
        border-radius: var(--ha-border-radius-sm, 4px);
      }
      .pulse-time.clickable:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .time-input {
        flex: 1;
        font-size: var(--ha-font-size-m, 14px);
        padding: 2px 6px;
        border: 1px solid var(--primary-color, #03a9f4);
        border-radius: var(--ha-border-radius-sm, 4px);
        font-family: inherit;
        background: var(--card-background-color, white);
        color: var(--primary-text-color);
      }
      .edit-action {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        --mdc-icon-size: 18px;
      }
      .edit-action.save {
        background: var(--sleep-color-success, #66bb6a);
        color: white;
      }
      .edit-action.cancel {
        background: transparent;
        color: var(--secondary-text-color);
      }
      .edit-action.cancel:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .edit-action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--ha-space-2, 8px);
      }
      .section-header h3 {
        margin: 0;
      }
      .undo-btn {
        display: flex;
        align-items: center;
        gap: var(--ha-space-1, 4px);
        padding: var(--ha-space-1, 4px) var(--ha-space-3, 12px);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        background: var(--card-background-color, white);
        color: var(--primary-text-color);
        font-size: var(--ha-font-size-s, 12px);
        cursor: pointer;
        font-family: inherit;
        --mdc-icon-size: 16px;
      }
      .undo-btn:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .undo-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
