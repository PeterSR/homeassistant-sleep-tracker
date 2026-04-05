import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { TimelineInterval, SleepPulse } from "../types";
import { tokens } from "../styles";
import { formatTime } from "../utils";

@customElement("timeline-bar")
export class TimelineBar extends LitElement {
  @property({ attribute: false }) intervals: TimelineInterval[] = [];
  @property({ attribute: false }) pulses: SleepPulse[] = [];
  @property() startedAt = "";
  @property() endedAt: string | null = null;
  @property({ type: Boolean }) compact = false;

  private get _totalMs(): number {
    if (!this.startedAt) return 0;
    const start = new Date(this.startedAt).getTime();
    const end = this.endedAt
      ? new Date(this.endedAt).getTime()
      : Date.now();
    return end - start;
  }

  private _pct(iso: string): number {
    const start = new Date(this.startedAt).getTime();
    const t = new Date(iso).getTime();
    return this._totalMs > 0 ? ((t - start) / this._totalMs) * 100 : 0;
  }

  render() {
    if (!this.intervals.length || !this.startedAt) return nothing;
    const barHeight = this.compact ? 16 : 32;
    const showLabels = !this.compact;

    return html`
      <div class="timeline-container">
        ${showLabels
          ? html`
              <div class="time-labels">
                <span>${formatTime(this.startedAt)}</span>
                <span>${this.endedAt ? formatTime(this.endedAt) : "now"}</span>
              </div>
            `
          : nothing}
        <div class="bar" style="height: ${barHeight}px">
          ${this.intervals.map((interval) => {
            const left = this._pct(interval.start);
            const right = this._pct(interval.end);
            const width = right - left;
            return html`
              <div
                class="segment ${interval.state}"
                style="left: ${left}%; width: ${width}%"
              ></div>
            `;
          })}
          ${!this.compact
            ? this.pulses.map((pulse) => {
                const pos = this._pct(pulse.timestamp);
                return html`
                  <div
                    class="pulse-marker ${pulse.pulse_type}"
                    style="left: ${pos}%"
                    title="${pulse.pulse_type} — ${formatTime(pulse.timestamp)}"
                  ></div>
                `;
              })
            : nothing}
          ${!this.endedAt
            ? html`<div class="now-marker" style="left: 100%"></div>`
            : nothing}
        </div>
      </div>
    `;
  }

  static styles = [
    tokens,
    css`
      .timeline-container {
        width: 100%;
      }
      .time-labels {
        display: flex;
        justify-content: space-between;
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        margin-bottom: var(--ha-space-1, 4px);
      }
      .bar {
        position: relative;
        width: 100%;
        border-radius: var(--ha-border-radius-md, 8px);
        overflow: hidden;
        background: var(--secondary-background-color, #f5f5f5);
      }
      .segment {
        position: absolute;
        top: 0;
        height: 100%;
        transition: width 0.3s ease;
      }
      .segment.asleep {
        background: var(--sleep-color-asleep, #42a5f5);
      }
      .segment.awake {
        background: var(--sleep-color-awake, #ef5350);
        opacity: 0.7;
      }
      .pulse-marker {
        position: absolute;
        top: -3px;
        width: 2px;
        height: calc(100% + 6px);
        transform: translateX(-50%);
        z-index: 1;
      }
      .pulse-marker.awake {
        background: var(--sleep-color-pulse, #ff9800);
      }
      .pulse-marker.still_awake {
        background: var(--sleep-color-pulse, #ff9800);
        opacity: 0.6;
      }
      .now-marker {
        position: absolute;
        top: -3px;
        width: 3px;
        height: calc(100% + 6px);
        background: var(--primary-color, #03a9f4);
        transform: translateX(-50%);
        z-index: 2;
        border-radius: 1px;
        animation: pulse-glow 2s ease-in-out infinite;
      }
      @keyframes pulse-glow {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
    `,
  ];
}
