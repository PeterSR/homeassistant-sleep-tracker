"""Constants for Sleep Tracker integration."""

DOMAIN = "sleep_tracker"
STORAGE_KEY = "sleep_tracker"
STORAGE_VERSION = 1

PULSE_AWAKE = "awake"
PULSE_STILL_AWAKE = "still_awake"
PULSE_TYPES = {PULSE_AWAKE, PULSE_STILL_AWAKE}

DEFAULT_FALL_ASLEEP_LATENCY = 15  # minutes
DEFAULT_RETENTION_DAYS = 90
