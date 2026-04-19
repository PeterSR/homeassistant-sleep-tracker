import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tokens } from "../styles";

/**
 * Single-tag selector: pick from existing tags or type a new one.
 * Fires `tag-changed` with detail.value = picked/typed tag (or "").
 */
@customElement("sleep-tracker-tag-picker")
export class TagPicker extends LitElement {
  @property({ type: Array }) availableTags: string[] = [];
  @property() value = "";

  private _select(tag: string) {
    const next = this.value === tag ? "" : tag;
    this._emit(next);
  }

  private _onNewInput(e: Event) {
    this._emit((e.target as HTMLInputElement).value);
  }

  private _emit(value: string) {
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("tag-changed", {
        detail: { value },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const isExisting = this.availableTags.includes(this.value);
    const newTagValue = isExisting ? "" : this.value;
    return html`
      ${this.availableTags.length > 0
        ? html`
            <div class="tag-chip-row">
              ${this.availableTags.map(
                (tag) => html`
                  <button
                    class="tag-chip ${this.value === tag ? "active" : ""}"
                    @click=${() => this._select(tag)}
                  >${tag}</button>
                `
              )}
            </div>
          `
        : nothing}
      <input
        type="text"
        class="new-tag-input"
        placeholder=${this.availableTags.length > 0
          ? "or create a new tag..."
          : "new tag..."}
        .value=${newTagValue}
        @input=${this._onNewInput}
      />
    `;
  }

  static styles = [
    tokens,
    css`
      .tag-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ha-space-2, 8px);
        margin-bottom: var(--ha-space-2, 8px);
      }
      .tag-chip {
        padding: var(--ha-space-1, 4px) var(--ha-space-3, 12px);
        border-radius: 16px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, white);
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s;
      }
      .tag-chip:hover {
        border-color: var(--primary-color, #03a9f4);
      }
      .tag-chip.active {
        background: var(--primary-color, #03a9f4);
        border-color: var(--primary-color, #03a9f4);
        color: white;
      }
      .new-tag-input {
        width: 100%;
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        font-family: inherit;
        background: var(--card-background-color, white);
        color: var(--primary-text-color);
        box-sizing: border-box;
        outline: none;
      }
      .new-tag-input:focus {
        border-color: var(--primary-color, #03a9f4);
      }
    `,
  ];
}
