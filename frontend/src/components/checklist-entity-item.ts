import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant } from "../types";
import { tokens } from "../styles";
import { checklistItemStyles } from "./checklist-item-styles";

@customElement("sleep-tracker-checklist-entity-item")
export class ChecklistEntityItem extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property() entityId = "";
  @property() desiredState: string | null = null;

  @state() private _manualChecked = false;

  private _showEntity() {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId: this.entityId },
      })
    );
  }

  private _toggleManual(e: Event) {
    e.stopPropagation();
    this._manualChecked = !this._manualChecked;
  }

  render() {
    const stateObj = this.entityId ? this.hass.states?.[this.entityId] : undefined;

    if (!stateObj) {
      return html`
        <div class="checklist-card unavailable">
          <input type="checkbox" class="check" disabled />
          <ha-icon icon="mdi:help-circle-outline"></ha-icon>
          <span class="tile-name">${this.entityId}</span>
          <span class="tile-state">Unavailable</span>
        </div>
      `;
    }

    const name = stateObj.attributes.friendly_name || this.entityId;
    const state = stateObj.state;
    const hasDesired = this.desiredState != null;
    const isOk = hasDesired && state === this.desiredState;
    const isWarn = hasDesired && state !== this.desiredState;
    const checked = hasDesired ? isOk : this._manualChecked;

    return html`
      <div
        class="checklist-card ${isOk ? "ok" : ""} ${isWarn ? "warn" : ""} ${!hasDesired && checked ? "checked" : ""}"
        @click=${this._showEntity}
      >
        <input
          type="checkbox"
          class="check"
          ?disabled=${hasDesired}
          .checked=${checked}
          @click=${hasDesired ? (e: Event) => e.stopPropagation() : this._toggleManual}
        />
        <state-badge .stateObj=${stateObj}></state-badge>
        <span class="tile-name">${name}</span>
        <span class="tile-state">${state}</span>
      </div>
    `;
  }

  static styles = [tokens, checklistItemStyles, css``];
}
