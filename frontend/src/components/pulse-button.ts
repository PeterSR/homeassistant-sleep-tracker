import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SleepTrackerApi } from "../api";
import { tokens, buttonStyles } from "../styles";

@customElement("pulse-button")
export class PulseButton extends LitElement {
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ type: Boolean }) disabled = false;
  @state() private _sending = false;
  @state() private _flash: "awake" | "still_awake" | null = null;

  private async _pulse(type: "awake" | "still_awake") {
    if (this._sending || this.disabled) return;
    this._sending = true;
    try {
      await this.api.pulse(type);
      this._flash = type;
      setTimeout(() => {
        this._flash = null;
      }, 600);
    } catch (err) {
      console.error("Pulse failed:", err);
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
          @click=${() => this._pulse("awake")}
        >
          <ha-icon icon="mdi:eye-outline"></ha-icon>
          I woke up
        </button>
        <button
          class="pulse-btn ${this._flash === "still_awake" ? "flashed" : ""}"
          ?disabled=${this.disabled || this._sending}
          @click=${() => this._pulse("still_awake")}
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
