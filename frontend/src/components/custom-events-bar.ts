import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CustomEvent as CustomEventDef } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, buttonStyles } from "../styles";

@customElement("sleep-tracker-custom-events-bar")
export class CustomEventsBar extends LitElement {
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) customEvents: CustomEventDef[] = [];

  @state() private _flashId: string | null = null;
  @state() private _busyId: string | null = null;

  private _flashTimeoutId: number | null = null;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._flashTimeoutId !== null) {
      window.clearTimeout(this._flashTimeoutId);
      this._flashTimeoutId = null;
    }
  }

  private async _fire(custom: CustomEventDef) {
    if (this._busyId) return;
    this._busyId = custom.id;
    try {
      await this.api.customEvent(custom.id);
      this.dispatchEvent(
        new CustomEvent("sleep-tracker-state-update", {
          bubbles: true,
          composed: true,
        })
      );
      this._flashId = custom.id;
      if (this._flashTimeoutId !== null) {
        window.clearTimeout(this._flashTimeoutId);
      }
      this._flashTimeoutId = window.setTimeout(() => {
        this._flashId = null;
        this._flashTimeoutId = null;
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
      <div class="pulse-buttons custom-wrap">
        ${this.customEvents.map(
          (custom) => html`
            <button
              class="pulse-btn ${this._flashId === custom.id ? "flashed" : ""}"
              ?disabled=${this._busyId !== null}
              @click=${() => this._fire(custom)}
              title=${custom.tag ? `Applies tag: ${custom.tag}` : ""}
            >
              <ha-icon icon=${custom.icon || "mdi:star-circle-outline"}></ha-icon>
              ${custom.label}
            </button>
          `
        )}
      </div>
    `;
  }

  static styles = [
    tokens,
    buttonStyles,
    css`
      .custom-wrap {
        flex-wrap: wrap;
        margin-top: var(--ha-space-2, 8px);
      }
      .pulse-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--ha-space-2, 8px);
        min-width: 0;
      }
      .pulse-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .pulse-btn.flashed {
        background: var(--sleep-color-success, #66bb6a);
        color: white;
        border-color: var(--sleep-color-success, #66bb6a);
        transition: background 0.15s;
      }
      ha-icon {
        --mdc-icon-size: 20px;
      }
    `,
  ];
}
