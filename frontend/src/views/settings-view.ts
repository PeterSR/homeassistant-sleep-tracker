import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, formStyles, cardStyles } from "../styles";

@customElement("settings-view")
export class SettingsView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
  @property({ type: Boolean }) narrow = false;

  @state() private _latency = 15;
  @state() private _exportUrl = "";
  @state() private _retentionDays = 90;
  @state() private _saving = false;
  @state() private _dirty = false;

  connectedCallback(): void {
    super.connectedCallback();
    this._setToolbar();
    this._loadFromState();
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has("userState") && !this._dirty) {
      this._loadFromState();
    }
  }

  private _loadFromState() {
    const config = this.userState?.config;
    if (config) {
      this._latency = config.fall_asleep_latency_minutes;
      this._exportUrl = config.export_url || "";
      this._retentionDays = config.retention_days;
    }
  }

  private _setToolbar() {
    this.dispatchEvent(
      new CustomEvent<ToolbarConfig>("set-toolbar", {
        bubbles: true,
        composed: true,
        detail: { title: "Settings", backPath: "/" },
      })
    );
  }

  private async _save() {
    this._saving = true;
    try {
      await this.api.updateSettings({
        fall_asleep_latency_minutes: this._latency,
        export_url: this._exportUrl || null,
        retention_days: this._retentionDays,
      });
      this._dirty = false;
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      this._saving = false;
    }
  }

  private _onLatencyChange(e: Event) {
    this._latency = parseInt((e.target as HTMLInputElement).value) || 15;
    this._dirty = true;
  }

  private _onExportUrlChange(e: Event) {
    this._exportUrl = (e.target as HTMLInputElement).value;
    this._dirty = true;
  }

  private _onRetentionChange(e: Event) {
    this._retentionDays = parseInt((e.target as HTMLInputElement).value) || 90;
    this._dirty = true;
  }

  render() {
    if (!this.userState?.config) return nothing;

    return html`
      <div class="container">
        <ha-card>
          <div class="card-header">Sleep Settings</div>
          <div class="form">
            <div class="field">
              <label>Fall-asleep latency (minutes)</label>
              <input
                type="range"
                min="0"
                max="60"
                step="5"
                .value=${String(this._latency)}
                @input=${this._onLatencyChange}
              />
              <span class="range-value">${this._latency} min</span>
            </div>

            <div class="field">
              <label>Data retention (days)</label>
              <input
                type="number"
                min="7"
                max="365"
                .value=${String(this._retentionDays)}
                @input=${this._onRetentionChange}
              />
            </div>

            <div class="field">
              <label>Export URL (REST endpoint)</label>
              <input
                type="url"
                placeholder="https://example.com/api/sleep"
                .value=${this._exportUrl}
                @input=${this._onExportUrlChange}
              />
            </div>

            <button
              class="save-btn"
              ?disabled=${!this._dirty || this._saving}
              @click=${this._save}
            >
              ${this._saving ? "Saving..." : "Save"}
            </button>
          </div>
        </ha-card>

        <ha-card class="info-card">
          <div class="card-header">Your User ID</div>
          <p class="user-id-hint">
            Use this ID in automations to send pulses via services:
          </p>
          <code class="user-id">${this.userState.config.user_id}</code>
        </ha-card>
      </div>
    `;
  }

  static styles = [
    tokens,
    viewStyles,
    formStyles,
    cardStyles,
    css`
      .card-header {
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
        margin-bottom: var(--ha-space-4, 16px);
      }
      .range-value {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        text-align: center;
      }
      .save-btn {
        padding: var(--ha-space-3, 12px);
        background: var(--primary-color, #03a9f4);
        color: white;
        border: none;
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        cursor: pointer;
        font-family: inherit;
      }
      .save-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .info-card {
        margin-top: var(--ha-space-4, 16px);
      }
      .user-id-hint {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        margin: 0 0 var(--ha-space-2, 8px);
      }
      .user-id {
        display: block;
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        background: var(--secondary-background-color, #f5f5f5);
        border-radius: var(--ha-border-radius-sm, 4px);
        font-size: var(--ha-font-size-m, 14px);
        word-break: break-all;
        user-select: all;
      }
    `,
  ];
}
