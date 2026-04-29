import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, SleepSession, UserConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens } from "../styles";

@customElement("sleep-tracker-session-meta")
export class SessionMeta extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) session!: SleepSession;
  @property({ attribute: false }) config!: UserConfig;
  @property({ type: Boolean }) readonly = false;

  @state() private _noteValue = "";
  @state() private _newTag = "";
  @state() private _busy = false;

  private get _locked(): boolean {
    return this.readonly || this.session?.status === "finalized";
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has("session")) {
      this._noteValue = this.session?.note || "";
    }
  }

  private _dispatchUpdated(session: SleepSession) {
    this.dispatchEvent(
      new CustomEvent("session-updated", {
        bubbles: true,
        composed: true,
        detail: { session },
      })
    );
  }

  private async _saveNote() {
    if (!this.session || this._busy || this._locked) return;
    const note = this._noteValue.trim() || null;
    if (note === (this.session.note || null)) return;
    this._busy = true;
    try {
      const session = await this.api.updateSessionMeta(
        this.session.session_id,
        { note }
      );
      this._dispatchUpdated(session);
    } catch (err) {
      console.error("Save note failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _setRating(field: "rating_quality" | "rating_feeling", value: number) {
    if (!this.session || this._busy || this._locked) return;
    const current = this.session[field];
    const newValue = current === value ? null : value;
    this._busy = true;
    try {
      const session = await this.api.updateSessionMeta(
        this.session.session_id,
        { [field]: newValue }
      );
      this._dispatchUpdated(session);
    } catch (err) {
      console.error("Save rating failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _toggleTag(tag: string) {
    if (!this.session || this._busy || this._locked) return;
    const current = this.session.tags || [];
    const tags = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    this._busy = true;
    try {
      const session = await this.api.updateSessionMeta(
        this.session.session_id,
        { tags }
      );
      this._dispatchUpdated(session);
    } catch (err) {
      console.error("Toggle tag failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private async _addNewTag() {
    const tag = this._newTag.trim().toLowerCase();
    if (!tag || !this.session || this._busy || this._locked) return;
    this._newTag = "";
    const current = this.session.tags || [];
    if (current.includes(tag)) return;
    const tags = [...current, tag];
    this._busy = true;
    try {
      const session = await this.api.updateSessionMeta(
        this.session.session_id,
        { tags }
      );
      this._dispatchUpdated(session);
    } catch (err) {
      console.error("Add tag failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private _hasAnyVisible(): boolean {
    const locked = this._locked;
    const s = this.session;
    const showQ = this.config.show_rating_quality && (!locked || s.rating_quality != null);
    const showF = this.config.show_rating_feeling && (!locked || s.rating_feeling != null);
    const showT = this.config.show_tags && (!locked || (s.tags?.length ?? 0) > 0);
    const showN = this.config.show_note && (!locked || !!s.note);
    return showQ || showF || showT || showN;
  }

  render() {
    if (!this.session || !this.config || !this._hasAnyVisible()) {
      return nothing;
    }

    const locked = this._locked;
    const s = this.session;

    return html`
      <div class="meta-section">
        ${this.config.show_rating_quality && (!locked || s.rating_quality != null)
          ? this._renderRating(
              "Sleep quality",
              "rating_quality",
              s.rating_quality
            )
          : nothing}
        ${this.config.show_rating_feeling && (!locked || s.rating_feeling != null)
          ? this._renderRating(
              "How do you feel?",
              "rating_feeling",
              s.rating_feeling
            )
          : nothing}
        ${this.config.show_tags && (!locked || (s.tags?.length ?? 0) > 0)
          ? this._renderTags()
          : nothing}
        ${this.config.show_note && (!locked || !!s.note)
          ? this._renderNote()
          : nothing}
      </div>
    `;
  }

  private _renderRating(
    label: string,
    field: "rating_quality" | "rating_feeling",
    value: number | null
  ) {
    return html`
      <div class="rating-row">
        <span class="rating-label">${label}</span>
        <div class="rating-buttons">
          ${[1, 2, 3, 4, 5].map(
            (n) => html`
              <button
                class="rating-btn ${value === n ? "active" : ""}"
                ?disabled=${this._busy || this._locked}
                @click=${() => this._setRating(field, n)}
                title="${n}"
              >
                ${n}
              </button>
            `
          )}
        </div>
      </div>
    `;
  }

  private _renderTags() {
    const sessionTags = this.session.tags || [];
    const available = this.config.available_tags || [];
    const locked = this._locked;
    // Show available tags + any session tags not in available.
    // When locked, show only the session's tags (read-only view).
    const allTags = locked
      ? sessionTags
      : [...new Set([...available, ...sessionTags])];

    return html`
      <div class="tags-section">
        <span class="tags-label">Tags</span>
        <div class="tags-row">
          ${allTags.map(
            (tag) => html`
              <button
                class="tag-chip ${sessionTags.includes(tag) ? "active" : ""}"
                ?disabled=${this._busy || locked}
                @click=${() => this._toggleTag(tag)}
              >
                ${tag}
              </button>
            `
          )}
          ${locked
            ? nothing
            : html`
                <div class="tag-input-wrapper">
                  <input
                    type="text"
                    class="tag-input"
                    placeholder="new tag..."
                    .value=${this._newTag}
                    @input=${(e: Event) => {
                      this._newTag = (e.target as HTMLInputElement).value;
                    }}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === "Enter") this._addNewTag();
                    }}
                    @blur=${this._addNewTag}
                  />
                </div>
              `}
        </div>
      </div>
    `;
  }

  private _renderNote() {
    return html`
      <div class="note-section">
        <textarea
          class="note-input"
          rows="2"
          placeholder="Add a note..."
          ?readonly=${this._locked}
          .value=${this._noteValue}
          @input=${(e: Event) => {
            this._noteValue = (e.target as HTMLTextAreaElement).value;
          }}
          @blur=${this._saveNote}
        ></textarea>
      </div>
    `;
  }

  static styles = [
    tokens,
    css`
      .meta-section {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-4, 16px);
        margin: var(--ha-space-4, 16px) 0;
      }

      /* Ratings */
      .rating-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--ha-space-3, 12px);
      }
      .rating-label {
        font-size: var(--ha-font-size-m, 14px);
        color: var(--secondary-text-color);
        white-space: nowrap;
      }
      .rating-buttons {
        display: flex;
        gap: var(--ha-space-2, 8px);
      }
      .rating-btn {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 2px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, white);
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .rating-btn:hover {
        border-color: var(--primary-color, #03a9f4);
        color: var(--primary-color, #03a9f4);
      }
      .rating-btn.active {
        background: var(--primary-color, #03a9f4);
        border-color: var(--primary-color, #03a9f4);
        color: white;
      }
      .rating-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .rating-btn.active:disabled {
        opacity: 1;
        cursor: default;
      }

      /* Tags */
      .tags-section {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-2, 8px);
      }
      .tags-label {
        font-size: var(--ha-font-size-m, 14px);
        color: var(--secondary-text-color);
      }
      .tags-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ha-space-2, 8px);
        align-items: center;
      }
      .tag-chip {
        padding: var(--ha-space-1, 4px) var(--ha-space-3, 12px);
        border-radius: 16px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, white);
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
        cursor: pointer;
        font-family: inherit;
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
      .tag-chip:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .tag-chip.active:disabled {
        opacity: 1;
        cursor: default;
      }
      .note-input[readonly] {
        background: transparent;
        border-style: dashed;
      }
      .tag-input-wrapper {
        display: inline-flex;
      }
      .tag-input {
        width: 90px;
        padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px);
        border: 1px dashed var(--divider-color, #e0e0e0);
        border-radius: 16px;
        font-size: var(--ha-font-size-s, 12px);
        font-family: inherit;
        background: transparent;
        color: var(--primary-text-color);
        outline: none;
      }
      .tag-input:focus {
        border-color: var(--primary-color, #03a9f4);
      }
      .tag-input::placeholder {
        color: var(--secondary-text-color);
      }

      /* Note */
      .note-section {
        display: flex;
      }
      .note-input {
        width: 100%;
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        font-size: var(--ha-font-size-m, 14px);
        font-family: inherit;
        background: var(--card-background-color, white);
        color: var(--primary-text-color);
        resize: vertical;
        outline: none;
        box-sizing: border-box;
      }
      .note-input:focus {
        border-color: var(--primary-color, #03a9f4);
      }
      .note-input::placeholder {
        color: var(--secondary-text-color);
      }
    `,
  ];
}
