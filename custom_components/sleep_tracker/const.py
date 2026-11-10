"""Constants for Sleep Tracker integration."""

DOMAIN = "sleep_tracker"
VERSION = "0.7.0"
STORAGE_KEY = "sleep_tracker"
STORAGE_VERSION = 1

KIND_USER = "user"
KIND_SHARED = "shared"

DEFAULT_AUTOMATION_SOURCE = "automation"
DEFAULT_PANEL_SOURCE = "panel"

EVENT_AWAKE = "awake"
EVENT_STILL_AWAKE = "still_awake"
EVENT_FELL_ASLEEP = "fell_asleep"
EVENT_PAUSE = "pause"
EVENT_RESUME = "resume"
EVENT_CUSTOM = "custom"
EVENT_TYPES = {
    EVENT_AWAKE, EVENT_STILL_AWAKE, EVENT_FELL_ASLEEP,
    EVENT_PAUSE, EVENT_RESUME, EVENT_CUSTOM,
}
USER_EVENT_TYPES = {EVENT_AWAKE, EVENT_STILL_AWAKE, EVENT_FELL_ASLEEP}

PHASE_AWAKE = "awake"
PHASE_ASLEEP = "asleep"

# Event bus event names (public API for automations)
BUS_EVENT_SESSION_STARTED = f"{DOMAIN}_session_started"
BUS_EVENT_SESSION_ENDED = f"{DOMAIN}_session_ended"
BUS_EVENT_SESSION_PAUSED = f"{DOMAIN}_session_paused"
BUS_EVENT_SESSION_RESUMED = f"{DOMAIN}_session_resumed"
BUS_EVENT_SESSION_FINALIZED = f"{DOMAIN}_session_finalized"
BUS_EVENT_EVENT = f"{DOMAIN}_event"

DEFAULT_FALL_ASLEEP_LATENCY = 15  # minutes
DEFAULT_RETENTION_DAYS = 90

STATUS_IDLE = "idle"
STATUS_ACTIVE = "active"
STATUS_PAUSED = "paused"
