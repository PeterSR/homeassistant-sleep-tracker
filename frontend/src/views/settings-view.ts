import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, formStyles, cardStyles } from "../styles";

@customElement("sleep-tracker-settings-view")
export class SettingsView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
  @property({ type: Boolean }) narrow = false;

  @state() private _onset = 30;
  @state() private _latency = 15;
  @state() private _autoFinalize = 12;
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
      this._onset = config.sleep_onset_minutes;
      this._latency = config.fall_asleep_latency_minutes;
      this._autoFinalize = config.auto_finalize_hours;
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
        sleep_onset_minutes: this._onset,
        fall_asleep_latency_minutes: this._latency,
        auto_finalize_hours: this._autoFinalize,
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

  private _onOnsetChange(e: Event) {
    this._onset = parseInt((e.target as HTMLInputElement).value) || 30;
    this._dirty = true;
  }

  private _onLatencyChange(e: Event) {
    this._latency = parseInt((e.target as HTMLInputElement).value) || 15;
    this._dirty = true;
  }

  private _onAutoFinalizeChange(e: Event) {
    this._autoFinalize = parseInt((e.target as HTMLInputElement).value) || 12;
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

  @state() private _copied: string | null = null;

  private _showEntity(entityId: string) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      })
    );
  }

  private _copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      this._copied = label;
      setTimeout(() => { this._copied = null; }, 2000);
    });
  }

  private _phoneAutomationYaml(): string {
    const uid = this.userState.config!.user_id;
    return `alias: "Sleep Tracker - Phone awake pulse"
description: "Send an awake pulse when phone screen turns on during sleep"
triggers:
  - trigger: state
    entity_id: binary_sensor.YOUR_PHONE_interactive
    to: "on"
    for:
      seconds: 1
conditions:
  - condition: state
    entity_id: binary_sensor.sleep_tracker_${this._slug}_sleeping
    state: "on"
actions:
  - action: sleep_tracker.pulse_awake
    data:
      user_id: "${uid}"
      source: phone_sensor`;
  }

  private _buttonAutomationYaml(): string {
    const uid = this.userState.config!.user_id;
    return `alias: "Sleep Tracker - Button awake pulse"
description: "Send an awake pulse when bedside button is pressed during sleep"
triggers:
  - trigger: state
    entity_id: YOUR_BUTTON_ENTITY
    to: "on"
conditions:
  - condition: state
    entity_id: binary_sensor.sleep_tracker_${this._slug}_sleeping
    state: "on"
actions:
  - action: sleep_tracker.pulse_awake
    data:
      user_id: "${uid}"
      source: button`;
  }

  private _serviceCallYaml(): string {
    const uid = this.userState.config!.user_id;
    return `action: sleep_tracker.pulse_awake
data:
  user_id: "${uid}"
  source: automation`;
  }

  private get _slug(): string {
    const name = this.userState.config?.display_name || "";
    return name.toLowerCase().replace(/\s+/g, "_");
  }

  render() {
    if (!this.userState?.config) return nothing;
    const uid = this.userState.config.user_id;

    return html`
      <div class="container">
        <ha-card>
          <div class="card-header">Sleep Settings</div>
          <div class="form">
            <div class="field">
              <label>Sleep onset (minutes)</label>
              <input
                type="range"
                min="0"
                max="120"
                step="5"
                .value=${String(this._onset)}
                @input=${this._onOnsetChange}
              />
              <span class="range-value">${this._onset} min — minimum settling period before falling asleep (pulses extend the timer but don't count as awakenings)</span>
            </div>

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
              <span class="range-value">${this._latency} min — assumed time to fall back asleep after a pulse</span>
            </div>

            <div class="field">
              <label>Auto-finalize after (hours)</label>
              <input
                type="range"
                min="1"
                max="48"
                step="1"
                .value=${String(this._autoFinalize)}
                @input=${this._onAutoFinalizeChange}
              />
              <span class="range-value">${this._autoFinalize}h — unfinalized sessions are auto-finalized when you start the next sleep</span>
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
          <p class="hint">
            Use this ID in automations to send pulses via services:
          </p>
          <div class="code-block">
            <code>${uid}</code>
            <button
              class="copy-btn"
              @click=${() => this._copy(uid, "uid")}
            >${this._copied === "uid" ? "Copied!" : "Copy"}</button>
          </div>
        </ha-card>

        <ha-card class="info-card">
          <div class="card-header">Automation Examples</div>

          <div class="example">
            <div class="example-header">
              <div>
                <div class="example-title">Service Call</div>
                <p class="hint">Use in any automation action or Developer Tools:</p>
              </div>
              <button
                class="copy-btn"
                @click=${() => this._copy(this._serviceCallYaml(), "svc")}
              >${this._copied === "svc" ? "Copied!" : "Copy"}</button>
            </div>
            <pre class="yaml">${this._serviceCallYaml()}</pre>
          </div>

          <hr class="divider" />

          <div class="example">
            <div class="example-header">
              <div>
                <div class="example-title">Phone Screen Pulse</div>
                <p class="hint">Sends an awake pulse when your phone screen turns on during sleep.
                  Replace <code>YOUR_PHONE_interactive</code> with your phone's interactive sensor.</p>
              </div>
              <button
                class="copy-btn"
                @click=${() => this._copy(this._phoneAutomationYaml(), "phone")}
              >${this._copied === "phone" ? "Copied!" : "Copy"}</button>
            </div>
            <pre class="yaml">${this._phoneAutomationYaml()}</pre>
          </div>

          <hr class="divider" />

          <div class="example">
            <div class="example-header">
              <div>
                <div class="example-title">Bedside Button Pulse</div>
                <p class="hint">Sends an awake pulse when a bedside button/switch is pressed during sleep.
                  Replace <code>YOUR_BUTTON_ENTITY</code> with your button entity.</p>
              </div>
              <button
                class="copy-btn"
                @click=${() => this._copy(this._buttonAutomationYaml(), "btn")}
              >${this._copied === "btn" ? "Copied!" : "Copy"}</button>
            </div>
            <pre class="yaml">${this._buttonAutomationYaml()}</pre>
          </div>
        </ha-card>

        <ha-card class="info-card">
          <div class="card-header">Available Services</div>
          <div class="services-list">
            <div class="service-item">
              <code>sleep_tracker.start_sleep</code>
              <span class="hint">Begin a sleep session</span>
            </div>
            <div class="service-item">
              <code>sleep_tracker.stop_sleep</code>
              <span class="hint">End the active sleep session</span>
            </div>
            <div class="service-item">
              <code>sleep_tracker.pulse_awake</code>
              <span class="hint">Record a momentary wakeup</span>
            </div>
            <div class="service-item">
              <code>sleep_tracker.pulse_still_awake</code>
              <span class="hint">Confirm still awake (extends awake window)</span>
            </div>
            <div class="service-item">
              <code>sleep_tracker.export_session</code>
              <span class="hint">Export a completed session to REST</span>
            </div>
          </div>
        </ha-card>

        <ha-card class="info-card">
          <div class="card-header">Available Entities</div>
          <div class="services-list">
            <div
              class="service-item clickable"
              @click=${() => this._showEntity(`binary_sensor.sleep_tracker_${this._slug}_sleeping`)}
            >
              <code>binary_sensor.sleep_tracker_${this._slug}_sleeping</code>
              <span class="hint">On when sleeping — use as condition in automations</span>
            </div>
            <div
              class="service-item clickable"
              @click=${() => this._showEntity(`sensor.sleep_tracker_${this._slug}_last_awake`)}
            >
              <code>sensor.sleep_tracker_${this._slug}_last_awake</code>
              <span class="hint">Timestamp of last awake pulse</span>
            </div>
            <div
              class="service-item clickable"
              @click=${() => this._showEntity(`sensor.sleep_tracker_${this._slug}_sleep_duration`)}
            >
              <code>sensor.sleep_tracker_${this._slug}_sleep_duration</code>
              <span class="hint">Total sleep minutes (last completed session)</span>
            </div>
            <div
              class="service-item clickable"
              @click=${() => this._showEntity(`sensor.sleep_tracker_${this._slug}_awake_count`)}
            >
              <code>sensor.sleep_tracker_${this._slug}_awake_count</code>
              <span class="hint">Number of awakenings</span>
            </div>
          </div>
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
      .hint {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        margin: 0 0 var(--ha-space-2, 8px);
      }
      .hint code {
        background: var(--secondary-background-color, #f5f5f5);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: var(--ha-font-size-s, 12px);
      }
      .code-block {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
      }
      .code-block code {
        flex: 1;
        display: block;
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        background: var(--secondary-background-color, #f5f5f5);
        border-radius: var(--ha-border-radius-sm, 4px);
        font-size: var(--ha-font-size-m, 14px);
        word-break: break-all;
        user-select: all;
      }
      .copy-btn {
        padding: var(--ha-space-1, 4px) var(--ha-space-3, 12px);
        background: var(--card-background-color, white);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-sm, 4px);
        font-size: var(--ha-font-size-s, 12px);
        cursor: pointer;
        font-family: inherit;
        white-space: nowrap;
        color: var(--primary-text-color);
      }
      .copy-btn:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .example {
        margin-bottom: var(--ha-space-2, 8px);
      }
      .example-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--ha-space-2, 8px);
      }
      .example-title {
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        margin-bottom: var(--ha-space-1, 4px);
      }
      .yaml {
        padding: var(--ha-space-3, 12px);
        background: var(--secondary-background-color, #f5f5f5);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-s, 12px);
        line-height: 1.5;
        overflow-x: auto;
        white-space: pre;
        margin: var(--ha-space-2, 8px) 0 0;
        font-family: "Roboto Mono", "SFMono-Regular", monospace;
      }
      .divider {
        border: none;
        border-top: 1px solid var(--divider-color, #e0e0e0);
        margin: var(--ha-space-4, 16px) 0;
      }
      .services-list {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-3, 12px);
      }
      .service-item {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-1, 4px);
      }
      .service-item code {
        font-size: var(--ha-font-size-s, 12px);
        font-family: "Roboto Mono", "SFMono-Regular", monospace;
        color: var(--primary-color, #03a9f4);
      }
      .service-item .hint {
        margin: 0;
      }
      .service-item.clickable {
        cursor: pointer;
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        border-radius: var(--ha-border-radius-md, 8px);
        transition: background 0.15s;
      }
      .service-item.clickable:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
    `,
  ];
}
