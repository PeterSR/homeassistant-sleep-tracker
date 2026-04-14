import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, SleepSession, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, sectionStyles, cardStyles } from "../styles";
import { formatDate, formatTime, formatDuration } from "../utils";

import "../components/timeline-bar";
import "../components/night-stats";
import "../components/session-meta";

type BoundaryEdit = { afterIndex: number };

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
  @state() private _editingBoundary: BoundaryEdit | null = null;
  @state() private _splittingPhaseIndex: number | null = null;
  @state() private _showEvents = false;
  @state() private _confirmDelete = false;

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
    return !!this._session && this._session.status === "completed";
  }

  private async _deletePhase(index: number) {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      this._session = await this.api.deletePhase(this._session.session_id, index);
    } catch (err) {
      console.error("Delete phase failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _splitPhase(index: number) {
    if (!this._session || this._busy) return;
    const phase = this._session.phases[index];
    // Default split point: middle of the phase
    const startMs = new Date(phase.start).getTime();
    const endMs = new Date(phase.end).getTime();
    const midMs = (startMs + endMs) / 2;
    const at = this._toLocalIso(new Date(midMs));

    this._busy = true;
    try {
      this._session = await this.api.splitPhase(this._session.session_id, index, at);
    } catch (err) {
      console.error("Split phase failed:", err);
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

  private _startEditBoundary(afterIndex: number) {
    if (!this._editable) return;
    this._editingBoundary = { afterIndex };
  }

  private _cancelEditBoundary() {
    this._editingBoundary = null;
  }

  private async _commitEditBoundary() {
    if (!this._session || !this._editingBoundary) return;
    const { afterIndex } = this._editingBoundary;
    const input = this.shadowRoot?.querySelector(".time-input") as HTMLInputElement | null;
    if (!input) {
      this._editingBoundary = null;
      return;
    }
    const newTimeValue = input.value;
    if (!newTimeValue) {
      this._editingBoundary = null;
      return;
    }

    // Build a new ISO timestamp by replacing the time portion of the existing boundary
    const oldTs = this._session.phases[afterIndex].end;
    const oldDate = new Date(oldTs);
    const [h, m] = newTimeValue.split(":").map(Number);
    oldDate.setHours(h, m, 0, 0);
    const newTs = this._toLocalIso(oldDate);

    this._busy = true;
    this._editingBoundary = null;
    try {
      this._session = await this.api.adjustPhaseBoundary(
        this._session.session_id,
        afterIndex,
        newTs
      );
    } catch (err) {
      console.error("Adjust boundary failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private _toLocalIso(d: Date): string {
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

  private _phaseDuration(start: string, end: string): string {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return formatDuration(ms / 60000);
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

  private _renderEnvironment() {
    const config = this.userState?.config;
    if (!config?.show_environment || !config.environment_entities?.length) {
      return nothing;
    }

    return html`
      <div class="section">
        <h3>Environment</h3>
        <div class="env-list">
          ${config.environment_entities.map((entityId) => {
            const stateObj = this.hass.states?.[entityId];
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

  private _navigate(path: string) {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        bubbles: true,
        composed: true,
        detail: { path },
      })
    );
  }

  private async _deleteSession() {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      await this.api.deleteSession(this._session.session_id);
      this._navigate("/history");
    } catch (err) {
      console.error("Delete session failed:", err);
    } finally {
      this._busy = false;
      this._confirmDelete = false;
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

    // Stopped sessions (event review pending) should go to the review view
    if (this._session.status === "stopped") {
      this._navigate(`/review/${this._session.session_id}`);
      return nothing;
    }

    const s = this._session;
    const editable = this._editable;
    const phases = s.phases ?? [];

    return html`
      <div class="container">
        ${!s.finalized && s.ended_at
          ? html`
              <div class="review-banner">
                <ha-icon icon="mdi:pencil-outline"></ha-icon>
                <span>This session is not finalized. Edit phases below, then finalize when ready.</span>
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
              .phases=${phases}
              .startedAt=${s.started_at}
              .endedAt=${s.ended_at}
            ></sleep-tracker-timeline-bar>
          </div>
        </ha-card>

        ${s.stats
          ? html`
              <div class="section">
                <h3>Statistics</h3>
                <sleep-tracker-night-stats
                  .stats=${s.stats}
                  .goalMinutes=${this.userState.config?.sleep_goal_minutes ?? 0}
                ></sleep-tracker-night-stats>
              </div>
            `
          : nothing}

        ${this.userState.config
          ? html`
              <sleep-tracker-session-meta
                .hass=${this.hass}
                .api=${this.api}
                .session=${s}
                .config=${this.userState.config}
                @session-updated=${(e: CustomEvent) => { this._session = e.detail.session; }}
              ></sleep-tracker-session-meta>
            `
          : nothing}

        ${this._renderEnvironment()}

        <div class="section">
          <div class="section-header">
            <h3>Phases (${phases.length})</h3>
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
          ${this._renderPhaseList(phases, editable)}
        </div>

        <div class="section">
          <div class="section-header">
            <h3>
              <button
                class="toggle-btn"
                @click=${() => { this._showEvents = !this._showEvents; }}
              >
                <ha-icon icon=${this._showEvents ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>
                Events (${s.events.length}) — read-only
              </button>
            </h3>
          </div>
          ${this._showEvents
            ? html`
                <div class="events-timeline">
                  <sleep-tracker-timeline-bar
                    .phases=${phases}
                    .events=${s.events}
                    .startedAt=${s.started_at}
                    .endedAt=${s.ended_at}
                    compact
                    .showEvents=${true}
                  ></sleep-tracker-timeline-bar>
                </div>
                ${this._renderEventList(s.events)}
              `
            : nothing}
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

        <div class="delete-section">
          <button
            class="delete-session-btn"
            @click=${() => { this._confirmDelete = true; }}
          >
            <ha-icon icon="mdi:trash-can-outline"></ha-icon>
            Delete Session
          </button>
        </div>

        ${this._confirmDelete
          ? html`
              <div class="confirm-overlay" @click=${() => { this._confirmDelete = false; }}>
                <ha-card class="confirm-card" @click=${(e: Event) => e.stopPropagation()}>
                  <h3>Delete this session?</h3>
                  <p>This will permanently remove the session and all its data.</p>
                  ${s.exported
                    ? html`<p class="export-note">
                        <ha-icon icon="mdi:information-outline"></ha-icon>
                        This session was exported and may still exist externally.
                      </p>`
                    : nothing}
                  <div class="confirm-actions">
                    <button
                      class="confirm-cancel"
                      @click=${() => { this._confirmDelete = false; }}
                    >
                      Cancel
                    </button>
                    <button
                      class="confirm-delete"
                      ?disabled=${this._busy}
                      @click=${this._deleteSession}
                    >
                      ${this._busy ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </ha-card>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderPhaseList(phases: any[], editable: boolean) {
    if (phases.length === 0) {
      return html`<p class="empty-text">No phases.</p>`;
    }

    return html`
      <div class="phase-list">
        ${phases.map((p, i) => {
          const isFirst = i === 0;
          const isLast = i === phases.length - 1;
          const editingThisBoundary =
            this._editingBoundary !== null &&
            this._editingBoundary.afterIndex === i;

          return html`
            <div class="phase-item ${p.state}">
              <div class="phase-row">
                <span class="phase-state ${p.state}">
                  ${p.state === "asleep" ? "Asleep" : "Awake"}
                </span>
                <span class="phase-times">
                  ${formatTime(p.start)} — ${formatTime(p.end)}
                </span>
                <span class="phase-duration">
                  ${this._phaseDuration(p.start, p.end)}
                </span>
                ${editable
                  ? html`
                      <button
                        class="phase-action"
                        ?disabled=${this._busy}
                        @click=${() => this._splitPhase(i)}
                        title="Split phase (insert opposite-state wedge)"
                      >
                        <ha-icon icon="mdi:call-split"></ha-icon>
                      </button>
                      ${phases.length > 1
                        ? html`
                            <button
                              class="phase-action delete"
                              ?disabled=${this._busy}
                              @click=${() => this._deletePhase(i)}
                              title="Delete phase (merges neighbors)"
                            >
                              <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                            </button>
                          `
                        : nothing}
                    `
                  : nothing}
              </div>
            </div>
            ${!isLast
              ? html`
                  <div class="boundary">
                    ${editingThisBoundary
                      ? html`
                          <input
                            type="time"
                            class="time-input"
                            .value=${this._toTimeInput(p.end)}
                            @keydown=${(e: KeyboardEvent) => {
                              if (e.key === "Enter") this._commitEditBoundary();
                              if (e.key === "Escape") this._cancelEditBoundary();
                            }}
                            autofocus
                          />
                          <button
                            class="edit-action save"
                            ?disabled=${this._busy}
                            @click=${this._commitEditBoundary}
                            title="Save"
                          >
                            <ha-icon icon="mdi:check"></ha-icon>
                          </button>
                          <button
                            class="edit-action cancel"
                            ?disabled=${this._busy}
                            @click=${this._cancelEditBoundary}
                            title="Cancel"
                          >
                            <ha-icon icon="mdi:close"></ha-icon>
                          </button>
                        `
                      : html`
                          <span
                            class="boundary-time ${editable ? "clickable" : ""}"
                            @click=${editable ? () => this._startEditBoundary(i) : nothing}
                            title=${editable ? "Click to adjust boundary" : ""}
                          >
                            ↕ ${formatTime(p.end)}
                          </span>
                        `}
                  </div>
                `
              : nothing}
          `;
        })}
      </div>
    `;
  }

  private _renderEventList(events: any[]) {
    if (events.length === 0) {
      return html`<p class="empty-text">No events recorded.</p>`;
    }
    return html`
      <div class="event-list">
        ${events.map(
          (e) => html`
            <div class="event-item">
              <span class="event-type ${e.event_type}">
                ${e.event_type === "awake"
                  ? "Woke up"
                  : e.event_type === "still_awake"
                    ? "Still awake"
                    : e.event_type === "fell_asleep"
                      ? "Fell asleep"
                      : e.event_type === "pause"
                        ? "Paused"
                        : e.event_type === "resume"
                          ? "Resumed"
                          : e.event_type}
              </span>
              <span class="event-time">${formatTime(e.timestamp)}</span>
              <span class="event-source">${e.source}</span>
            </div>
          `
        )}
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
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--ha-space-2, 8px);
      }
      .section-header h3 {
        margin: 0;
      }
      .toggle-btn {
        display: flex;
        align-items: center;
        gap: var(--ha-space-1, 4px);
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        text-transform: uppercase;
        letter-spacing: 0.05em;
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

      /* Phase list */
      .phase-list {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .phase-item {
        display: flex;
        flex-direction: column;
        background: var(--card-background-color, white);
        border-radius: var(--ha-border-radius-md, 8px);
        border: 1px solid var(--divider-color, #e0e0e0);
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        border-left: 4px solid var(--divider-color, #e0e0e0);
      }
      .phase-item.asleep {
        border-left-color: var(--sleep-color-asleep, #42a5f5);
      }
      .phase-item.awake {
        border-left-color: var(--sleep-color-awake, #ef5350);
      }
      .phase-row {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
      }
      .phase-state {
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-medium, 500);
        padding: 2px var(--ha-space-2, 8px);
        border-radius: var(--ha-border-radius-sm, 4px);
        color: white;
        white-space: nowrap;
        min-width: 60px;
        text-align: center;
      }
      .phase-state.asleep {
        background: var(--sleep-color-asleep, #42a5f5);
      }
      .phase-state.awake {
        background: var(--sleep-color-awake, #ef5350);
      }
      .phase-times {
        font-size: var(--ha-font-size-m, 14px);
        flex: 1;
      }
      .phase-duration {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .phase-action {
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
      .phase-action:hover {
        background: var(--secondary-background-color, #f5f5f5);
        color: var(--primary-text-color);
      }
      .phase-action.delete:hover {
        background: var(--sleep-color-awake, #ef5350);
        color: white;
      }
      .phase-action:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      /* Boundary between phases */
      .boundary {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-1, 4px) 0;
        margin: 0 var(--ha-space-3, 12px);
      }
      .boundary-time {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        padding: 2px 8px;
        border-radius: var(--ha-border-radius-sm, 4px);
      }
      .boundary-time.clickable {
        cursor: pointer;
      }
      .boundary-time.clickable:hover {
        background: var(--secondary-background-color, #f5f5f5);
        color: var(--primary-color, #03a9f4);
      }
      .time-input {
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

      /* Events compact timeline */
      .events-timeline {
        margin-bottom: var(--ha-space-3, 12px);
      }

      /* Event list */
      .event-list {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-1, 4px);
      }
      .event-item {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        padding: var(--ha-space-1, 4px) var(--ha-space-3, 12px);
        background: var(--secondary-background-color, #f5f5f5);
        border-radius: var(--ha-border-radius-sm, 4px);
        font-size: var(--ha-font-size-s, 12px);
      }
      .event-type {
        font-weight: var(--ha-font-weight-medium, 500);
        padding: 1px 6px;
        border-radius: var(--ha-border-radius-sm, 4px);
        color: white;
        white-space: nowrap;
        min-width: 80px;
        text-align: center;
      }
      .event-type.awake {
        background: var(--sleep-color-event-wake, #c2185b);
      }
      .event-type.still_awake {
        background: var(--sleep-color-pulse, #ff9800);
      }
      .event-type.fell_asleep {
        background: var(--sleep-color-asleep, #42a5f5);
      }
      .event-type.pause,
      .event-type.resume {
        background: var(--secondary-text-color);
      }
      .event-time {
        flex: 1;
      }
      .event-source {
        color: var(--secondary-text-color);
      }

      .empty-text {
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
      }

      /* Environment tiles */
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

      /* Delete session */
      .delete-section {
        margin-top: var(--ha-space-8, 32px);
        text-align: center;
      }
      .delete-session-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
        background: none;
        border: none;
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
        cursor: pointer;
        font-family: inherit;
        --mdc-icon-size: 16px;
      }
      .delete-session-btn:hover {
        color: var(--sleep-color-awake, #ef5350);
      }

      /* Confirm overlay */
      .confirm-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
      }
      .confirm-card {
        padding: var(--ha-space-6, 24px);
        max-width: 360px;
        width: 90%;
      }
      .confirm-card h3 {
        margin: 0 0 var(--ha-space-3, 12px);
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .confirm-card p {
        margin: 0 0 var(--ha-space-3, 12px);
        font-size: var(--ha-font-size-m, 14px);
        color: var(--secondary-text-color);
      }
      .export-note {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        background: #e3f2fd;
        border-radius: var(--ha-border-radius-sm, 4px);
        font-size: var(--ha-font-size-s, 12px) !important;
        color: var(--primary-text-color) !important;
        --mdc-icon-size: 16px;
      }
      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--ha-space-3, 12px);
        margin-top: var(--ha-space-4, 16px);
      }
      .confirm-cancel {
        padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
        background: none;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
        font-family: inherit;
        color: var(--primary-text-color);
      }
      .confirm-cancel:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .confirm-delete {
        padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
        background: var(--sleep-color-awake, #ef5350);
        color: white;
        border: none;
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        cursor: pointer;
        font-family: inherit;
      }
      .confirm-delete:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];
}
