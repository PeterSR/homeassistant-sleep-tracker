import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tokens } from "../styles";
import { checklistItemStyles } from "./checklist-item-styles";

@customElement("sleep-tracker-checklist-text-item")
export class ChecklistTextItem extends LitElement {
  @property() text = "";

  @state() private _checked = false;

  private _toggle() {
    this._checked = !this._checked;
  }

  render() {
    return html`
      <div
        class="checklist-card text ${this._checked ? "checked" : ""}"
        @click=${this._toggle}
      >
        <input
          type="checkbox"
          class="check"
          .checked=${this._checked}
          @click=${(e: Event) => e.stopPropagation()}
          @change=${this._toggle}
        />
        <span class="tile-name">${this.text}</span>
      </div>
    `;
  }

  static styles = [tokens, checklistItemStyles, css``];
}
