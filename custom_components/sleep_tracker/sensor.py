"""Sensor platform for Sleep Tracker."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Callable

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_point_in_utc_time
from homeassistant.util import slugify

from .const import DOMAIN, EVENT_AWAKE, PHASE_ASLEEP, PHASE_AWAKE

if TYPE_CHECKING:
    from .coordinator import SleepTrackerCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensor entities."""
    coordinator: SleepTrackerCoordinator = hass.data[DOMAIN]["coordinator"]

    # Store callback for dynamic entity creation when trackers are added
    hass.data[DOMAIN]["async_add_sensor_entities"] = async_add_entities

    # Create entities for already-configured trackers
    entities = []
    for tracker_id in coordinator.store.trackers:
        entities.extend(create_tracker_sensors(coordinator, tracker_id))

    if entities:
        async_add_entities(entities)


def create_tracker_sensors(
    coordinator: SleepTrackerCoordinator, tracker_id: str
) -> list[SensorEntity]:
    """Create sensor entities for a tracker."""
    return [
        LastAwakeSensor(coordinator, tracker_id),
        SessionStartSensor(coordinator, tracker_id),
        SleepDurationSensor(coordinator, tracker_id),
        AwakeCountSensor(coordinator, tracker_id),
        PhaseSensor(coordinator, tracker_id),
    ]


class _SleepTrackerSensorBase(SensorEntity):
    """Base class for sleep tracker sensors."""

    _attr_should_poll = False

    def __init__(
        self, coordinator: SleepTrackerCoordinator, tracker_id: str
    ) -> None:
        self._coordinator = coordinator
        self._tracker_id = tracker_id
        self._unsub: Callable[[], None] | None = None

        config = coordinator.store.get_tracker_config(tracker_id)
        self._display_name = config.display_name if config else tracker_id[:8]
        self._slug = slugify(self._display_name)

        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, tracker_id)},
            name=f"Sleep Tracker ({self._display_name})",
            manufacturer="Sleep Tracker",
            model="Virtual",
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        self._unsub = self._coordinator.add_tracker_listener(
            self._tracker_id, self._handle_update
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

    def __init__(self, coordinator, tracker_id):
        super().__init__(coordinator, tracker_id)
        self._attr_unique_id = f"sleep_tracker_{tracker_id}_last_awake"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_last_awake"
        self._attr_name = f"Sleep Tracker {self._display_name} Last Awake"

    @callback
    def _update_from_coordinator(self) -> None:
        session = self._coordinator.store.get_active_session(self._tracker_id)
        if session and session.events:
            last_event = session.events[-1]
            self._attr_native_value = datetime.fromisoformat(last_event.timestamp)
        elif not session:
            # Check last completed session
            history = self._coordinator.store.get_tracker_sessions(
                self._tracker_id, limit=1
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

    def __init__(self, coordinator, tracker_id):
        super().__init__(coordinator, tracker_id)
        self._attr_unique_id = f"sleep_tracker_{tracker_id}_session_start"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_session_start"
        self._attr_name = f"Sleep Tracker {self._display_name} Session Start"

    @callback
    def _update_from_coordinator(self) -> None:
        session = self._coordinator.store.get_active_session(self._tracker_id)
        if session:
            self._attr_native_value = datetime.fromisoformat(session.started_at)
        else:
            history = self._coordinator.store.get_tracker_sessions(
                self._tracker_id, limit=1
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

    def __init__(self, coordinator, tracker_id):
        super().__init__(coordinator, tracker_id)
        self._attr_unique_id = f"sleep_tracker_{tracker_id}_sleep_duration"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_sleep_duration"
        self._attr_name = f"Sleep Tracker {self._display_name} Sleep Duration"

    @callback
    def _update_from_coordinator(self) -> None:
        history = self._coordinator.store.get_tracker_sessions(
            self._tracker_id, limit=1
        )
        if history:
            stats = self._coordinator.get_session_stats(history[0])
            if stats:
                self._attr_native_value = stats["total_sleep_minutes"]
                return
        self._attr_native_value = None


class PhaseSensor(_SleepTrackerSensorBase):
    """Enum sensor: "awake" when no session or paused; live phase state when active.

    The phase can transition awake → asleep purely on time (latency timer)
    without any incoming event. This sensor schedules a one-shot timer at the
    next transition so its state doesn't go stale between events.
    """

    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = [PHASE_AWAKE, PHASE_ASLEEP]
    _attr_icon = "mdi:sleep"

    def __init__(self, coordinator, tracker_id):
        super().__init__(coordinator, tracker_id)
        self._attr_unique_id = f"sleep_tracker_{tracker_id}_phase"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_phase"
        self._attr_name = f"Sleep Tracker {self._display_name} Phase"
        self._unsub_transition: CALLBACK_TYPE | None = None

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub_transition:
            self._unsub_transition()
            self._unsub_transition = None
        await super().async_will_remove_from_hass()

    @callback
    def _update_from_coordinator(self) -> None:
        state = self._coordinator.get_current_phase_state(self._tracker_id)
        self._attr_native_value = state
        self._attr_icon = (
            "mdi:sleep" if state == PHASE_ASLEEP else "mdi:sleep-off"
        )
        self._reschedule_transition()

    @callback
    def _reschedule_transition(self) -> None:
        if self._unsub_transition:
            self._unsub_transition()
            self._unsub_transition = None
        next_t = self._coordinator.get_next_phase_transition(self._tracker_id)
        if next_t is not None:
            self._unsub_transition = async_track_point_in_utc_time(
                self.hass, self._handle_transition, next_t
            )

    @callback
    def _handle_transition(self, _now) -> None:
        self._unsub_transition = None
        self._update_from_coordinator()
        self.async_write_ha_state()


class AwakeCountSensor(_SleepTrackerSensorBase):
    """Number of awakenings in the current or last session."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:bell-ring-outline"

    def __init__(self, coordinator, tracker_id):
        super().__init__(coordinator, tracker_id)
        self._attr_unique_id = f"sleep_tracker_{tracker_id}_awake_count"
        self.entity_id = f"sensor.sleep_tracker_{self._slug}_awake_count"
        self._attr_name = f"Sleep Tracker {self._display_name} Awake Count"

    @callback
    def _update_from_coordinator(self) -> None:
        # Prefer active session, fall back to last completed
        session = self._coordinator.store.get_active_session(self._tracker_id)
        if not session:
            history = self._coordinator.store.get_tracker_sessions(
                self._tracker_id, limit=1
            )
            session = history[0] if history else None

        if session:
            count = sum(
                1 for e in session.events if e.event_type == EVENT_AWAKE
            )
            self._attr_native_value = count
        else:
            self._attr_native_value = None
