"""Config flow for Sleep Tracker integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class SleepTrackerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Sleep Tracker."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        if self._async_current_entries():
            return self.async_abort(reason="already_configured")

        if user_input is not None:
            return self.async_create_entry(
                title="Sleep Tracker",
                data={},
            )

        return self.async_show_form(step_id="user")
