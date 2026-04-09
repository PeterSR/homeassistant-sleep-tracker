import { css } from "lit";

export const tokens = css`
  :host {
    --sleep-color-awake: #ef5350;
    --sleep-color-asleep: #42a5f5;
    --sleep-color-deep-sleep: #1565c0;
    --sleep-color-pulse: #ff9800;
    --sleep-color-event-wake: #c2185b;
    --sleep-color-success: #66bb6a;
  }
`;

export const viewStyles = css`
  :host {
    display: block;
    padding: var(--ha-space-4, 16px);
    font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif);
    color: var(--primary-text-color);
  }
  .container {
    max-width: 600px;
    margin: 0 auto;
  }
`;

export const sectionStyles = css`
  .section {
    margin-bottom: var(--ha-space-6, 24px);
  }
  .section h3 {
    font-size: var(--ha-font-size-m, 14px);
    font-weight: var(--ha-font-weight-medium, 500);
    text-transform: uppercase;
    color: var(--secondary-text-color);
    margin: 0 0 var(--ha-space-2, 8px);
  }
`;

export const emptyStateStyles = css`
  .empty-state {
    text-align: center;
    padding: var(--ha-space-12, 48px) var(--ha-space-4, 16px);
    color: var(--secondary-text-color);
  }
  .empty-state h2 {
    font-weight: var(--ha-font-weight-normal, 400);
    margin-bottom: var(--ha-space-2, 8px);
  }
`;

export const cardStyles = css`
  ha-card {
    padding: var(--ha-space-4, 16px);
    margin-bottom: var(--ha-space-4, 16px);
  }
`;

export const buttonStyles = css`
  .big-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--ha-space-3, 12px);
    width: 100%;
    padding: var(--ha-space-8, 32px) var(--ha-space-4, 16px);
    border: none;
    border-radius: var(--ha-border-radius-lg, 12px);
    font-size: var(--ha-font-size-xl, 20px);
    font-weight: var(--ha-font-weight-medium, 500);
    cursor: pointer;
    transition: opacity 0.2s;
    font-family: inherit;
  }
  .big-button:hover {
    opacity: 0.85;
  }
  .big-button.start {
    background: var(--sleep-color-asleep, #42a5f5);
    color: white;
  }
  .big-button.stop {
    background: var(--sleep-color-awake, #ef5350);
    color: white;
  }
  .pulse-buttons {
    display: flex;
    gap: var(--ha-space-3, 12px);
    margin-top: var(--ha-space-4, 16px);
  }
  .pulse-btn {
    flex: 1;
    padding: var(--ha-space-4, 16px);
    border: 2px solid var(--divider-color, #e0e0e0);
    border-radius: var(--ha-border-radius-md, 8px);
    background: var(--card-background-color, white);
    color: var(--primary-text-color);
    font-size: var(--ha-font-size-m, 14px);
    font-weight: var(--ha-font-weight-medium, 500);
    cursor: pointer;
    text-align: center;
    font-family: inherit;
    transition: border-color 0.2s, background 0.2s;
  }
  .pulse-btn:hover {
    border-color: var(--primary-color);
  }
  .pulse-btn:active {
    background: var(--primary-color);
    color: white;
    border-color: var(--primary-color);
  }
`;

export const statStyles = css`
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--ha-space-3, 12px);
  }
  .stat {
    text-align: center;
    padding: var(--ha-space-3, 12px);
    background: var(--secondary-background-color, #f5f5f5);
    border-radius: var(--ha-border-radius-md, 8px);
  }
  .stat-value {
    font-size: var(--ha-font-size-2xl, 24px);
    font-weight: var(--ha-font-weight-bold, 700);
    color: var(--primary-text-color);
  }
  .stat-label {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    margin-top: var(--ha-space-1, 4px);
  }
`;

export const formStyles = css`
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--ha-space-4, 16px);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--ha-space-1, 4px);
  }
  .field label {
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--secondary-text-color);
  }
  .field input,
  .field select {
    padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px);
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: var(--ha-border-radius-md, 8px);
    font-size: var(--ha-font-size-m, 14px);
    background: var(--card-background-color, white);
    color: var(--primary-text-color);
    font-family: inherit;
  }
`;
