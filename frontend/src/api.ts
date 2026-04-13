import type { ChecklistItem, EventType, HomeAssistant, SleepSession, UserConfig, UserState } from "./types";

export class SleepTrackerApi {
  constructor(private hass: HomeAssistant) {}

  async getState(): Promise<UserState> {
    return this.hass.callWS({ type: "sleep_tracker/get_state" });
  }

  async getHistory(
    limit = 20,
    offset = 0
  ): Promise<{ sessions: SleepSession[] }> {
    return this.hass.callWS({
      type: "sleep_tracker/get_history",
      limit,
      offset,
    });
  }

  async getSession(session_id: string): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/get_session",
      session_id,
    });
  }

  async startSleep(): Promise<SleepSession> {
    return this.hass.callWS({ type: "sleep_tracker/start_sleep" });
  }

  async stopSleep(): Promise<SleepSession> {
    return this.hass.callWS({ type: "sleep_tracker/stop_sleep" });
  }

  async reopenSession(session_id: string): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/reopen_session",
      session_id,
    });
  }

  async event(event_type: EventType): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/event",
      event_type,
    });
  }

  async setupUser(display_name?: string): Promise<UserConfig> {
    return this.hass.callWS({
      type: "sleep_tracker/setup_user",
      ...(display_name ? { display_name } : {}),
    });
  }

  async getStats(days = 30): Promise<any> {
    return this.hass.callWS({
      type: "sleep_tracker/get_stats",
      days,
    });
  }

  async deletePhase(session_id: string, phase_index: number): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/delete_phase",
      session_id,
      phase_index,
    });
  }

  async splitPhase(
    session_id: string,
    phase_index: number,
    at_timestamp: string,
    wedge_minutes = 1.0
  ): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/split_phase",
      session_id,
      phase_index,
      at_timestamp,
      wedge_minutes,
    });
  }

  async adjustPhaseBoundary(
    session_id: string,
    after_index: number,
    new_time: string
  ): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/adjust_phase_boundary",
      session_id,
      after_index,
      new_time,
    });
  }

  async undoEdit(session_id: string): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/undo_edit",
      session_id,
    });
  }

  async deleteSession(session_id: string): Promise<void> {
    await this.hass.callWS({
      type: "sleep_tracker/delete_session",
      session_id,
    });
  }

  async finalizeSession(session_id: string): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/finalize_session",
      session_id,
    });
  }

  async updateSettings(
    updates: Partial<
      Pick<
        UserConfig,
        | "sleep_onset_minutes"
        | "fall_asleep_latency_minutes"
        | "auto_finalize_hours"
        | "export_url"
        | "export_headers"
        | "retention_days"
        | "checklist"
      >
    >
  ): Promise<UserConfig> {
    return this.hass.callWS({
      type: "sleep_tracker/update_settings",
      ...updates,
    });
  }

  async exportSession(session_id: string): Promise<void> {
    await this.hass.callWS({
      type: "sleep_tracker/export_session",
      session_id,
    });
  }

  subscribe(callback: (state: UserState) => void): Promise<() => void> {
    return this.hass.connection.subscribeMessage(callback, {
      type: "sleep_tracker/subscribe",
    });
  }
}
