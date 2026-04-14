export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
}

export interface HomeAssistant {
  callWS: <T = any>(msg: Record<string, unknown>) => Promise<T>;
  callService: (
    domain: string,
    service: string,
    data?: Record<string, unknown>
  ) => Promise<void>;
  connection: {
    subscribeMessage: <T>(
      callback: (msg: T) => void,
      params: Record<string, unknown>
    ) => Promise<() => void>;
  };
  states: Record<string, HassEntity>;
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

export type EventType = "awake" | "still_awake" | "fell_asleep" | "pause" | "resume";

export interface SleepEvent {
  timestamp: string;
  event_type: EventType;
  source: string;
}

export type PhaseState = "awake" | "asleep";

export interface SleepPhase {
  start: string;
  end: string;
  state: PhaseState;
}

export interface SessionStats {
  time_in_bed_minutes: number;
  sleep_period_minutes: number;
  total_sleep_minutes: number;
  total_awake_minutes: number;
  sleep_efficiency: number;
  time_to_fall_asleep_minutes: number;
  time_before_getting_up_minutes: number;
  awakenings: number;
}

export type SessionStatus = "active" | "paused" | "stopped" | "completed" | "finalized";

export interface SleepSession {
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  events: SleepEvent[];
  phases: SleepPhase[];
  status: SessionStatus;
  finalized: boolean;
  exported: boolean;
  stats: SessionStats | null;
  undo_count?: number;
}

export interface ChecklistItem {
  type: "entity" | "text";
  entity_id?: string;
  desired_state?: string;
  text?: string;
}

export interface UserConfig {
  user_id: string;
  enabled: boolean;
  display_name: string;
  sleep_onset_minutes: number;
  fall_asleep_latency_minutes: number;
  auto_finalize_hours: number;
  skip_event_review: boolean;
  skip_phase_review: boolean;
  export_url: string | null;
  export_headers: Record<string, string>;
  retention_days: number;
  checklist: ChecklistItem[];
}

export interface UserState {
  config: UserConfig | null;
  active_session: SleepSession | null;
  last_session?: SleepSession | null;
  unfinalized_sessions?: SleepSession[];
}
