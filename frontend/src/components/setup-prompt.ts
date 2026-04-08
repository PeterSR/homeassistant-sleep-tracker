import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SleepTrackerApi } from "../api";
import type { HomeAssistant } from "../types";
import { tokens, emptyStateStyles } from "../styles";

@customElement("sleep-tracker-setup-prompt")
export class SetupPrompt extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;

  private async _enable() {
    try {
      await this.api.setupUser(this.hass.user.name);
    } catch (err) {
      console.error("Failed to set up sleep tracking:", err);
    }
  }

  render() {
    return html`
      <div class="empty-state">
        <ha-icon icon="mdi:sleep" style="--mdc-icon-size: 64px; opacity: 0.5"></ha-icon>
        <h2>Sleep Tracking</h2>
        <p>Track your sleep patterns with event-based phase reconstruction.</p>
        <button class="enable-btn" @click=${this._enable}>
          Enable Sleep Tracking
        </button>
      </div>
    `;
  }

  static styles = [
    tokens,
    emptyStateStyles,
    css`
      .enable-btn {
        margin-top: var(--ha-space-4, 16px);
        padding: var(--ha-space-3, 12px) var(--ha-space-8, 32px);
        background: var(--primary-color, #03a9f4);
        color: white;
        border: none;
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
        cursor: pointer;
        font-family: inherit;
      }
      .enable-btn:hover {
        opacity: 0.85;
      }
    `,
  ];
}
