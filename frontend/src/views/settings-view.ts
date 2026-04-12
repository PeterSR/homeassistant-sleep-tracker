import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, ToolbarConfig, ChecklistItem } from "../types";
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
  @state() private _checklist: ChecklistItem[] = [];
  @state() private _wizardOpen = false;
  @state() private _wizardStep: "type" | "entity" | "text" = "type";
  @state() private _wizardEntityId = "";
  @state() private _wizardDesiredState = "";
  @state() private _wizardText = "";

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
      this._checklist = [...(config.checklist || [])];
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
        checklist: this._checklist,
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

  private _openWizard() {
    this._wizardStep = "type";
    this._wizardEntityId = "";
    this._wizardDesiredState = "";
    this._wizardText = "";
    this._wizardOpen = true;
  }

  private _closeWizard() {
    this._wizardOpen = false;
  }

  private async _saveChecklist() {
    await this.api.updateSettings({ checklist: this._checklist });
  }

  private async _wizardConfirm() {
    if (this._wizardStep === "entity" && this._wizardEntityId) {
      const item: ChecklistItem = {
        type: "entity",
        entity_id: this._wizardEntityId,
      };
      if (this._wizardDesiredState) {
        item.desired_state = this._wizardDesiredState;
      }
      this._checklist = [...this._checklist, item];
    } else if (this._wizardStep === "text" && this._wizardText) {
      this._checklist = [
        ...this._checklist,
        { type: "text", text: this._wizardText },
      ];
    }
    this._closeWizard();
    await this._saveChecklist();
  }

  private async _removeChecklistItem(index: number) {
    this._checklist = this._checklist.filter((_, i) => i !== index);
    await this._saveChecklist();
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
    return `alias: "Sleep Tracker - Phone awake event"
description: "Send an awake event when phone screen turns on during sleep"
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
  - action: sleep_tracker.event_awake
    data:
      user_id: "${uid}"
      source: phone_sensor`;
  }

  private _buttonAutomationYaml(): string {
    const uid = this.userState.config!.user_id;
    return `alias: "Sleep Tracker - Button awake event"
description: "Send an awake event when bedside button is pressed during sleep"
triggers:
  - trigger: state
    entity_id: YOUR_BUTTON_ENTITY
    to: "on"
conditions:
  - condition: state
    entity_id: binary_sensor.sleep_tracker_${this._slug}_sleeping
    state: "on"
actions:
  - action: sleep_tracker.event_awake
    data:
      user_id: "${uid}"
      source: button`;
  }

  private _serviceCallYaml(): string {
    const uid = this.userState.config!.user_id;
    return `action: sleep_tracker.event_awake
data:
  user_id: "${uid}"
  source: automation`;
  }

  private get _slug(): string {
    const name = this.userState.config?.display_name || "";
    return name.toLowerCase().replace(/\s+/g, "_");
  }

  private _renderWizard() {
    return html`
      <div class="wizard-overlay" @click=${this._closeWizard}>
        <ha-card class="wizard-card" @click=${(e: Event) => e.stopPropagation()}>
          ${this._wizardStep === "type"
            ? html`
                <div class="wizard-header">Add checklist item</div>
                <div class="wizard-type-buttons">
                  <button
                    class="wizard-type-btn"
                    @click=${() => { this._wizardStep = "entity"; }}
                  >
                    <ha-icon icon="mdi:chip"></ha-icon>
                    <span>Entity</span>
                    <span class="wizard-type-hint">Show an entity's state</span>
                  </button>
                  <button
                    class="wizard-type-btn"
                    @click=${() => { this._wizardStep = "text"; }}
                  >
                    <ha-icon icon="mdi:text"></ha-icon>
                    <span>Text</span>
                    <span class="wizard-type-hint">A reminder message</span>
                  </button>
                </div>
              `
            : this._wizardStep === "entity"
              ? html`
                  <div class="wizard-header">
                    <button class="wizard-back" @click=${() => { this._wizardStep = "type"; }}>
                      <ha-icon icon="mdi:arrow-left"></ha-icon>
                    </button>
                    Add entity
                  </div>
                  <div class="wizard-form">
                    <ha-form
                      .hass=${this.hass}
                      .schema=${[{ name: "entity_id", selector: { entity: {} } }]}
                      .data=${{ entity_id: this._wizardEntityId }}
                      .computeLabel=${() => "Entity"}
                      @value-changed=${(e: CustomEvent) => {
                        this._wizardEntityId = e.detail.value.entity_id || "";
                      }}
                    ></ha-form>
                    <div class="field">
                      <label>Desired state (optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. off, locked, silent"
                        .value=${this._wizardDesiredState}
                        @input=${(e: Event) => {
                          this._wizardDesiredState = (e.target as HTMLInputElement).value;
                        }}
                      />
                      <span class="range-value">Highlights red/green on the checklist when state doesn't/does match</span>
                    </div>
                    <button
                      class="save-btn"
                      ?disabled=${!this._wizardEntityId}
                      @click=${this._wizardConfirm}
                    >Add</button>
                  </div>
                `
              : html`
                  <div class="wizard-header">
                    <button class="wizard-back" @click=${() => { this._wizardStep = "type"; }}>
                      <ha-icon icon="mdi:arrow-left"></ha-icon>
                    </button>
                    Add text reminder
                  </div>
                  <div class="wizard-form">
                    <div class="field">
                      <label>Reminder text</label>
                      <input
                        type="text"
                        placeholder="e.g. Have you taken your medication?"
                        .value=${this._wizardText}
                        @input=${(e: Event) => {
                          this._wizardText = (e.target as HTMLInputElement).value;
                        }}
                      />
                    </div>
                    <button
                      class="save-btn"
                      ?disabled=${!this._wizardText}
                      @click=${this._wizardConfirm}
                    >Add</button>
                  </div>
                `}
        </ha-card>
      </div>
    `;
  }

  render() {
    if (!this.userState) {
      return html`<div class="container"><p>Loading...</p></div>`;
    }
    if (!this.userState.config) {
      return html`
        <div class="container">
          <ha-card>
            <div class="card-header">Sleep tracking not set up</div>
            <p class="hint">
              Go to the main page and click "Enable Sleep Tracking" to set up your account.
            </p>
          </ha-card>
        </div>
      `;
    }
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
          <div class="card-header">Pre-Sleep Checklist</div>
          <p class="hint">
            Items shown on the main screen before starting sleep.
          </p>

          ${this._checklist.length > 0
            ? html`
                <div class="checklist-list">
                  ${this._checklist.map(
                    (item, i) => html`
                      <div class="checklist-row">
                        <div class="checklist-row-info">
                          <ha-icon
                            icon=${item.type === "entity"
                              ? "mdi:chip"
                              : "mdi:text"}
                          ></ha-icon>
                          <div class="checklist-row-detail">
                            <span class="checklist-row-primary">
                              ${item.type === "entity"
                                ? item.entity_id
                                : item.text}
                            </span>
                            ${item.desired_state
                              ? html`<span class="checklist-row-secondary"
                                  >Desired: ${item.desired_state}</span
                                >`
                              : nothing}
                          </div>
                        </div>
                        <button
                          class="remove-btn"
                          @click=${() => this._removeChecklistItem(i)}
                        >
                          <ha-icon icon="mdi:close"></ha-icon>
                        </button>
                      </div>
                    `
                  )}
                </div>
              `
            : nothing}

          <button class="add-btn" @click=${this._openWizard}>
            <ha-icon icon="mdi:plus"></ha-icon> Add item
          </button>

          ${this._wizardOpen ? this._renderWizard() : nothing}
        </ha-card>

        <ha-card class="info-card">
          <div class="card-header">Your User ID</div>
          <p class="hint">
            Use this ID in automations to send events via services:
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
                <div class="example-title">Phone Screen Event</div>
                <p class="hint">Sends an awake event when your phone screen turns on during sleep.
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
                <div class="example-title">Bedside Button Event</div>
                <p class="hint">Sends an awake event when a bedside button/switch is pressed during sleep.
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
              <code>sleep_tracker.reopen_session</code>
              <span class="hint">Reopen a stopped (not finalized) session</span>
            </div>
            <div class="service-item">
              <code>sleep_tracker.event_awake</code>
              <span class="hint">Record an "awake" event (auto-demoted to still_awake when in awake state)</span>
            </div>
            <div class="service-item">
              <code>sleep_tracker.event_still_awake</code>
              <span class="hint">Record a "still awake" event (extends awake window)</span>
            </div>
            <div class="service-item">
              <code>sleep_tracker.event_fell_asleep</code>
              <span class="hint">Force an immediate awake-to-asleep transition (bypasses latency model)</span>
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
              <span class="hint">Timestamp of last event</span>
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
      .checklist-list {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-2, 8px);
        margin-bottom: var(--ha-space-4, 16px);
      }
      .checklist-row {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        background: var(--secondary-background-color, #f5f5f5);
        border-radius: var(--ha-border-radius-md, 8px);
      }
      .checklist-row-info {
        flex: 1;
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        min-width: 0;
      }
      .checklist-row-info ha-icon {
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }
      .checklist-row-detail {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .checklist-row-primary {
        font-size: var(--ha-font-size-s, 12px);
        font-family: "Roboto Mono", "SFMono-Regular", monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .checklist-row-secondary {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
      }
      .remove-btn {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--secondary-text-color);
        padding: var(--ha-space-1, 4px);
        border-radius: 50%;
        display: flex;
        flex-shrink: 0;
      }
      .remove-btn:hover {
        color: var(--sleep-color-awake, #ef5350);
        background: rgba(239, 83, 80, 0.1);
      }
      .remove-btn ha-icon {
        --mdc-icon-size: 18px;
      }
      .add-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--ha-space-1, 4px);
        width: 100%;
        padding: var(--ha-space-3, 12px);
        background: var(--card-background-color, white);
        border: 1px dashed var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
        font-family: inherit;
        color: var(--secondary-text-color);
      }
      .add-btn:hover {
        background: var(--secondary-background-color, #f5f5f5);
        color: var(--primary-text-color);
      }
      .add-btn ha-icon {
        --mdc-icon-size: 18px;
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
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
        margin-bottom: var(--ha-space-5, 20px);
      }
      .wizard-back {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--secondary-text-color);
        padding: var(--ha-space-1, 4px);
        border-radius: 50%;
        display: flex;
      }
      .wizard-back:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .wizard-type-buttons {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-3, 12px);
      }
      .wizard-type-btn {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        padding: var(--ha-space-4, 16px);
        background: var(--secondary-background-color, #f5f5f5);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        color: var(--primary-text-color);
        text-align: left;
        transition: border-color 0.15s;
      }
      .wizard-type-btn:hover {
        border-color: var(--primary-color, #03a9f4);
      }
      .wizard-type-btn ha-icon {
        --mdc-icon-size: 24px;
        color: var(--secondary-text-color);
      }
      .wizard-type-hint {
        font-size: var(--ha-font-size-s, 12px);
        font-weight: normal;
        color: var(--secondary-text-color);
        margin-left: auto;
      }
      .wizard-form {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-4, 16px);
      }
    `,
  ];
}
