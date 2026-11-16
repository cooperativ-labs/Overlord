import {
  type ClientRect,
  type Modifier,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

/**
 * Drag behaviour for the mission panel's compact objective rows (plan §7.4).
 *
 * The row button both opens the objective (click, Enter, Space) and reorders it, so a drag
 * starts only after a press-and-hold. Separate from the board's `useKanbanSensors` on purpose:
 * the board starts mouse drags on movement, which would turn every slightly shaky click on a
 * row into a drag.
 */

/** Mouse: hold 250ms; moving more than 6px before then cancels the drag and keeps the click. */
export const OBJECTIVE_ROW_MOUSE_SENSOR_OPTIONS = {
  activationConstraint: { delay: 250, tolerance: 6 }
} as const;

/**
 * Touch: the board's long-press values. A swipe that moves more than 8px before the delay is a
 * scroll, so the panel still scrolls when a finger lands on a row.
 */
export const OBJECTIVE_ROW_TOUCH_SENSOR_OPTIONS = {
  activationConstraint: { delay: 250, tolerance: 8 }
} as const;

/**
 * Mouse and touch only. There is deliberately no keyboard sensor: Space and Enter on a row open
 * the detail, and keyboard reordering is the row menu's Move up / Move down.
 */
export function useObjectiveRowSensors(enabled = true) {
  const sensors = useSensors(
    useSensor(MouseSensor, OBJECTIVE_ROW_MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, OBJECTIVE_ROW_TOUCH_SENSOR_OPTIONS)
  );
  const none = useSensors();
  return enabled ? sensors : none;
}

/** Rows move only up and down. */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function restrictToBoundingRect(
  transform: { x: number; y: number; scaleX: number; scaleY: number },
  rect: ClientRect,
  bounds: ClientRect
) {
  const value = { ...transform };
  if (rect.top + transform.y <= bounds.top) {
    value.y = bounds.top - rect.top;
  } else if (rect.bottom + transform.y >= bounds.top + bounds.height) {
    value.y = bounds.top + bounds.height - rect.bottom;
  }
  if (rect.left + transform.x <= bounds.left) {
    value.x = bounds.left - rect.left;
  } else if (rect.right + transform.x >= bounds.left + bounds.width) {
    value.x = bounds.left + bounds.width - rect.right;
  }
  return value;
}

/** A row cannot be dragged out of its list. */
export const restrictToParentElement: Modifier = ({
  containerNodeRect,
  draggingNodeRect,
  transform
}) => {
  if (!draggingNodeRect || !containerNodeRect) return transform;
  return restrictToBoundingRect(transform, draggingNodeRect, containerNodeRect);
};

export const OBJECTIVE_ROW_DND_MODIFIERS: Modifier[] = [
  restrictToVerticalAxis,
  restrictToParentElement
];

/**
 * Swallow the click the browser fires when the pointer is released after a drag, so dropping a
 * row never opens its detail. The guard listens in the capture phase and lasts one tick.
 */
export function suppressNextClick(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window
) {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  target.addEventListener('click', swallow, true);
  setTimeout(() => target.removeEventListener('click', swallow, true), 0);
}

/**
 * Move one id a single place up (`-1`) or down (`+1`). Returns null when it is already at that
 * end or is not in the list, so the caller sends nothing.
 */
export function moveObjectiveIdBy(
  order: readonly string[],
  id: string,
  delta: -1 | 1
): string[] | null {
  const from = order.indexOf(id);
  if (from === -1) return null;
  const to = from + delta;
  if (to < 0 || to >= order.length) return null;
  return arrayMove([...order], from, to);
}
