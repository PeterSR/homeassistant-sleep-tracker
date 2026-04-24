import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  CYCLE_TYPES,
  type CycleType,
  type HomeAssistant,
  type SleepEvent,
  type SleepSession,
  type ToolbarConfig,
  type UserState,
} from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, cardStyles } from "../styles";
import { formatDate, formatTime } from "../utils";

import "../components/timeline-bar";
import "../components/session-meta";
import "../components/automation-info-modal";

function isCycleType(t: string): t is CycleType {
  return (CYCLE_TYPES as readonly string[]).includes(t);
}

@customElement("sleep-tracker-event-review-view")
export class EventReviewView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
  @property() sessionId = "";
  @property({ type: Boolean }) narrow = false;

  @state() private _session: SleepSession | null = null;
  @state() private _loading = true;
  @state() private _busy = false;
  @state() private _confirmDelete = false;
  @state() private _automationModal: SleepEvent | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._load();
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has("sessionId") && this.sessionId) {
      this._load();
    }
    if (this._session && (this._session.status === "completed" || this._session.status === "finalized")) {
      this._navigate(`/night/${this._session.session_id}`);
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
      ? `Review — ${formatDate(this._session.started_at)}`
      : "Review Events";
    this.dispatchEvent(
      new CustomEvent<ToolbarConfig>("set-toolbar", {
        bubbles: true,
        composed: true,
        detail: { title, backPath: "/" },
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

  private async _cycleEventType(index: number) {
    if (!this._session || this._busy) return;
    const event = this._session.events[index];
    if (!isCycleType(event.event_type)) return;
    const currentIdx = CYCLE_TYPES.indexOf(event.event_type);
    const nextType = CYCLE_TYPES[(currentIdx + 1) % CYCLE_TYPES.length];

    this._busy = true;
    try {
      this._session = await this.api.editEvent(
        this._session.session_id,
        index,
        nextType
      );
    } catch (err) {
      console.error("Edit event failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _deleteEvent(index: number) {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      this._session = await this.api.deleteEvent(
        this._session.session_id,
        index
      );
    } catch (err) {
      console.error("Delete event failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _complete() {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      await this.api.completeSession(this._session.session_id);
      this._navigate(`/night/${this._session.session_id}`);
    } catch (err) {
      console.error("Complete session failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _reopen() {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      await this.api.reopenSession(this._session.session_id);
      this._navigate("/");
    } catch (err) {
      console.error("Reopen failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _deleteSession() {
    if (!this._session || this._busy) return;
    this._busy = true;
    try {
      await this.api.deleteSession(this._session.session_id);
      this._navigate("/");
    } catch (err) {
      console.error("Delete session failed:", err);
    } finally {
      this._busy = false;
      this._confirmDelete = false;
    }
  }

  private _eventLabel(event: SleepEvent): string {
    switch (event.event_type) {
      case "awake": return "Woke up";
      case "still_awake": return "Still awake";
      case "fell_asleep": return "Fell asleep";
      case "pause": return "Paused";
      case "resume": return "Resumed";
      case "custom": {
        const def = this.userState.config?.custom_events?.find(
          (c) => c.id === event.custom_event_id
        );
        return def?.label ?? "Custom event";
      }
      default: return event.event_type;
    }
  }

  private _isEditable(event: SleepEvent): boolean {
    return isCycleType(event.event_type);
  }

  render() {
    if (this._loading) {
      return html`<div class="container"><p>Loading...</p></div>`;
    }
    if (!this._session) {
      return html`<div class="container"><p>Session not found.</p></div>`;
    }

    const s = this._session;

    if (s.status === "completed" || s.status === "finalized") {
      return nothing;
    }

    const phaseReviewSkipped = this.userState.config?.skip_phase_review ?? false;
    const buttonLabel = phaseReviewSkipped ? "Finalize" : "Continue to phases";

    return html`
      <div class="container">
        <ha-card>
          <div class="time-range">
            ${formatTime(s.started_at)} — ${s.ended_at ? formatTime(s.ended_at) : ""}
          </div>
          <div class="timeline-section">
            <sleep-tracker-timeline-bar
              .phases=${s.phases}
              .events=${s.events}
              .startedAt=${s.started_at}
              .endedAt=${s.ended_at}
              .showEvents=${true}
            ></sleep-tracker-timeline-bar>
          </div>
        </ha-card>

        ${phaseReviewSkipped
          ? html`
              <sleep-tracker-session-meta
                .hass=${this.hass}
                .api=${this.api}
                .session=${s}
                .config=${this.userState.config!}
                @session-updated=${(e: CustomEvent<{ session: SleepSession }>) => {
                  this._session = e.detail.session;
                }}
              ></sleep-tracker-session-meta>
            `
          : nothing}

        <div class="complete-section">
          <button
            class="complete-btn"
            ?disabled=${this._busy}
            @click=${this._complete}
          >
            ${buttonLabel}
          </button>
        </div>

        <div class="events-section">
          <h3>Events (${s.events.length})</h3>
          ${s.events.length === 0
            ? html`<p class="empty-text">No events recorded.</p>`
            : html`
                <div class="event-list">
                  ${s.events.map((e, i) => this._renderEvent(e, i))}
                </div>
              `}
        </div>

        <div class="bottom-actions">
          <button
            class="reopen-btn"
            ?disabled=${this._busy}
            @click=${this._reopen}
          >
            <ha-icon icon="mdi:play"></ha-icon>
            Reopen Session
          </button>
        </div>

        <div class="delete-section">
          <button
            class="delete-session-btn"
            @click=${() => { this._confirmDelete = true; }}
          >
            <ha-icon icon="mdi:trash-can-outline"></ha-icon>
            Delete Session
          </button>
        </div>

        ${this._automationModal
          ? html`
              <sleep-tracker-automation-info-modal
                .hass=${this.hass}
                .automationId=${this._automationModal.automation_id ?? null}
                .automationTriggerId=${this._automationModal.automation_trigger_id ?? null}
                @close=${() => { this._automationModal = null; }}
              ></sleep-tracker-automation-info-modal>
            `
          : nothing}

        ${this._confirmDelete
          ? html`
              <div class="confirm-overlay" @click=${() => { this._confirmDelete = false; }}>
                <ha-card class="confirm-card" @click=${(e: Event) => e.stopPropagation()}>
                  <h3>Delete this session?</h3>
                  <p>This will permanently remove the session and all its data.</p>
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

  private _renderEvent(event: SleepEvent, index: number) {
    const editable = this._isEditable(event);
    const hasAutomation =
      !!event.automation_id || !!event.automation_trigger_id;
    return html`
      <div class="event-item">
        <span
          class="event-type ${event.event_type} ${editable ? "clickable" : ""}"
          @click=${editable ? () => this._cycleEventType(index) : undefined}
          title=${editable ? "Click to change type" : ""}
        >
          ${this._eventLabel(event)}
        </span>
        <span class="event-time">${formatTime(event.timestamp)}</span>
        ${hasAutomation
          ? html`
              <button
                class="automation-chip ${event.automation_trigger_id === "ERROR" ? "err" : ""}"
                @click=${() => { this._automationModal = event; }}
                title="Show automation info"
              >
                <ha-icon icon="mdi:robot-outline"></ha-icon>
                automation
              </button>
            `
          : html`<span class="event-source">${event.source}</span>`}
        <button
          class="event-delete"
          ?disabled=${this._busy}
          @click=${() => this._deleteEvent(index)}
          title="Delete event"
        >
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
    `;
  }

  static styles = [
    tokens,
    viewStyles,
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

      .complete-section {
        margin-bottom: var(--ha-space-6, 24px);
      }
      .complete-btn {
        width: 100%;
        padding: var(--ha-space-4, 16px);
        background: var(--sleep-color-success, #66bb6a);
        color: white;
        border: none;
        border-radius: var(--ha-border-radius-lg, 12px);
        font-size: var(--ha-font-size-xl, 20px);
        font-weight: var(--ha-font-weight-medium, 500);
        cursor: pointer;
        font-family: inherit;
      }
      .complete-btn:hover {
        opacity: 0.85;
      }
      .complete-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .events-section h3 {
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        text-transform: uppercase;
        color: var(--secondary-text-color);
        margin: 0 0 var(--ha-space-2, 8px);
      }
      .event-list {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-2, 8px);
      }
      .event-item {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        background: var(--card-background-color, white);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
      }
      .event-type {
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-medium, 500);
        padding: 2px 8px;
        border-radius: var(--ha-border-radius-sm, 4px);
        color: white;
        white-space: nowrap;
        min-width: 80px;
        text-align: center;
      }
      .event-type.clickable {
        cursor: pointer;
        outline: 2px dashed transparent;
        transition: outline-color 0.15s;
      }
      .event-type.clickable:hover {
        outline-color: var(--primary-color, #03a9f4);
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
      .event-type.pause {
        background: var(--secondary-text-color);
      }
      .event-type.resume {
        background: var(--secondary-text-color);
      }
      .event-type.custom {
        background: var(--sleep-color-pulse, #ff9800);
      }
      .event-time {
        flex: 1;
        font-size: var(--ha-font-size-m, 14px);
      }
      .event-source {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .automation-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: var(--secondary-background-color, #f5f5f5);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-sm, 4px);
        font-size: var(--ha-font-size-s, 12px);
        cursor: pointer;
        font-family: inherit;
        --mdc-icon-size: 14px;
      }
      .automation-chip:hover {
        background: var(--divider-color, #e0e0e0);
      }
      .automation-chip.err {
        color: var(--sleep-color-awake, #ef5350);
        border-color: var(--sleep-color-awake, #ef5350);
      }
      .event-delete {
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
        --mdc-icon-size: 16px;
      }
      .event-delete:hover {
        background: var(--sleep-color-awake, #ef5350);
        color: white;
      }
      .event-delete:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .empty-text {
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
      }

      .bottom-actions {
        margin-top: var(--ha-space-8, 32px);
        text-align: center;
      }
      .reopen-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
        background: none;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        color: var(--primary-text-color);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
        font-family: inherit;
        --mdc-icon-size: 18px;
      }
      .reopen-btn:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .reopen-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Delete session */
      .delete-section {
        margin-top: var(--ha-space-4, 16px);
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
