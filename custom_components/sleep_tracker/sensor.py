"""Sensor platform for Sleep Tracker."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

if TYPE_CHECKING:
    from .coordinator import SleepTrackerCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensor entities."""
    coordinator: SleepTrackerCoordinator = hass.data[DOMAIN]["coordinator"]

    # Store callback for dynamic entity creation when users opt in
    hass.data[DOMAIN]["async_add_sensor_entities"] = async_add_entities

    # Create entities for already-configured users
    entities = []
    for user_id in coordinator.store.users:
        entities.extend(create_user_sensors(coordinator, user_id))

    if entities:
        async_add_entities(entities)


def create_user_sensors(
    coordinator: SleepTrackerCoordinator, user_id: str
) -> list[SensorEntity]:
    """Create sensor entities for a user."""
    return [
        LastAwakeSensor(coordinator, user_id),
        SessionStartSensor(coordinator, user_id),
        SleepDurationSensor(coordinator, user_id),
        AwakeCountSensor(coordinator, user_id),
    ]


class _SleepTrackerSensorBase(SensorEntity):
    """Base class for sleep tracker sensors."""

    _attr_should_poll = False

    def __init__(
        self, coordinator: SleepTrackerCoordinator, user_id: str
    ) -> None:
        self._coordinator = coordinator
        self._user_id = user_id
        self._unsub: callable | None = None

        config = coordinator.store.get_user_config(user_id)
        self._display_name = config.display_name if config else user_id[:8]
        self._slug = self._display_name.lower().replace(" ", "_")

        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, user_id)},
            name=f"Sleep Tracker ({self._display_name})",
            manufacturer="Sleep Tracker",
            model="Virtual",
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        self._unsub = self._coordinator.add_user_listener(
            self._user_id, self._handle_update
        )
        self._update_from_coordinator()

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub:
            self._unsub()

    @callback
    def _handle_update(self) -> None:
        self._update_from_coordinator()
        self.async_write_ha_state()

    @callback
    def _update_from_coordinator(self) -> None:
        raise NotImplementedError


class LastAwakeSensor(_SleepTrackerSensorBase):
    """Timestamp of the last event."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:eye-outline"

    def __init__(self, coordinator, user_id):
        super().__init__(coordinator, user_id)
        self._attr_unique_id = f"sleep_tracker_{user_id}_last_awake"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_last_awake"
        self._attr_name = f"Sleep Tracker {self._display_name} Last Awake"

    @callback
    def _update_from_coordinator(self) -> None:
        session = self._coordinator.store.get_active_session(self._user_id)
        if session and session.events:
            last_event = session.events[-1]
            self._attr_native_value = datetime.fromisoformat(last_event.timestamp)
        elif not session:
            # Check last completed session
            history = self._coordinator.store.get_user_sessions(
                self._user_id, limit=1
            )
            if history and history[0].events:
                last_event = history[0].events[-1]
                self._attr_native_value = datetime.fromisoformat(
                    last_event.timestamp
                )
            else:
                self._attr_native_value = None
        else:
            self._attr_native_value = None


class SessionStartSensor(_SleepTrackerSensorBase):
    """Timestamp of the current or last session start."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:bed-clock"

    def __init__(self, coordinator, user_id):
        super().__init__(coordinator, user_id)
        self._attr_unique_id = f"sleep_tracker_{user_id}_session_start"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_session_start"
        self._attr_name = f"Sleep Tracker {self._display_name} Session Start"

    @callback
    def _update_from_coordinator(self) -> None:
        session = self._coordinator.store.get_active_session(self._user_id)
        if session:
            self._attr_native_value = datetime.fromisoformat(session.started_at)
        else:
            history = self._coordinator.store.get_user_sessions(
                self._user_id, limit=1
            )
            if history:
                self._attr_native_value = datetime.fromisoformat(
                    history[0].started_at
                )
            else:
                self._attr_native_value = None


class SleepDurationSensor(_SleepTrackerSensorBase):
    """Total sleep duration of the last completed session in minutes."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_icon = "mdi:clock-time-eight-outline"

    def __init__(self, coordinator, user_id):
        super().__init__(coordinator, user_id)
        self._attr_unique_id = f"sleep_tracker_{user_id}_sleep_duration"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_sleep_duration"
        self._attr_name = f"Sleep Tracker {self._display_name} Sleep Duration"

    @callback
    def _update_from_coordinator(self) -> None:
        history = self._coordinator.store.get_user_sessions(
            self._user_id, limit=1
        )
        if history:
            session_dict = self._coordinator._session_to_dict(history[0])
            stats = session_dict.get("stats")
            if stats:
                self._attr_native_value = stats["total_sleep_minutes"]
                return
        self._attr_native_value = None


class AwakeCountSensor(_SleepTrackerSensorBase):
    """Number of awakenings in the current or last session."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:bell-ring-outline"

    def __init__(self, coordinator, user_id):
        super().__init__(coordinator, user_id)
        self._attr_unique_id = f"sleep_tracker_{user_id}_awake_count"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_awake_count"
        self._attr_name = f"Sleep Tracker {self._display_name} Awake Count"

    @callback
    def _update_from_coordinator(self) -> None:
        # Prefer active session, fall back to last completed
        session = self._coordinator.store.get_active_session(self._user_id)
        if not session:
            history = self._coordinator.store.get_user_sessions(
                self._user_id, limit=1
            )
            session = history[0] if history else None

        if session:
            # Count "awake" events excluding still_awake/fell_asleep
            count = sum(
                1 for e in session.events if e.event_type == "awake"
            )
            self._attr_native_value = count
        else:
            self._attr_native_value = None
