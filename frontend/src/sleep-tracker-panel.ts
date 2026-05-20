import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  PanelInfo,
  Route,
  TrackerConfig,
  TrackerState,
  ToolbarConfig,
  UserPreferences,
} from "./types";
import { SleepTrackerApi } from "./api";
import { tokens } from "./styles";

import "./views/main-view";
import "./views/history-view";
import "./views/night-detail-view";
import "./views/event-review-view";
import "./views/settings-view";
import "./views/stats-view";
import "./views/data-export-view";

const STORAGE_KEY = "sleep-tracker:selected-tracker";

@customElement("sleep-tracker-panel")
export class SleepTrackerPanel extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Boolean, reflect: true }) public narrow = false;
  @property({ attribute: false }) public route!: Route;
  @property({ attribute: false }) public panel!: PanelInfo;

  @state() private _path = "";
  @state() private _trackerState: TrackerState | null = null;
  @state() private _trackers: TrackerConfig[] = [];
  @state() private _selectedTrackerId: string | null = null;
  @state() private _toolbar: ToolbarConfig = { title: "Sleep Tracker" };
  @state() private _haReady = false;
  @state() private _switcherOpen = false;
  @state() private _userPrefs: UserPreferences | null = null;

  private _api!: SleepTrackerApi;
  private _unsub?: () => void;
  private _lastConnection?: HomeAssistant["connection"];

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this._onPopState);
    this.addEventListener("sleep-tracker-state-update", this._refreshState as EventListener);
    this.addEventListener("sleep-tracker-trackers-update", this._refreshTrackers as EventListener);
    this.addEventListener("sleep-tracker-prefs-update", this._refreshPrefs as EventListener);
    this.addEventListener("sleep-tracker-select-tracker", this._onSelectTrackerEvent as EventListener);
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
    this.removeEventListener("sleep-tracker-state-update", this._refreshState as EventListener);
    this.removeEventListener("sleep-tracker-trackers-update", this._refreshTrackers as EventListener);
    this.removeEventListener("sleep-tracker-prefs-update", this._refreshPrefs as EventListener);
    this.removeEventListener("sleep-tracker-select-tracker", this._onSelectTrackerEvent as EventListener);
    this._unsubscribe();
  }

  private _refreshState = async (): Promise<void> => {
    if (!this._api) return;
    try {
      this._trackerState = await this._api.getState();
    } catch (e) {
      console.error("Failed to refresh state:", e);
    }
  };

  private _refreshTrackers = async (): Promise<void> => {
    await this._loadTrackers();
  };

  private _refreshPrefs = async (): Promise<void> => {
    await this._loadUserPrefs();
  };

  private _onSelectTrackerEvent = (e: CustomEvent<{ trackerId: string }>): void => {
    const id = e.detail?.trackerId;
    if (id) this._selectTracker(id);
  };

  willUpdate(changed: PropertyValues): void {
    if (changed.has("hass") && this.hass) {
      const isNewConnection = this._lastConnection !== this.hass.connection;
      if (!this._api) {
        this._api = new SleepTrackerApi(this.hass);
      }
      if (isNewConnection) {
        this._lastConnection = this.hass.connection;
        this._initialize();
      }
    }
    if (changed.has("route") && this.route) {
      this._path = this.route.path || "/";
    }
  }

  private async _initialize(): Promise<void> {
    await Promise.all([this._loadTrackers(), this._loadUserPrefs()]);
    this._subscribe();
  }

  private async _loadUserPrefs(): Promise<void> {
    try {
      this._userPrefs = await this._api.getUserPreferences();
    } catch (e) {
      console.error("Failed to load user preferences:", e);
    }
  }

  private async _loadTrackers(): Promise<void> {
    try {
      const result = await this._api.listTrackers();
      this._trackers = result.trackers;
      this._resolveSelection();
    } catch (e) {
      console.error("Failed to load trackers:", e);
    }
  }

  private _resolveSelection(): void {
    const stored = localStorage.getItem(STORAGE_KEY);
    const haUserId = this.hass?.user?.id;

    let next: string | null = null;
    if (stored && this._trackers.some((t) => t.tracker_id === stored)) {
      next = stored;
    } else {
      // Prefer personal (own user-kind), then first shared.
      const personal = this._trackers.find(
        (t) => t.kind === "user" && t.tracker_id === haUserId,
      );
      if (personal) {
        next = personal.tracker_id;
      } else {
        const firstShared = this._trackers.find((t) => t.kind === "shared");
        if (firstShared) next = firstShared.tracker_id;
      }
    }

    if (next !== this._selectedTrackerId) {
      this._selectedTrackerId = next;
      this._api.setTrackerId(next);
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
      // Re-subscribe with new tracker_id
      this._subscribe();
    }
  }

  private async _selectTracker(trackerId: string): Promise<void> {
    if (trackerId === this._selectedTrackerId) {
      this._switcherOpen = false;
      return;
    }
    this._selectedTrackerId = trackerId;
    this._api.setTrackerId(trackerId);
    localStorage.setItem(STORAGE_KEY, trackerId);
    this._switcherOpen = false;
    this._trackerState = null;
    this._subscribe();
    // Navigate back to main to avoid showing data from the previous tracker,
    // except on Settings (where the user is switching to view another tracker's config).
    if (this._path !== "/settings") {
      this.navigate("/");
    }
  }

  private async _subscribe(): Promise<void> {
    this._unsubscribe();
    if (!this._api) return;
    try {
      this._unsub = await this._api.subscribe((state) => {
        this._trackerState = state;
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

  private _toggleSwitcher = (e: Event): void => {
    e.stopPropagation();
    this._switcherOpen = !this._switcherOpen;
  };

  private _closeSwitcher = (): void => {
    this._switcherOpen = false;
  };

  private async _createSharedFromSwitcher(): Promise<void> {
    this._switcherOpen = false;
    const name = window.prompt("Name for the shared tracker (e.g. Baby)?")?.trim();
    if (!name) return;
    try {
      const config = await this._api.createSharedTracker(name);
      await this._loadTrackers();
      // Auto-select the new tracker
      await this._selectTracker(config.tracker_id);
    } catch (e) {
      console.error("Failed to create shared tracker:", e);
      window.alert(`Failed to create shared tracker: ${(e as Error).message ?? e}`);
    }
  }

  private async _setupPersonalFromSwitcher(): Promise<void> {
    this._switcherOpen = false;
    try {
      const config = await this._api.setupTracker(this.hass.user?.name);
      await this._loadTrackers();
      await this._selectTracker(config.tracker_id);
    } catch (e) {
      console.error("Failed to set up personal tracker:", e);
      window.alert(`Failed: ${(e as Error).message ?? e}`);
    }
  }

  private _selectedTrackerName(): string {
    const t = this._trackers.find((x) => x.tracker_id === this._selectedTrackerId);
    return t?.display_name || "Sleep Tracker";
  }

  private _renderSwitcher() {
    const visibility =
      this._userPrefs?.tracker_switcher_visibility ?? "multiple";
    if (visibility === "never") return nothing;
    if (visibility === "multiple" && this._trackers.length <= 1) return nothing;
    const haUserId = this.hass?.user?.id;
    return html`
      <div class="switcher" @click=${(e: Event) => e.stopPropagation()}>
        <button class="switcher-btn" @click=${this._toggleSwitcher}>
          <span class="switcher-name">${this._selectedTrackerName()}</span>
          <ha-icon icon=${this._switcherOpen ? "mdi:menu-up" : "mdi:menu-down"}></ha-icon>
        </button>
        ${this._switcherOpen
          ? html`
              <div class="switcher-menu">
                ${this._trackers.map((t) => {
                  const isSelf = t.kind === "user" && t.tracker_id === haUserId;
                  const active = t.tracker_id === this._selectedTrackerId;
                  return html`
                    <button
                      class=${active ? "switcher-item active" : "switcher-item"}
                      @click=${() => this._selectTracker(t.tracker_id)}
                    >
                      <ha-icon icon=${t.kind === "shared" ? "mdi:account-multiple" : "mdi:account"}></ha-icon>
                      <span class="switcher-item-name">${t.display_name}</span>
                      ${isSelf
                        ? html`<span class="switcher-item-tag">you</span>`
                        : t.kind === "shared"
                          ? html`<span class="switcher-item-tag shared">shared</span>`
                          : nothing}
                      ${active ? html`<ha-icon icon="mdi:check"></ha-icon>` : nothing}
                    </button>
                  `;
                })}
                <div class="switcher-divider"></div>
                ${!this._trackers.some(
                  (t) => t.kind === "user" && t.tracker_id === haUserId,
                )
                  ? html`
                      <button class="switcher-item add" @click=${this._setupPersonalFromSwitcher}>
                        <ha-icon icon="mdi:account-plus"></ha-icon>
                        <span class="switcher-item-name">Set up personal tracker</span>
                      </button>
                    `
                  : nothing}
                <button class="switcher-item add" @click=${this._createSharedFromSwitcher}>
                  <ha-icon icon="mdi:plus"></ha-icon>
                  <span class="switcher-item-name">Add shared tracker</span>
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  render() {
    if (!this._haReady) {
      return html`<div class="loading">Loading...</div>`;
    }
    const tb = this._toolbar;

    return html`
      <div class="toolbar" @click=${this._closeSwitcher}>
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
        <div class="toolbar-title-wrap">
          <div class="toolbar-title">${tb.title}</div>
          ${this._renderSwitcher()}
        </div>
        <div class="toolbar-actions">
          ${tb.actions ?? nothing}
        </div>
      </div>
      <div class="content" @click=${this._closeSwitcher}>
        ${this._renderContent()}
      </div>
    `;
  }

  private _renderContent() {
    if (!this._trackerState) {
      return html`<div class="loading">Loading...</div>`;
    }

    const reviewMatch = this._path.match(/^\/review\/(.+)$/);
    if (reviewMatch) {
      const sessionId = decodeURIComponent(reviewMatch[1]);
      return html`
        <sleep-tracker-event-review-view
          .hass=${this.hass}
          .api=${this._api}
          .trackerState=${this._trackerState}
          .sessionId=${sessionId}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></sleep-tracker-event-review-view>
      `;
    }

    const nightMatch = this._path.match(/^\/night\/(.+)$/);

    if (nightMatch) {
      const sessionId = decodeURIComponent(nightMatch[1]);
      return html`
        <sleep-tracker-night-detail-view
          .hass=${this.hass}
          .api=${this._api}
          .trackerState=${this._trackerState}
          .sessionId=${sessionId}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></sleep-tracker-night-detail-view>
      `;
    }

    if (this._path === "/stats") {
      return html`
        <sleep-tracker-stats-view
          .hass=${this.hass}
          .api=${this._api}
          .trackerState=${this._trackerState}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></sleep-tracker-stats-view>
      `;
    }

    if (this._path === "/history") {
      return html`
        <sleep-tracker-history-view
          .hass=${this.hass}
          .api=${this._api}
          .trackerState=${this._trackerState}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></sleep-tracker-history-view>
      `;
    }

    if (this._path === "/export") {
      return html`
        <sleep-tracker-data-export-view
          .hass=${this.hass}
          .api=${this._api}
          .trackerState=${this._trackerState}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></sleep-tracker-data-export-view>
      `;
    }

    if (this._path === "/settings") {
      return html`
        <sleep-tracker-settings-view
          .hass=${this.hass}
          .api=${this._api}
          .trackerState=${this._trackerState}
          .trackers=${this._trackers}
          .userPreferences=${this._userPrefs}
          .selectedTrackerId=${this._selectedTrackerId}
          .narrow=${this.narrow}
          @navigate=${this._onNavigate}
          @set-toolbar=${this._onSetToolbar}
        ></sleep-tracker-settings-view>
      `;
    }

    return html`
      <sleep-tracker-main-view
        .hass=${this.hass}
        .api=${this._api}
        .trackerState=${this._trackerState}
        .narrow=${this.narrow}
        @navigate=${this._onNavigate}
        @set-toolbar=${this._onSetToolbar}
      ></sleep-tracker-main-view>
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
      .toolbar-title-wrap {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        margin-left: var(--ha-space-3, 12px);
      }
      .toolbar-title {
        font-size: var(--ha-font-size-xl, 20px);
        font-weight: var(--ha-font-weight-normal, 400);
        flex-shrink: 1;
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
      .switcher {
        position: relative;
        flex-shrink: 0;
      }
      .switcher-btn {
        display: flex;
        align-items: center;
        gap: var(--ha-space-1, 4px);
        background: rgba(0, 0, 0, 0.05);
        border: none;
        border-radius: var(--ha-border-radius-md, 8px);
        padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px);
        color: inherit;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--ha-font-size-s, 12px);
        max-width: 180px;
      }
      .switcher-btn:hover {
        background: rgba(0, 0, 0, 0.1);
      }
      .switcher-btn ha-icon {
        --mdc-icon-size: 18px;
      }
      .switcher-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .switcher-menu {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: var(--ha-space-1, 4px);
        background: var(--card-background-color, white);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-border-radius-md, 8px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        min-width: 220px;
        z-index: 10;
        padding: var(--ha-space-1, 4px) 0;
      }
      .switcher-item {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2, 8px);
        width: 100%;
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: var(--ha-font-size-m, 14px);
        text-align: left;
      }
      .switcher-item:hover {
        background: var(--secondary-background-color, #f5f5f5);
      }
      .switcher-item.active {
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .switcher-item ha-icon {
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }
      .switcher-item-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .switcher-item-tag {
        font-size: var(--ha-font-size-xs, 10px);
        text-transform: uppercase;
        background: var(--secondary-background-color, #f0f0f0);
        color: var(--secondary-text-color);
        padding: 1px 6px;
        border-radius: 999px;
        flex-shrink: 0;
      }
      .switcher-item-tag.shared {
        background: rgba(0, 114, 178, 0.15);
        color: var(--sleep-color-asleep, #0072B2);
      }
      .switcher-item.add {
        color: var(--primary-color, #03a9f4);
      }
      .switcher-item.add ha-icon {
        color: var(--primary-color, #03a9f4);
      }
      .switcher-divider {
        height: 1px;
        background: var(--divider-color, #e0e0e0);
        margin: var(--ha-space-1, 4px) 0;
      }
    `,
  ];
}
