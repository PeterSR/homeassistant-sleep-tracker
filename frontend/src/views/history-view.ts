import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, UserState, SleepSession, ToolbarConfig } from "../types";
import type { SleepTrackerApi } from "../api";
import { tokens, viewStyles, emptyStateStyles } from "../styles";

import "../components/session-card";

@customElement("sleep-tracker-history-view")
export class HistoryView extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @property({ attribute: false }) api!: SleepTrackerApi;
  @property({ attribute: false }) userState!: UserState;
  @property({ type: Boolean }) narrow = false;

  @state() private _sessions: SleepSession[] = [];
  @state() private _loading = true;
  @state() private _hasMore = true;

  connectedCallback(): void {
    super.connectedCallback();
    this._setToolbar();
    this._load();
  }

  private _setToolbar() {
    this.dispatchEvent(
      new CustomEvent<ToolbarConfig>("set-toolbar", {
        bubbles: true,
        composed: true,
        detail: { title: "Sleep History", backPath: "/" },
      })
    );
  }

  private async _load() {
    this._loading = true;
    try {
      const result = await this.api.getHistory(20, 0);
      this._sessions = result.sessions;
      this._hasMore = result.sessions.length === 20;
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadMore() {
    try {
      const result = await this.api.getHistory(20, this._sessions.length);
      this._sessions = [...this._sessions, ...result.sessions];
      this._hasMore = result.sessions.length === 20;
    } catch (err) {
      console.error("Failed to load more:", err);
    }
  }

  render() {
    if (this._loading) {
      return html`<div class="container"><p>Loading...</p></div>`;
    }

    if (!this._sessions.length) {
      return html`
        <div class="empty-state">
          <ha-icon icon="mdi:calendar-blank" style="--mdc-icon-size: 48px; opacity: 0.5"></ha-icon>
          <h2>No sleep sessions yet</h2>
          <p>Start your first sleep session from the main page.</p>
        </div>
      `;
    }

    return html`
      <div class="container">
        <div class="sessions-list">
          ${this._sessions.map(
            (s) => html`<sleep-tracker-session-card .session=${s}></sleep-tracker-session-card>`
          )}
        </div>
        ${this._hasMore
          ? html`
              <div class="load-more">
                <button class="load-more-btn" @click=${this._loadMore}>
                  Load more
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  static styles = [
    tokens,
    viewStyles,
    emptyStateStyles,
    css`
      .sessions-list {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-3, 12px);
      }
      .load-more {
        text-align: center;
        margin-top: var(--ha-space-4, 16px);
      }
      .load-more-btn {
        padding: var(--ha-space-2, 8px) var(--ha-space-6, 24px);
        background: var(--card-background-color, white);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        color: var(--primary-text-color);
        font-size: var(--ha-font-size-m, 14px);
        cursor: pointer;
        font-family: inherit;
      }
      .load-more-btn:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
    `,
  ];
}
