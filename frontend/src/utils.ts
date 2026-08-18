import type { SleepPhase } from "./types";

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

export function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function efficiencyPercent(efficiency: number): string {
  return `${Math.round(efficiency * 100)}%`;
}

/**
 * Sum asleep/awake minutes from materialized phases.
 *
 * For a running session the backend materializes phases up to the server's
 * "now" at request time, so the last phase is stretched to the client's clock
 * to keep the numbers moving between state updates.
 */
export function phaseTotals(
  phases: SleepPhase[],
  extendToNow = false
): { asleepMinutes: number; awakeMinutes: number } {
  let asleepMinutes = 0;
  let awakeMinutes = 0;
  const now = Date.now();

  phases.forEach((phase, index) => {
    const start = new Date(phase.start).getTime();
    let end = new Date(phase.end).getTime();
    if (extendToNow && index === phases.length - 1) {
      end = Math.max(end, now);
    }
    const minutes = Math.max(0, (end - start) / 60000);
    if (phase.state === "asleep") {
      asleepMinutes += minutes;
    } else {
      awakeMinutes += minutes;
    }
  });

  return { asleepMinutes, awakeMinutes };
}
