import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, formStyles, cardStyles } from "../styles";

@customElement("sleep-tracker-data-export-view")
export class DataExportView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
  @property({ type: Boolean }) narrow = false;

  @state() private _startDate = "";
  @state() private _endDate = "";
  @state() private _includeEnvironment = false;
  @state() private _exporting = false;
  @state() private _lastCount: number | null = null;
  @state() private _error: string | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.dispatchEvent(
      new CustomEvent<ToolbarConfig>("set-toolbar", {
        bubbles: true,
        composed: true,
        detail: { title: "Export data", backPath: "/settings" },
      })
    );
  }

  private async _export() {
    this._exporting = true;
    this._error = null;
    this._lastCount = null;
    try {
      const start = this._startDate ? `${this._startDate}T00:00:00` : null;
      const end = this._endDate ? `${this._endDate}T23:59:59` : null;
      const data = await this.api.exportData(
        start,
        end,
        this._includeEnvironment
      );
      this._lastCount = data.count;

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `sleep-tracker-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._exporting = false;
    }
  }

  render() {
    return html`
      <div class="container">
        <ha-card>
          <div class="card-header">Export sleep data</div>
          <p class="hint">
            Downloads every finalized or completed session as JSON. Leave both
            dates empty to export everything.
          </p>

          <div class="form">
            <div class="field">
              <label>Start date</label>
              <input
                type="date"
                .value=${this._startDate}
                @input=${(e: Event) => {
                  this._startDate = (e.target as HTMLInputElement).value;
                }}
              />
            </div>

            <div class="field">
              <label>End date</label>
              <input
                type="date"
                .value=${this._endDate}
                @input=${(e: Event) => {
                  this._endDate = (e.target as HTMLInputElement).value;
                }}
              />
            </div>

            <label class="checkbox-row">
              <input
                type="checkbox"
                .checked=${this._includeEnvironment}
                @change=${(e: Event) => {
                  this._includeEnvironment = (e.target as HTMLInputElement).checked;
                }}
              />
              <span>
                Include environment time series
                <span class="checkbox-hint">
                  Attaches recorder history of your configured environment
                  entities, scoped to each session window.
                </span>
              </span>
            </label>

            <button
              class="save-btn"
              ?disabled=${this._exporting}
              @click=${this._export}
            >
              ${this._exporting ? "Exporting..." : "Export JSON"}
            </button>

            ${this._lastCount !== null
              ? html`<p class="result">
                  Exported ${this._lastCount} session${this._lastCount === 1 ? "" : "s"}.
                </p>`
              : ""}
            ${this._error
              ? html`<p class="error">${this._error}</p>`
              : ""}
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
        margin-bottom: var(--ha-space-2, 8px);
      }
      .hint {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        margin: 0 0 var(--ha-space-4, 16px);
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
      .result {
        margin-top: var(--ha-space-2, 8px);
        font-size: var(--ha-font-size-s, 12px);
        color: var(--sleep-color-success, #009E73);
      }
      .error {
        margin-top: var(--ha-space-2, 8px);
        font-size: var(--ha-font-size-s, 12px);
        color: var(--sleep-color-awake, #D55E00);
      }
      .checkbox-row {
        display: flex;
        align-items: flex-start;
        gap: var(--ha-space-2, 8px);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
      }
      .checkbox-row input[type="checkbox"] {
        margin-top: 2px;
      }
      .checkbox-hint {
        display: block;
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        margin-top: 2px;
      }
    `,
  ];
}
