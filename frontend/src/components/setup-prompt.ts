import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SleepTrackerApi } from "../api";
import type { HomeAssistant } from "../types";
import { tokens, emptyStateStyles } from "../styles";

@customElement("sleep-tracker-setup-prompt")
export class SetupPrompt extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;

  @state() private _wizard: "shared" | null = null;
  @state() private _sharedName = "";
  @state() private _busy = false;

  private async _enablePersonal() {
    this._busy = true;
    try {
      await this.api.setupTracker(this.hass.user.name);
      this._notifyTrackersChanged();
    } catch (err) {
      console.error("Failed to set up sleep tracking:", err);
    } finally {
      this._busy = false;
    }
  }

  private _openSharedWizard() {
    this._sharedName = "";
    this._wizard = "shared";
  }

  private _closeWizard() {
    this._wizard = null;
  }

  private async _confirmShared() {
    const name = this._sharedName.trim();
    if (!name) return;
    this._busy = true;
    try {
      await this.api.createSharedTracker(name);
      this._closeWizard();
      this._notifyTrackersChanged();
    } catch (err) {
      console.error("Failed to create shared tracker:", err);
      window.alert(`Failed: ${(err as Error).message ?? err}`);
    } finally {
      this._busy = false;
    }
  }

  private _notifyTrackersChanged() {
    this.dispatchEvent(
      new CustomEvent("sleep-tracker-trackers-update", {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      <div class="empty-state">
        <ha-icon icon="mdi:sleep" style="--mdc-icon-size: 64px; opacity: 0.5"></ha-icon>
        <h2>Sleep Tracking</h2>
        <p>Track your sleep patterns with event-based phase reconstruction.</p>
        <button class="enable-btn" ?disabled=${this._busy} @click=${this._enablePersonal}>
          Enable for me
        </button>
        <button class="secondary-btn" ?disabled=${this._busy} @click=${this._openSharedWizard}>
          <ha-icon icon="mdi:account-multiple"></ha-icon>
          Add a shared tracker (e.g. baby)
        </button>
        <p class="hint-line">
          Shared trackers are visible and controllable by anyone signed in.
        </p>
      </div>
      ${this._wizard === "shared" ? this._renderSharedWizard() : nothing}
    `;
  }

  private _renderSharedWizard() {
    return html`
      <div class="wizard-overlay" @click=${this._closeWizard}>
        <ha-card class="wizard-card" @click=${(e: Event) => e.stopPropagation()}>
          <div class="wizard-header">Add shared tracker</div>
          <p class="hint-line">
            For someone who isn't a Home Assistant user (e.g. a baby).
          </p>
          <div class="wizard-form">
            <div class="field">
              <label>Name</label>
              <input
                type="text"
                placeholder="e.g. Baby"
                .value=${this._sharedName}
                @input=${(e: Event) => {
                  this._sharedName = (e.target as HTMLInputElement).value;
                }}
              />
            </div>
            <button
              class="enable-btn"
              ?disabled=${!this._sharedName.trim() || this._busy}
              @click=${this._confirmShared}
            >Create</button>
          </div>
        </ha-card>
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
      .enable-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .secondary-btn {
        margin-top: var(--ha-space-3, 12px);
        padding: var(--ha-space-2, 8px) var(--ha-space-5, 20px);
        background: var(--secondary-background-color, #f5f5f5);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
        font-family: inherit;
        display: inline-flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
      }
      .secondary-btn:hover {
        background: var(--divider-color, #e0e0e0);
      }
      .secondary-btn ha-icon {
        --mdc-icon-size: 18px;
      }
      .hint-line {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        margin-top: var(--ha-space-2, 8px);
        max-width: 320px;
        text-align: center;
      }
      .wizard-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
        padding: var(--ha-space-4, 16px);
      }
      .wizard-card {
        width: 100%;
        max-width: 400px;
        padding: var(--ha-space-6, 24px);
      }
      .wizard-header {
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
        margin-bottom: var(--ha-space-2, 8px);
      }
      .wizard-form {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-4, 16px);
        margin-top: var(--ha-space-4, 16px);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-1, 4px);
      }
      .field label {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .field input {
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        font-family: inherit;
        background: var(--card-background-color, white);
        color: var(--primary-text-color);
      }
    `,
  ];
}
