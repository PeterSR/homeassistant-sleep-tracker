"""Constants for Sleep Tracker integration."""

DOMAIN = "sleep_tracker"
STORAGE_KEY = "sleep_tracker"
STORAGE_VERSION = 1

EVENT_AWAKE = "awake"
EVENT_STILL_AWAKE = "still_awake"
EVENT_FELL_ASLEEP = "fell_asleep"
EVENT_TYPES = {EVENT_AWAKE, EVENT_STILL_AWAKE, EVENT_FELL_ASLEEP}

PHASE_AWAKE = "awake"
PHASE_ASLEEP = "asleep"

DEFAULT_FALL_ASLEEP_LATENCY = 15  # minutes
DEFAULT_RETENTION_DAYS = 90
