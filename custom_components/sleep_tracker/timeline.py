"""Pure-function timeline reconstruction for sleep sessions.

No Home Assistant dependencies — can be tested independently.
"""

from __future__ import annotations

from datetime import datetime, timedelta

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
    - Initial fall-asleep time = start + max(latency, onset). Onset acts
      as a minimum settling period; latency is the per-event "back to sleep"
      duration.
    - Each pulse extends the fall-asleep timer to max(current, pulse + latency).
      The timer is monotonic — events can only push it later, never earlier.
    - An "awake" pulse on an asleep state transitions back to awake.
    - A "still_awake" pulse keeps the awake state continuous (no phantom sleep).
    - Within an awake window (sleep_at > pulse_time), an "awake" pulse behaves
      identically to "still_awake" — just extends the timer.
    - Session end means the user is AWAKE (getting up).
    """
    start_dt = _parse(started_at)
    if ended_at:
        end_dt = _parse(ended_at)
    elif now is not None:
        end_dt = now
    else:
        # Fall back to "now" in the same TZ as start_dt for an active session
        from datetime import timezone as _tz
        end_dt = datetime.now(start_dt.tzinfo or _tz.utc)
    latency = timedelta(minutes=fall_asleep_latency_minutes)
    onset = timedelta(minutes=sleep_onset_minutes)

    sorted_pulses = sorted(pulses, key=lambda p: p.timestamp)

    intervals: list[TimelineInterval] = []
    state = "awake"
    segment_start = start_dt
    # Onset is a minimum initial settling period; never less than latency
    sleep_at = start_dt + max(latency, onset)

    for pulse in sorted_pulses:
        pulse_time = _parse(pulse.timestamp)
        if pulse_time >= end_dt:
            break

        if pulse.pulse_type == "still_awake":
            # User confirms they have been awake all along since the last event.
            # Do NOT split the current awake segment with a phantom asleep period.
            if state == "asleep":
                # Edge case: algorithm thought asleep, user says they were awake.
                # Retroactively close the asleep segment.
                intervals.append(
                    TimelineInterval(_fmt(segment_start), _fmt(pulse_time), "asleep")
                )
                segment_start = pulse_time
                state = "awake"
            # state == "awake": just extend by resetting the sleep timer
            sleep_at = pulse_time + latency
            continue

        # pulse.pulse_type == "awake"
        if state == "awake":
            if sleep_at <= pulse_time:
                # We fell asleep at sleep_at; this pulse wakes us
                intervals.append(
                    TimelineInterval(_fmt(segment_start), _fmt(sleep_at), "awake")
                )
                intervals.append(
                    TimelineInterval(_fmt(sleep_at), _fmt(pulse_time), "asleep")
                )
                segment_start = pulse_time
                state = "awake"
            # else: still in latency window — treat as still_awake (just extend)
            sleep_at = pulse_time + latency
        elif state == "asleep":
            # Asleep -> awake transition
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
    - awakenings: count of awake intervals between sleep periods
      (excludes the initial settling and the final wake-up at session end)
    - time_to_fall_asleep_minutes: duration of first awake interval
    """
    start_dt = _parse(started_at)
    end_dt = _parse(ended_at)
    total_minutes = (end_dt - start_dt).total_seconds() / 60

    sleep_minutes = 0.0
    awake_minutes = 0.0
    time_to_fall_asleep = 0.0

    # Identify awake intervals; the first and last are excluded from awakenings.
    awake_indices: list[int] = []
    for idx, interval in enumerate(intervals):
        duration = (_parse(interval.end) - _parse(interval.start)).total_seconds() / 60
        if interval.state == "asleep":
            sleep_minutes += duration
        else:
            awake_minutes += duration
            awake_indices.append(idx)

    if awake_indices:
        first_idx = awake_indices[0]
        first_dur = (
            _parse(intervals[first_idx].end) - _parse(intervals[first_idx].start)
        ).total_seconds() / 60
        time_to_fall_asleep = first_dur

    # Awakenings = awake intervals strictly between two asleep intervals
    awakenings = 0
    for idx in awake_indices:
        prev_is_asleep = idx > 0 and intervals[idx - 1].state == "asleep"
        next_is_asleep = idx < len(intervals) - 1 and intervals[idx + 1].state == "asleep"
        if prev_is_asleep and next_is_asleep:
            awakenings += 1

    efficiency = sleep_minutes / total_minutes if total_minutes > 0 else 0.0

    return {
        "total_sleep_minutes": round(sleep_minutes, 1),
        "total_awake_minutes": round(awake_minutes, 1),
        "sleep_efficiency": round(efficiency, 3),
        "awakenings": awakenings,
        "time_to_fall_asleep_minutes": round(time_to_fall_asleep, 1),
    }
