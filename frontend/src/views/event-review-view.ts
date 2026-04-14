import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, SleepSession, SleepEvent, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, cardStyles } from "../styles";
import { formatDate, formatTime } from "../utils";

import "../components/timeline-bar";

const CYCLE_TYPES = ["awake", "still_awake", "fell_asleep"] as const;

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
    // Only cycle user event types
    const currentIdx = CYCLE_TYPES.indexOf(event.event_type as any);
    if (currentIdx === -1) return; // pause/resume — not editable
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

  private _eventLabel(type: string): string {
    switch (type) {
      case "awake": return "Woke up";
      case "still_awake": return "Still awake";
      case "fell_asleep": return "Fell asleep";
      case "pause": return "Paused";
      case "resume": return "Resumed";
      default: return type;
    }
  }

  private _isEditable(event: SleepEvent): boolean {
    return CYCLE_TYPES.includes(event.event_type as any);
  }

  render() {
    if (this._loading) {
      return html`<div class="container"><p>Loading...</p></div>`;
    }
    if (!this._session) {
      return html`<div class="container"><p>Session not found.</p></div>`;
    }

    const s = this._session;

    // If session is already completed (has stored phases), redirect to detail
    if (s.status === "completed" || s.status === "finalized") {
      this._navigate(`/night/${s.session_id}`);
      return nothing;
    }

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

        <div class="complete-section">
          <button
            class="complete-btn"
            ?disabled=${this._busy}
            @click=${this._complete}
          >
            Looks Good
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
      </div>
    `;
  }

  private _renderEvent(event: SleepEvent, index: number) {
    const editable = this._isEditable(event);
    return html`
      <div class="event-item">
        <span
          class="event-type ${event.event_type} ${editable ? "clickable" : ""}"
          @click=${editable ? () => this._cycleEventType(index) : nothing}
          title=${editable ? "Click to change type" : ""}
        >
          ${this._eventLabel(event.event_type)}
        </span>
        <span class="event-time">${formatTime(event.timestamp)}</span>
        <span class="event-source">${event.source}</span>
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
      .event-time {
        flex: 1;
        font-size: var(--ha-font-size-m, 14px);
      }
      .event-source {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
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
    `,
  ];
}
