"""Pure-function timeline reconstruction for sleep sessions.

No Home Assistant dependencies — can be tested independently.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .models import SleepPulse, TimelineInterval


def _parse(iso: str) -> datetime:
    """Parse an ISO 8601 datetime string."""
    return datetime.fromisoformat(iso)


def _fmt(dt: datetime) -> str:
    """Format a datetime as ISO 8601."""
    return dt.isoformat()


def compute_intervals(
    started_at: str,
    ended_at: str | None,
    pulses: list[SleepPulse],
    fall_asleep_latency_minutes: int = 15,
    sleep_onset_minutes: int = 0,
    now: datetime | None = None,
) -> list[TimelineInterval]:
    """Compute awake/asleep intervals from session data.

    Algorithm:
    - Session starts in AWAKE state (user just lay down).
    - Pulses within sleep_onset_minutes from start are ignored
      (the user is still settling in, phone activity is expected).
    - After fall_asleep_latency, user transitions to ASLEEP.
    - An "awake" pulse means the user woke up (ASLEEP -> AWAKE).
      The fall-asleep timer resets.
    - A "still_awake" pulse confirms the user is still awake,
      resetting the fall-asleep timer.
    - Session end means the user is AWAKE (getting up).
    """
    start_dt = _parse(started_at)
    end_dt = _parse(ended_at) if ended_at else (now or datetime.now(timezone.utc))
    latency = timedelta(minutes=fall_asleep_latency_minutes)
    onset_cutoff = start_dt + timedelta(minutes=sleep_onset_minutes)

    sorted_pulses = [
        p for p in sorted(pulses, key=lambda p: p.timestamp)
        if _parse(p.timestamp) >= onset_cutoff
    ]

    intervals: list[TimelineInterval] = []
    state = "awake"
    segment_start = start_dt
    sleep_at = start_dt + latency  # when we'll fall asleep if undisturbed

    for pulse in sorted_pulses:
        pulse_time = _parse(pulse.timestamp)
        if pulse_time >= end_dt:
            break

        if state == "awake":
            if sleep_at <= pulse_time:
                # We fell asleep at sleep_at, and this pulse wakes us (or confirms)
                intervals.append(
                    TimelineInterval(_fmt(segment_start), _fmt(sleep_at), "awake")
                )
                if pulse.pulse_type == "awake":
                    # Slept from sleep_at until this pulse
                    intervals.append(
                        TimelineInterval(_fmt(sleep_at), _fmt(pulse_time), "asleep")
                    )
                    segment_start = pulse_time
                    state = "awake"
                elif pulse.pulse_type == "still_awake":
                    # They say still awake, but we thought they slept — they woke up
                    intervals.append(
                        TimelineInterval(_fmt(sleep_at), _fmt(pulse_time), "asleep")
                    )
                    segment_start = pulse_time
                    state = "awake"
                sleep_at = pulse_time + latency
            else:
                # Still awake, just reset the sleep timer
                sleep_at = pulse_time + latency
        elif state == "asleep":
            # Any pulse means we're awake now
            intervals.append(
                TimelineInterval(_fmt(segment_start), _fmt(pulse_time), "asleep")
            )
            segment_start = pulse_time
            state = "awake"
            sleep_at = pulse_time + latency

    # Close out the remaining time to end_dt
    if state == "awake":
        if sleep_at < end_dt:
            # Fell asleep before session ended
            intervals.append(
                TimelineInterval(_fmt(segment_start), _fmt(sleep_at), "awake")
            )
            if ended_at:
                # Slept until session end (user wakes up to stop session)
                intervals.append(
                    TimelineInterval(_fmt(sleep_at), _fmt(end_dt), "asleep")
                )
            else:
                # Active session — currently asleep
                intervals.append(
                    TimelineInterval(_fmt(sleep_at), _fmt(end_dt), "asleep")
                )
        else:
            # Still awake at session end (or latency hasn't passed yet)
            intervals.append(
                TimelineInterval(_fmt(segment_start), _fmt(end_dt), "awake")
            )
    elif state == "asleep":
        intervals.append(
            TimelineInterval(_fmt(segment_start), _fmt(end_dt), "asleep")
        )

    return intervals


def compute_stats(
    intervals: list[TimelineInterval],
    started_at: str,
    ended_at: str,
) -> dict:
    """Compute sleep statistics from computed intervals.

    Returns dict with:
    - total_sleep_minutes: total time asleep
    - total_awake_minutes: total time awake
    - sleep_efficiency: ratio of sleep to total session time
    - awakenings: count of awake intervals after the initial one
    - time_to_fall_asleep_minutes: duration of first awake interval
    """
    start_dt = _parse(started_at)
    end_dt = _parse(ended_at)
    total_minutes = (end_dt - start_dt).total_seconds() / 60

    sleep_minutes = 0.0
    awake_minutes = 0.0
    awakenings = 0
    time_to_fall_asleep = 0.0
    first_awake_seen = False

    for interval in intervals:
        duration = (_parse(interval.end) - _parse(interval.start)).total_seconds() / 60
        if interval.state == "asleep":
            sleep_minutes += duration
        else:
            awake_minutes += duration
            if not first_awake_seen:
                time_to_fall_asleep = duration
                first_awake_seen = True
            else:
                awakenings += 1

    efficiency = sleep_minutes / total_minutes if total_minutes > 0 else 0.0

    return {
        "total_sleep_minutes": round(sleep_minutes, 1),
        "total_awake_minutes": round(awake_minutes, 1),
        "sleep_efficiency": round(efficiency, 3),
        "awakenings": awakenings,
        "time_to_fall_asleep_minutes": round(time_to_fall_asleep, 1),
    }
