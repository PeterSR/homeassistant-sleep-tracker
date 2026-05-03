import type {
  CycleType,
  HomeAssistant,
  SleepSession,
  StatsData,
  TrackerConfig,
  TrackerState,
} from "./types";

/**
 * SleepTrackerApi is bound to a specific tracker via setTrackerId. When
 * tracker_id is null, every WS call omits the field, and the backend resolves
 * the connection user's personal tracker.
 */
export class SleepTrackerApi {
  private trackerId: string | null = null;

  constructor(private hass: HomeAssistant) {}

  setTrackerId(trackerId: string | null): void {
    this.trackerId = trackerId;
  }

  getTrackerId(): string | null {
    return this.trackerId;
  }

  private withTracker<T extends Record<string, unknown>>(msg: T): T {
    if (this.trackerId) {
      return { ...msg, tracker_id: this.trackerId };
    }
    return msg;
  }

  // --- Tracker management ---

  async listTrackers(): Promise<{ trackers: TrackerConfig[] }> {
    return this.hass.callWS({ type: "sleep_tracker/list_trackers" });
  }

  async createSharedTracker(display_name: string): Promise<TrackerConfig> {
    return this.hass.callWS({
      type: "sleep_tracker/create_shared_tracker",
      display_name,
    });
  }

  async deleteTracker(tracker_id: string): Promise<void> {
    await this.hass.callWS({
      type: "sleep_tracker/delete_tracker",
      tracker_id,
    });
  }

  async setupTracker(display_name?: string): Promise<TrackerConfig> {
    return this.hass.callWS({
      type: "sleep_tracker/setup_tracker",
      ...(display_name ? { display_name } : {}),
    });
  }

  // --- State ---

  async getState(): Promise<TrackerState> {
    return this.hass.callWS(this.withTracker({ type: "sleep_tracker/get_state" }));
  }

  async getHistory(
    limit = 20,
    offset = 0
  ): Promise<{ sessions: SleepSession[] }> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/get_history",
      limit,
      offset,
    }));
  }

  async getSession(session_id: string): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/get_session",
      session_id,
    });
  }

  async getStats(days = 30): Promise<StatsData> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/get_stats",
      days,
    }));
  }

  // --- Session lifecycle ---

  async startSleep(): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({ type: "sleep_tracker/start_sleep" }));
  }

  async stopSleep(): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({ type: "sleep_tracker/stop_sleep" }));
  }

  async pauseSleep(): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({ type: "sleep_tracker/pause_sleep" }));
  }

  async completeSession(session_id: string): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/complete_session",
      session_id,
    }));
  }

  async editEvent(
    session_id: string,
    event_index: number,
    event_type: CycleType
  ): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/edit_event",
      session_id,
      event_index,
      event_type,
    }));
  }

  async deleteEvent(
    session_id: string,
    event_index: number
  ): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/delete_event",
      session_id,
      event_index,
    }));
  }

  async reopenSession(session_id: string): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/reopen_session",
      session_id,
    }));
  }

  async revertToEventReview(session_id: string): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/revert_to_event_review",
      session_id,
    }));
  }

  async event(event_type: CycleType): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/event",
      event_type,
    }));
  }

  async customEvent(custom_event_id: string): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/custom_event",
      custom_event_id,
    }));
  }

  async exportData(
    start_date?: string | null,
    end_date?: string | null,
    include_environment = false
  ): Promise<{ sessions: SleepSession[]; count: number; exported_at: string }> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/export_data",
      start_date: start_date ?? null,
      end_date: end_date ?? null,
      include_environment,
    }));
  }

  async deletePhase(session_id: string, phase_index: number): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/delete_phase",
      session_id,
      phase_index,
    }));
  }

  async splitPhase(
    session_id: string,
    phase_index: number,
    at_timestamp: string,
    wedge_minutes = 1.0
  ): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/split_phase",
      session_id,
      phase_index,
      at_timestamp,
      wedge_minutes,
    }));
  }

  async adjustPhaseBoundary(
    session_id: string,
    after_index: number,
    new_time: string
  ): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/adjust_phase_boundary",
      session_id,
      after_index,
      new_time,
    }));
  }

  async appendPhase(
    session_id: string,
    state: "awake" | "asleep",
    end_timestamp: string
  ): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/append_phase",
      session_id,
      state,
      end_timestamp,
    }));
  }

  async undoEdit(session_id: string): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/undo_edit",
      session_id,
    }));
  }

  async updateSessionMeta(
    session_id: string,
    meta: {
      note?: string | null;
      rating_quality?: number | null;
      rating_feeling?: number | null;
      tags?: string[];
    }
  ): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/update_session_meta",
      session_id,
      ...meta,
    }));
  }

  async getTagUsage(): Promise<Record<string, number>> {
    return this.hass.callWS(this.withTracker({ type: "sleep_tracker/get_tag_usage" }));
  }

  async deleteSession(session_id: string): Promise<void> {
    await this.hass.callWS(this.withTracker({
      type: "sleep_tracker/delete_session",
      session_id,
    }));
  }

  async finalizeSession(session_id: string): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/finalize_session",
      session_id,
    }));
  }

  async unfinalizeSession(session_id: string): Promise<SleepSession> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/unfinalize_session",
      session_id,
    }));
  }

  async updateSettings(
    updates: Partial<
      Pick<
        TrackerConfig,
        | "sleep_onset_minutes"
        | "fall_asleep_latency_minutes"
        | "awakening_grace_minutes"
        | "skip_event_review"
        | "skip_phase_review"
        | "export_url"
        | "export_headers"
        | "export_environment_data"
        | "retention_days"
        | "checklist"
        | "show_note"
        | "show_rating_quality"
        | "show_rating_feeling"
        | "show_tags"
        | "available_tags"
        | "show_environment"
        | "environment_entities"
        | "sleep_goal_minutes"
        | "custom_events"
        | "display_name"
      >
    >
  ): Promise<TrackerConfig> {
    return this.hass.callWS(this.withTracker({
      type: "sleep_tracker/update_settings",
      ...updates,
    }));
  }

  async exportSession(session_id: string): Promise<void> {
    await this.hass.callWS(this.withTracker({
      type: "sleep_tracker/export_session",
      session_id,
    }));
  }

  subscribe(callback: (state: TrackerState) => void): Promise<() => void> {
    const params: Record<string, unknown> = { type: "sleep_tracker/subscribe" };
    if (this.trackerId) params.tracker_id = this.trackerId;
    return this.hass.connection.subscribeMessage(callback, params);
  }
}
