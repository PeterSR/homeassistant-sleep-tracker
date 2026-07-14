import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { CustomEvent as CustomEventDef, HomeAssistant, SleepEvent } from "../types";
import { tokens, cardStyles } from "../styles";
import { formatDateTime } from "../utils";

@customElement("sleep-tracker-event-info-modal")
export class EventInfoModal extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) event: SleepEvent | null = null;
  @property({ attribute: false }) customEvents: CustomEventDef[] = [];

  private _close() {
    this.dispatchEvent(
      new globalThis.CustomEvent("close", { bubbles: true, composed: true })
    );
  }

  private _openAutomation() {
    const id = this.event?.automation_id;
    if (!id) return;
    const url = `/config/automation/edit/${encodeURIComponent(id)}`;
    window.open(url, "_blank");
  }

  private _eventTypeLabel(): string {
    if (!this.event) return "";
    switch (this.event.event_type) {
      case "awake": return "Woke up";
      case "still_awake": return "Still awake";
      case "fell_asleep": return "Fell asleep";
      case "pause": return "Paused";
      case "resume": return "Resumed";
      case "custom": {
        const def = this.customEvents.find(
          (c) => c.id === this.event?.custom_event_id
        );
        return def?.label ?? "Custom event";
      }
      default: return this.event.event_type;
    }
  }

  render() {
    const e = this.event;
    if (!e) return nothing;

    const automationId = e.automation_id ?? null;
    const triggerId = e.automation_trigger_id ?? null;
    const hasAutomation = !!automationId || !!triggerId;
    const friendly = automationId
      ? this.hass?.states[automationId]?.attributes?.friendly_name
      : undefined;
    const triggerErr = triggerId === "ERROR";
    const triggerDisplay = triggerErr
      ? "Unknown (trace lookup failed - HA internal API may have changed)"
      : triggerId ?? "(not recorded)";

    return html`
      <div class="overlay" @click=${this._close}>
        <ha-card class="card" @click=${(ev: Event) => ev.stopPropagation()}>
          <div class="header">
            <ha-icon icon="mdi:information-outline"></ha-icon>
            <h3>Event details</h3>
          </div>

          <dl>
            <dt>Type</dt>
            <dd>
              <span class="type-badge ${e.event_type}">${this._eventTypeLabel()}</span>
            </dd>

            <dt>Time</dt>
            <dd>${formatDateTime(e.timestamp)}</dd>

            <dt>Source</dt>
            <dd>${e.source || "(unknown)"}</dd>
          </dl>

          ${hasAutomation
            ? html`
                <div class="section-divider">
                  <ha-icon icon="mdi:robot-outline"></ha-icon>
                  <span>Automation</span>
                </div>
                <dl>
                  <dt>Automation</dt>
                  <dd>
                    ${automationId
                      ? html`
                          <code>${automationId}</code>
                          ${friendly
                            ? html`<div class="friendly">${friendly}</div>`
                            : nothing}
                        `
                      : html`<span class="muted">(not recorded)</span>`}
                  </dd>

                  <dt>Trigger ID</dt>
                  <dd class=${triggerErr ? "error" : ""}>
                    ${triggerErr
                      ? html`<ha-icon icon="mdi:alert-circle-outline"></ha-icon>`
                      : nothing}
                    ${triggerDisplay}
                  </dd>
                </dl>
              `
            : nothing}

          <div class="actions">
            ${automationId
              ? html`
                  <button class="open-btn" @click=${this._openAutomation}>
                    <ha-icon icon="mdi:open-in-new"></ha-icon>
                    Open automation
                  </button>
                `
              : nothing}
            <button class="close-btn" @click=${this._close}>Close</button>
          </div>
        </ha-card>
      </div>
    `;
  }

  static styles = [
    tokens,
    cardStyles,
    css`
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
      }
      .card {
        padding: var(--ha-space-6, 24px);
        max-width: 420px;
        width: 90%;
      }
      .header {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        margin-bottom: var(--ha-space-4, 16px);
      }
      .header h3 {
        margin: 0;
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .header ha-icon {
        --mdc-icon-size: 24px;
        color: var(--primary-color, #03a9f4);
      }
      dl {
        margin: 0;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
      }
      dt {
        font-size: var(--ha-font-size-s, 12px);
        text-transform: uppercase;
        color: var(--secondary-text-color);
        align-self: start;
        padding-top: 2px;
      }
      dd {
        margin: 0;
        font-size: var(--ha-font-size-m, 14px);
        word-break: break-all;
      }
      dd.error {
        color: var(--sleep-color-awake, #D55E00);
        display: flex;
        align-items: flex-start;
        gap: var(--ha-space-1, 4px);
      }
      dd.error ha-icon {
        --mdc-icon-size: 16px;
        flex-shrink: 0;
        margin-top: 2px;
      }
      .type-badge {
        display: inline-block;
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-medium, 500);
        padding: 2px 8px;
        border-radius: var(--ha-border-radius-sm, 4px);
        color: white;
      }
      .type-badge.awake {
        background: var(--sleep-color-event-wake, #CC79A7);
      }
      .type-badge.still_awake {
        background: var(--sleep-color-pulse, #E69F00);
      }
      .type-badge.fell_asleep {
        background: var(--sleep-color-asleep, #0072B2);
      }
      .type-badge.pause,
      .type-badge.resume {
        background: var(--secondary-text-color);
      }
      .type-badge.custom {
        background: var(--sleep-color-pulse, #E69F00);
      }
      .section-divider {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        margin: var(--ha-space-5, 20px) 0 var(--ha-space-3, 12px);
        padding-top: var(--ha-space-3, 12px);
        border-top: 1px solid var(--divider-color, #e0e0e0);
        font-size: var(--ha-font-size-s, 12px);
        text-transform: uppercase;
        color: var(--secondary-text-color);
        --mdc-icon-size: 16px;
      }
      code {
        font-family: var(--ha-font-family-code, monospace);
        font-size: var(--ha-font-size-s, 12px);
        background: var(--secondary-background-color, #f5f5f5);
        padding: 2px 6px;
        border-radius: var(--ha-border-radius-sm, 4px);
      }
      .friendly {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        margin-top: 2px;
      }
      .muted {
        color: var(--secondary-text-color);
        font-style: italic;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--ha-space-3, 12px);
        margin-top: var(--ha-space-6, 24px);
      }
      button {
        padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
        font-family: inherit;
      }
      .open-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--ha-space-1, 4px);
        background: var(--primary-color, #03a9f4);
        color: white;
        border: none;
        --mdc-icon-size: 16px;
      }
      .open-btn:hover {
        opacity: 0.9;
      }
      .close-btn {
        background: none;
        border: 1px solid var(--divider-color, #e0e0e0);
        color: var(--primary-text-color);
      }
      .close-btn:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
    `,
  ];
}
