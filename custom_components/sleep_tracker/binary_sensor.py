"""Binary sensor platform for Sleep Tracker."""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import slugify

from .const import DOMAIN

if TYPE_CHECKING:
    from .coordinator import SleepTrackerCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up binary sensor entities."""
    coordinator: SleepTrackerCoordinator = hass.data[DOMAIN]["coordinator"]

    # Store callback for dynamic entity creation when trackers are added
    hass.data[DOMAIN]["async_add_binary_sensor_entities"] = async_add_entities

    # Create entities for already-configured trackers
    entities = []
    for tracker_id in coordinator.store.trackers:
        entities.extend(create_tracker_binary_sensors(coordinator, tracker_id))

    if entities:
        async_add_entities(entities)


def create_tracker_binary_sensors(
    coordinator: SleepTrackerCoordinator, tracker_id: str
) -> list[BinarySensorEntity]:
    """Create binary sensor entities for a tracker."""
    return [InSessionSensor(coordinator, tracker_id)]


class InSessionSensor(BinarySensorEntity):
    """Binary sensor indicating whether the tracker is in a sleep session (active or paused)."""

    _attr_should_poll = False
    _attr_icon = "mdi:bed"

    def __init__(
        self, coordinator: SleepTrackerCoordinator, tracker_id: str
    ) -> None:
        self._coordinator = coordinator
        self._tracker_id = tracker_id
        self._unsub: Callable[[], None] | None = None

        config = coordinator.store.get_tracker_config(tracker_id)
        display_name = config.display_name if config else tracker_id[:8]
        slug = slugify(display_name)

        self._attr_unique_id = f"sleep_tracker_{tracker_id}_in_session"
        self.entity_id = f"binary_sensor.sleep_tracker_{slug}_in_session"
        self._attr_name = f"Sleep Tracker {display_name} In Session"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, tracker_id)},
            name=f"Sleep Tracker ({display_name})",
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
        session = self._coordinator.store.get_active_session(self._tracker_id)
        self._attr_is_on = session is not None
        self._attr_icon = "mdi:bed" if self._attr_is_on else "mdi:bed-empty"
