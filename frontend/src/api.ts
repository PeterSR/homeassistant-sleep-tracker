import type { HomeAssistant, SleepSession, UserConfig, UserState } from "./types";

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

  async pulse(pulse_type: "awake" | "still_awake"): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/pulse",
      pulse_type,
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

  async deletePulse(session_id: string, pulse_index: number): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/delete_pulse",
      session_id,
      pulse_index,
    });
  }

  async swapPulseType(session_id: string, pulse_index: number): Promise<SleepSession> {
    return this.hass.callWS({
      type: "sleep_tracker/swap_pulse_type",
      session_id,
      pulse_index,
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
