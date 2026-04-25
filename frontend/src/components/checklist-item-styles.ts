import { css } from "lit";

export const checklistItemStyles = css`
  .checklist-card {
    display: flex;
    align-items: center;
    gap: var(--ha-space-3, 12px);
    padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
    background: var(--card-background-color, white);
    border-radius: var(--ha-border-radius-md, 8px);
    cursor: pointer;
    border: 1px solid var(--divider-color, #e0e0e0);
    transition: background 0.15s, border-color 0.15s;
  }
  .checklist-card:hover {
    background: var(--secondary-background-color, #f5f5f5);
  }
  .checklist-card.ok {
    border-color: var(--sleep-color-success, #009E73);
    background: rgba(102, 187, 106, 0.08);
  }
  .checklist-card.warn {
    border-color: var(--sleep-color-awake, #D55E00);
    background: rgba(239, 83, 80, 0.08);
  }
  .checklist-card.unavailable {
    opacity: 0.5;
  }
  .checklist-card.checked .tile-name,
  .checklist-card.text.checked .tile-name {
    text-decoration: line-through;
    color: var(--secondary-text-color);
  }
  .check {
    width: 20px;
    height: 20px;
    margin: 0;
    flex-shrink: 0;
    accent-color: var(--primary-color, #03a9f4);
    cursor: pointer;
  }
  .check:disabled {
    cursor: default;
  }
  .checklist-card.warn .check {
    accent-color: var(--sleep-color-awake, #D55E00);
  }
  .checklist-card.ok .check {
    accent-color: var(--sleep-color-success, #009E73);
  }
  .tile-name {
    flex: 1;
    font-size: var(--ha-font-size-m, 14px);
  }
  .tile-state {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
    text-transform: capitalize;
  }
`;
