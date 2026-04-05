"""Binary sensor platform for Sleep Tracker."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
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
    """Set up binary sensor entities."""
    coordinator: SleepTrackerCoordinator = hass.data[DOMAIN]["coordinator"]

    # Store callback for dynamic entity creation when users opt in
    hass.data[DOMAIN]["async_add_binary_sensor_entities"] = async_add_entities

    # Create entities for already-configured users
    entities = []
    for user_id in coordinator.store.users:
        entities.extend(create_user_binary_sensors(coordinator, user_id))

    if entities:
        async_add_entities(entities)


def create_user_binary_sensors(
    coordinator: SleepTrackerCoordinator, user_id: str
) -> list[BinarySensorEntity]:
    """Create binary sensor entities for a user."""
    return [SleepingSensor(coordinator, user_id)]


class SleepingSensor(BinarySensorEntity):
    """Binary sensor indicating whether the user is in a sleep session."""

    _attr_should_poll = False
    _attr_icon = "mdi:sleep"

    def __init__(
        self, coordinator: SleepTrackerCoordinator, user_id: str
    ) -> None:
        self._coordinator = coordinator
        self._user_id = user_id
        self._unsub: (() -> None) | None = None

        config = coordinator.store.get_user_config(user_id)
        display_name = config.display_name if config else user_id[:8]
        slug = display_name.lower().replace(" ", "_")

        self._attr_unique_id = f"sleep_tracker_{user_id}_sleeping"
        self.entity_id = f"binary_sensor.sleep_tracker_{slug}_sleeping"
        self._attr_name = f"Sleep Tracker {display_name} Sleeping"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, user_id)},
            name=f"Sleep Tracker ({display_name})",
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
        session = self._coordinator.store.get_active_session(self._user_id)
        self._attr_is_on = session is not None
        self._attr_icon = "mdi:sleep" if self._attr_is_on else "mdi:sleep-off"
