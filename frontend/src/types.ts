import type { TemplateResult } from "lit";

interface KnownHassAttributes {
  friendly_name?: string;
  unit_of_measurement?: string;
  icon?: string;
  device_class?: string;
  options?: string[];
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: KnownHassAttributes & Record<string, unknown>;
}

export interface HomeAssistant {
  callWS: <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
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
  actions?: TemplateResult;
}

export const CYCLE_TYPES = ["awake", "still_awake", "fell_asleep"] as const;
export type CycleType = (typeof CYCLE_TYPES)[number];

export type EventType = CycleType | "pause" | "resume" | "custom";

export interface SleepEvent {
  timestamp: string;
  event_type: EventType;
  source: string;
  custom_event_id?: string;
  automation_id?: string;
  automation_trigger_id?: string;
}

export interface CustomEvent {
  id: string;
  label: string;
  icon?: string | null;
  tag?: string | null;
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
  note: string | null;
  rating_quality: number | null;
  rating_feeling: number | null;
  tags: string[];
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
  awakening_grace_minutes: number;
  skip_event_review: boolean;
  skip_phase_review: boolean;
  export_url: string | null;
  export_headers: Record<string, string>;
  export_environment_data: boolean;
  retention_days: number;
  checklist: ChecklistItem[];
  show_note: boolean;
  show_rating_quality: boolean;
  show_rating_feeling: boolean;
  show_tags: boolean;
  available_tags: string[];
  show_environment: boolean;
  environment_entities: string[];
  sleep_goal_minutes: number;
  custom_events: CustomEvent[];
}

export interface UserState {
  config: UserConfig | null;
  active_session: SleepSession | null;
  last_session?: SleepSession | null;
  unfinalized_sessions?: SleepSession[];
}

export interface DailyStat {
  session_id: string;
  date: string;
  started_at: string;
  ended_at: string;
  time_in_bed_minutes: number;
  sleep_period_minutes: number;
  total_sleep_minutes: number;
  sleep_efficiency: number;
  awakenings: number;
  time_to_fall_asleep_minutes: number;
  time_before_getting_up_minutes: number;
}

export interface StatsData {
  days: number;
  session_count: number;
  daily: DailyStat[];
  averages: {
    total_sleep_minutes: number;
    sleep_period_minutes: number;
    sleep_efficiency: number;
    awakenings: number;
    time_to_fall_asleep_minutes: number;
    time_before_getting_up_minutes: number;
  };
}

export interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}
