export interface HomeAssistant {
  callWS: <T = any>(msg: Record<string, unknown>) => Promise<T>;
  connection: {
    subscribeMessage: <T>(
      callback: (msg: T) => void,
      params: Record<string, unknown>
    ) => Promise<() => void>;
  };
  user: { id: string; name: string; is_admin: boolean };
}

export interface PanelInfo {
  config: Record<string, unknown>;
}

export interface Route {
  path: string;
  prefix: string;
}

export interface ToolbarConfig {
  title: string;
  backPath?: string;
  actions?: unknown;
}

export interface SleepPulse {
  timestamp: string;
  pulse_type: "awake" | "still_awake";
  source: string;
}

export interface TimelineInterval {
  start: string;
  end: string;
  state: "awake" | "asleep";
}

export interface SessionStats {
  total_sleep_minutes: number;
  total_awake_minutes: number;
  sleep_efficiency: number;
  awakenings: number;
  time_to_fall_asleep_minutes: number;
}

export interface SleepSession {
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  pulses: SleepPulse[];
  finalized: boolean;
  exported: boolean;
  intervals: TimelineInterval[];
  stats: SessionStats | null;
}

export interface UserConfig {
  user_id: string;
  enabled: boolean;
  display_name: string;
  sleep_onset_minutes: number;
  fall_asleep_latency_minutes: number;
  auto_finalize_hours: number;
  export_url: string | null;
  export_headers: Record<string, string>;
  retention_days: number;
}

export interface UserState {
  config: UserConfig | null;
  active_session: SleepSession | null;
  last_session?: SleepSession | null;
  unfinalized_sessions?: SleepSession[];
}
