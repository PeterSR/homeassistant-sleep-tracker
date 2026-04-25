import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SleepTrackerApi } from "../api";
import { tokens, buttonStyles } from "../styles";

@customElement("sleep-tracker-pulse-button")
export class PulseButton extends LitElement {
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ type: Boolean }) disabled = false;
  @state() private _sending = false;
  @state() private _flash: "awake" | "still_awake" | null = null;

  private _flashTimeoutId: number | null = null;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._flashTimeoutId !== null) {
      window.clearTimeout(this._flashTimeoutId);
      this._flashTimeoutId = null;
    }
  }

  private async _sendEvent(type: "awake" | "still_awake") {
    if (this._sending || this.disabled) return;
    this._sending = true;
    try {
      await this.api.event(type);
      this.dispatchEvent(
        new CustomEvent("sleep-tracker-state-update", {
          bubbles: true,
          composed: true,
        })
      );
      this._flash = type;
      if (this._flashTimeoutId !== null) {
        window.clearTimeout(this._flashTimeoutId);
      }
      this._flashTimeoutId = window.setTimeout(() => {
        this._flash = null;
        this._flashTimeoutId = null;
      }, 600);
    } catch (err) {
      console.error("Event failed:", err);
    } finally {
      this._sending = false;
    }
  }

  render() {
    return html`
      <div class="pulse-buttons">
        <button
          class="pulse-btn ${this._flash === "awake" ? "flashed" : ""}"
          ?disabled=${this.disabled || this._sending}
          @click=${() => this._sendEvent("awake")}
        >
          <ha-icon icon="mdi:eye-outline"></ha-icon>
          I woke up
        </button>
        <button
          class="pulse-btn ${this._flash === "still_awake" ? "flashed" : ""}"
          ?disabled=${this.disabled || this._sending}
          @click=${() => this._sendEvent("still_awake")}
        >
          <ha-icon icon="mdi:eye-check-outline"></ha-icon>
          Still awake
        </button>
      </div>
    `;
  }

  static styles = [
    tokens,
    buttonStyles,
    css`
      .pulse-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--ha-space-2, 8px);
      }
      .pulse-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .pulse-btn.flashed {
        background: var(--sleep-color-success, #009E73);
        color: white;
        border-color: var(--sleep-color-success, #009E73);
        transition: background 0.15s;
      }
      ha-icon {
        --mdc-icon-size: 20px;
      }
    `,
  ];
}
