import { describe, expect, it } from 'vitest';

import {
  compareTasks,
  groupTasksByBucket,
  isTaskOverdue,
  TASK_BUCKETS,
  taskBucket,
  taskPrioritySchema,
  taskStatusSchema,
  taskTypeSchema,
} from '../src/tasks';

// Noon on a fixed local day. Due dates below are constructed in the same
// local time zone, so day-boundary math is deterministic anywhere.
const now = new Date('2026-06-09T12:00:00');

describe('taskBucket', () => {
  it('files a done task under done regardless of due date', () => {
    expect(taskBucket({ status: 'DONE', dueAt: null }, now)).toBe('done');
    expect(taskBucket({ status: 'DONE', dueAt: new Date('2020-01-01T00:00:00') }, now)).toBe(
      'done',
    );
  });

  it('files an open task with no due date under someday', () => {
    expect(taskBucket({ status: 'OPEN', dueAt: null }, now)).toBe('someday');
  });

  it('files an open task due before today under overdue', () => {
    expect(taskBucket({ status: 'OPEN', dueAt: new Date('2026-06-08T23:00:00') }, now)).toBe(
      'overdue',
    );
  });

  it('files an open task due any time today under today, even if the hour passed', () => {
    expect(taskBucket({ status: 'OPEN', dueAt: new Date('2026-06-09T08:00:00') }, now)).toBe(
      'today',
    );
    expect(taskBucket({ status: 'OPEN', dueAt: new Date('2026-06-09T23:59:59.999') }, now)).toBe(
      'today',
    );
  });

  it('files an open task due after today under upcoming', () => {
    expect(taskBucket({ status: 'OPEN', dueAt: new Date('2026-06-10T00:00:00') }, now)).toBe(
      'upcoming',
    );
  });
});

describe('isTaskOverdue', () => {
  it('is true only for open tasks past the start of today', () => {
    expect(isTaskOverdue({ status: 'OPEN', dueAt: new Date('2026-06-08T23:00:00') }, now)).toBe(
      true,
    );
    expect(isTaskOverdue({ status: 'OPEN', dueAt: new Date('2026-06-09T08:00:00') }, now)).toBe(
      false,
    );
    // A past-due task that is already done is not overdue.
    expect(isTaskOverdue({ status: 'DONE', dueAt: new Date('2026-06-08T23:00:00') }, now)).toBe(
      false,
    );
  });
});

describe('compareTasks', () => {
  const base = { priority: 'MEDIUM' as const, createdAt: new Date('2026-01-01T00:00:00') };

  it('sorts open tasks before done tasks', () => {
    const open = { ...base, status: 'OPEN' as const, dueAt: null };
    const done = { ...base, status: 'DONE' as const, dueAt: null };
    expect(compareTasks(open, done)).toBeLessThan(0);
    expect(compareTasks(done, open)).toBeGreaterThan(0);
  });

  it('sorts earlier due dates first, with no due date last', () => {
    const soon = { ...base, status: 'OPEN' as const, dueAt: new Date('2026-06-09T09:00:00') };
    const later = { ...base, status: 'OPEN' as const, dueAt: new Date('2026-06-20T09:00:00') };
    const someday = { ...base, status: 'OPEN' as const, dueAt: null };
    const sorted = [someday, later, soon].sort(compareTasks);
    expect(sorted).toEqual([soon, later, someday]);
  });

  it('breaks due-date ties by priority, then by creation order', () => {
    const due = new Date('2026-06-09T09:00:00');
    const high = { status: 'OPEN' as const, dueAt: due, priority: 'HIGH' as const, createdAt: due };
    const low = { status: 'OPEN' as const, dueAt: due, priority: 'LOW' as const, createdAt: due };
    expect(compareTasks(high, low)).toBeLessThan(0);

    const older = {
      status: 'OPEN' as const,
      dueAt: due,
      priority: 'MEDIUM' as const,
      createdAt: new Date('2026-01-01T00:00:00'),
    };
    const newer = {
      status: 'OPEN' as const,
      dueAt: due,
      priority: 'MEDIUM' as const,
      createdAt: new Date('2026-02-01T00:00:00'),
    };
    expect(compareTasks(older, newer)).toBeLessThan(0);
  });
});

describe('groupTasksByBucket', () => {
  it('returns every bucket key and sorts each section', () => {
    const tasks = [
      {
        id: 'a',
        status: 'OPEN' as const,
        dueAt: new Date('2026-06-20T09:00:00'),
        priority: 'LOW' as const,
        createdAt: now,
      },
      {
        id: 'b',
        status: 'OPEN' as const,
        dueAt: new Date('2026-06-09T20:00:00'),
        priority: 'HIGH' as const,
        createdAt: now,
      },
      {
        id: 'c',
        status: 'OPEN' as const,
        dueAt: new Date('2026-06-08T09:00:00'),
        priority: 'MEDIUM' as const,
        createdAt: now,
      },
      {
        id: 'd',
        status: 'DONE' as const,
        dueAt: null,
        priority: 'MEDIUM' as const,
        createdAt: now,
      },
      {
        id: 'e',
        status: 'OPEN' as const,
        dueAt: null,
        priority: 'MEDIUM' as const,
        createdAt: now,
      },
    ];
    const groups = groupTasksByBucket(tasks, now);
    expect(Object.keys(groups).sort()).toEqual([...TASK_BUCKETS].sort());
    expect(groups.overdue.map((t) => t.id)).toEqual(['c']);
    expect(groups.today.map((t) => t.id)).toEqual(['b']);
    expect(groups.upcoming.map((t) => t.id)).toEqual(['a']);
    expect(groups.someday.map((t) => t.id)).toEqual(['e']);
    expect(groups.done.map((t) => t.id)).toEqual(['d']);
  });
});

describe('task schemas', () => {
  it('accept the known vocabularies and reject anything else', () => {
    expect(taskTypeSchema.parse('CALL')).toBe('CALL');
    expect(taskPrioritySchema.parse('HIGH')).toBe('HIGH');
    expect(taskStatusSchema.parse('DONE')).toBe('DONE');
    expect(taskTypeSchema.safeParse('SMOKE_SIGNAL').success).toBe(false);
    expect(taskPrioritySchema.safeParse('URGENT').success).toBe(false);
    expect(taskStatusSchema.safeParse('ARCHIVED').success).toBe(false);
  });
});
