import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CustomEvent as CustomEventDef } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens } from "../styles";

@customElement("sleep-tracker-custom-events-bar")
export class CustomEventsBar extends LitElement {
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) customEvents: CustomEventDef[] = [];

  @state() private _flashId: string | null = null;
  @state() private _busyId: string | null = null;

  private async _fire(custom: CustomEventDef) {
    if (this._busyId) return;
    this._busyId = custom.id;
    try {
      await this.api.customEvent(custom.id);
      this.dispatchEvent(
        new globalThis.CustomEvent("sleep-tracker-state-update", {
          bubbles: true,
          composed: true,
        })
      );
      this._flashId = custom.id;
      setTimeout(() => {
        this._flashId = null;
      }, 600);
    } catch (err) {
      console.error("Custom event failed:", err);
    } finally {
      this._busyId = null;
    }
  }

  render() {
    if (!this.customEvents?.length) return nothing;
    return html`
      <div class="custom-events">
        ${this.customEvents.map(
          (custom) => html`
            <button
              class="custom-btn ${this._flashId === custom.id ? "flashed" : ""}"
              ?disabled=${this._busyId !== null}
              @click=${() => this._fire(custom)}
              title=${custom.tag ? `Applies tag: ${custom.tag}` : ""}
            >
              ${custom.icon
                ? html`<ha-icon icon=${custom.icon}></ha-icon>`
                : nothing}
              <span>${custom.label}</span>
            </button>
          `
        )}
      </div>
    `;
  }

  static styles = [
    tokens,
    css`
      .custom-events {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ha-space-2, 8px);
        justify-content: center;
        margin: var(--ha-space-3, 12px) 0;
      }
      .custom-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
        background: var(--card-background-color, white);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
      }
      .custom-btn:hover {
        border-color: var(--primary-color, #03a9f4);
      }
      .custom-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .custom-btn.flashed {
        background: var(--sleep-color-success, #66bb6a);
        color: white;
        border-color: var(--sleep-color-success, #66bb6a);
      }
      ha-icon {
        --mdc-icon-size: 18px;
      }
    `,
  ];
}
