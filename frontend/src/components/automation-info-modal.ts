import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant } from "../types";
import { tokens, cardStyles } from "../styles";

@customElement("sleep-tracker-automation-info-modal")
export class AutomationInfoModal extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property() automationId: string | null = null;
  @property() automationTriggerId: string | null = null;

  private _close() {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true })
    );
  }

  private _openAutomation() {
    if (!this.automationId) return;
    const url = `/config/automation/edit/${encodeURIComponent(this.automationId)}`;
    window.open(url, "_blank");
  }

  render() {
    const friendly = this.automationId
      ? this.hass?.states[this.automationId]?.attributes?.friendly_name
      : undefined;
    const triggerErr = this.automationTriggerId === "ERROR";
    const triggerDisplay = triggerErr
      ? "Unknown (trace lookup failed — HA internal API may have changed)"
      : this.automationTriggerId ?? "(not recorded)";

    return html`
      <div class="overlay" @click=${this._close}>
        <ha-card class="card" @click=${(e: Event) => e.stopPropagation()}>
          <div class="header">
            <ha-icon icon="mdi:robot-outline"></ha-icon>
            <h3>Automation event</h3>
          </div>

          <dl>
            <dt>Automation</dt>
            <dd>
              ${this.automationId
                ? html`
                    <code>${this.automationId}</code>
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

          <div class="actions">
            ${this.automationId
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
