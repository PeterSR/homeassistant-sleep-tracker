import { LitElement, html, css, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, PanelInfo, Route, UserState, ToolbarConfig } from "./types";
import { SleepTrackerApi } from "./api";
import { tokens } from "./styles";

import "./views/main-view";
import "./views/history-view";
import "./views/night-detail-view";
import "./views/settings-view";
import "./views/stats-view";

@customElement("sleep-tracker-panel")
export class SleepTrackerPanel extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Boolean, reflect: true }) public narrow = false;
  @property({ attribute: false }) public route!: Route;
  @property({ attribute: false }) public panel!: PanelInfo;

  @state() private _path = "";
  @state() private _userState: UserState | null = null;
  @state() private _toolbar: ToolbarConfig = { title: "Sleep Tracker" };
  @state() private _haReady = false;

  private _api!: SleepTrackerApi;
  private _unsub?: () => void;
  private _lastConnection?: any;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this._onPopState);
    this._lastConnection = undefined;
    if (customElements.get("ha-card")) {
      this._haReady = true;
    } else {
      customElements.whenDefined("ha-card").then(() => {
        this._haReady = true;
      });
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this._onPopState);
    this._unsubscribe();
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has("hass") && this.hass) {
      this._api = new SleepTrackerApi(this.hass);
      if (this._lastConnection !== this.hass.connection) {
        this._lastConnection = this.hass.connection;
        this._subscribe();
      }
    }
    if (changed.has("route") && this.route) {
      this._path = this.route.path || "/";
    }
  }

  private async _subscribe(): Promise<void> {
    this._unsubscribe();
    try {
      this._unsub = await this._api.subscribe((state) => {
        this._userState = state;
      });
    } catch (e) {
      console.error("Failed to subscribe to Sleep Tracker state:", e);
    }
  }

  private _unsubscribe(): void {
    if (this._unsub) {
      this._unsub();
      this._unsub = undefined;
    }
  }

  private _onPopState = (): void => {
    this._path = this.route?.path || "/";
    this.requestUpdate();
  };

  private _toggleMenu(): void {
    this.dispatchEvent(
      new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })
    );
  }

  public navigate(path: string): void {
    const fullPath = `/sleep-tracker${path === "/" ? "" : path}`;
    history.pushState(null, "", fullPath);
    this._path = path;
  }

  private _onSetToolbar = (e: CustomEvent<ToolbarConfig>): void => {
    this._toolbar = e.detail;
  };

  private _onNavigate = (e: CustomEvent<{ path: string }>): void => {
    this.navigate(e.detail.path);
  };

  render() {
    if (!this._haReady) {
      return html`<div class="loading">Loading...</div>`;
    }
    const tb = this._toolbar;

    return html`
      <div class="toolbar">
        ${this.narrow && !tb.backPath
          ? html`
              <ha-icon-button
                .label=${"Menu"}
                @click=${this._toggleMenu}
              >
                <ha-icon icon="mdi:menu"></ha-icon>
              </ha-icon-button>
            `
          : nothing}
        ${tb.backPath
          ? html`
              <ha-icon-button
                .label=${"Back"}
                @click=${() => this.navigate(tb.backPath!)}
              >
                <ha-icon icon="mdi:arrow-left"></ha-icon>
              </ha-icon-button>
            `
          : nothing}
        <div class="toolbar-title">${tb.title}</div>
        <div class="toolbar-actions">
          ${tb.actions ? (tb.actions as TemplateResult) : nothing}
        </div>
      </div>
      <div class="content">
        ${this._renderContent()}
      </div>
    `;
  }

  private _renderContent() {
    if (!this._userState) {
      return html`<div class="loading">Loading...</div>`;
    }

    const nightMatch = this._path.match(/^\/night\/(.+)$/);

    if (nightMatch) {
      const sessionId = decodeURIComponent(nightMatch[1]);
      return html`
        <night-detail-view
          .hass=${this.hass}
          .api=${this._api}
          .userState=${this._userState}
          .sessionId=${sessionId}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></night-detail-view>
      `;
    }

    if (this._path === "/stats") {
      return html`
        <stats-view
          .hass=${this.hass}
          .api=${this._api}
          .userState=${this._userState}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></stats-view>
      `;
    }

    if (this._path === "/history") {
      return html`
        <history-view
          .hass=${this.hass}
          .api=${this._api}
          .userState=${this._userState}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></history-view>
      `;
    }

    if (this._path === "/settings") {
      return html`
        <settings-view
          .hass=${this.hass}
          .api=${this._api}
          .userState=${this._userState}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></settings-view>
      `;
    }

    return html`
      <main-view
        .hass=${this.hass}
        .api=${this._api}
        .userState=${this._userState}
        .narrow=${this.narrow}
        @navigate=${this._onNavigate}
        @set-toolbar=${this._onSetToolbar}
      ></main-view>
    `;
  }

  static styles = [
    tokens,
    css`
      :host {
        display: block;
        height: 100%;
        --toolbar-height: var(--header-height, 56px);
      }
      .toolbar {
        display: flex;
        align-items: center;
        height: var(--toolbar-height);
        padding: 0 var(--ha-space-4, 16px);
        background: var(
          --app-header-background-color,
          var(--primary-background-color, white)
        );
        color: var(--app-header-text-color, var(--primary-text-color));
        box-sizing: border-box;
        border-bottom: var(
          --app-header-border-bottom,
          1px solid var(--divider-color)
        );
        --mdc-icon-button-size: 48px;
      }
      .toolbar ha-icon-button {
        color: var(--app-header-text-color, var(--primary-text-color));
      }
      .toolbar-title {
        font-size: var(--ha-font-size-xl, 20px);
        font-weight: var(--ha-font-weight-normal, 400);
        margin: 0 0 0 var(--ha-space-3, 12px);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .toolbar-actions {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        flex-shrink: 0;
      }
      .content {
        height: calc(100% - var(--toolbar-height));
        overflow: auto;
        overscroll-behavior: none;
      }
      .loading {
        padding: var(--ha-space-4, 16px);
      }
    `,
  ];
}
