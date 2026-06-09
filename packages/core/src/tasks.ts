import { z } from 'zod';

/** The kind of CRM task. Drives the row icon and default copy. */
export const TASK_TYPES = ['TODO', 'CALL', 'EMAIL', 'MEETING'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** Task priority, low to high. */
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Lifecycle status of a task. */
export const TASK_STATUSES = ['OPEN', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskTypeSchema = z.enum(TASK_TYPES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const taskStatusSchema = z.enum(TASK_STATUSES);

/** Where a task sorts when due dates tie: higher rank wins. */
const PRIORITY_RANK: Record<TaskPriority, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * The list section a task belongs in for a given moment. Done tasks always
 * land in `done`; open tasks split by their due date relative to today's
 * local-time boundaries. Used to group the task list into
 * Overdue / Today / Upcoming / Someday / Done.
 */
export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'someday' | 'done';

/** The ordered sections a grouped task list renders. */
export const TASK_BUCKETS = [
  'overdue',
  'today',
  'upcoming',
  'someday',
  'done',
] as const satisfies readonly TaskBucket[];

type TaskTiming = { status: TaskStatus; dueAt: Date | null };

function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Which list section a task falls into at `now`. */
export function taskBucket(task: TaskTiming, now: Date = new Date()): TaskBucket {
  if (task.status === 'DONE') return 'done';
  if (!task.dueAt) return 'someday';
  const due = task.dueAt.getTime();
  if (due < startOfDay(now)) return 'overdue';
  if (due <= endOfDay(now)) return 'today';
  return 'upcoming';
}

/** True when an open task's due date is before the start of today. */
export function isTaskOverdue(task: TaskTiming, now: Date = new Date()): boolean {
  return taskBucket(task, now) === 'overdue';
}

type TaskOrder = TaskTiming & { priority: TaskPriority; createdAt: Date };

/**
 * Stable comparator for a task list: open before done, then earliest due
 * first (no due date sorts last), then higher priority, then oldest first.
 * Suitable for `Array.prototype.sort`.
 */
export function compareTasks(a: TaskOrder, b: TaskOrder): number {
  if (a.status !== b.status) return a.status === 'OPEN' ? -1 : 1;
  const aDue = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  if (a.priority !== b.priority) return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Group a task list into the ordered buckets, each internally sorted by
 * {@link compareTasks}. The returned record always carries every bucket key,
 * so callers can iterate {@link TASK_BUCKETS} and skip the empty ones.
 */
export function groupTasksByBucket<T extends TaskOrder>(
  tasks: readonly T[],
  now: Date = new Date(),
): Record<TaskBucket, T[]> {
  const groups: Record<TaskBucket, T[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    someday: [],
    done: [],
  };
  for (const task of tasks) groups[taskBucket(task, now)].push(task);
  for (const bucket of TASK_BUCKETS) groups[bucket].sort(compareTasks);
  return groups;
}
