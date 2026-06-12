'use client';

import {
  groupTasksByBucket,
  TASK_BUCKETS,
  TASK_PRIORITIES,
  TASK_TYPES,
  type TaskPriority,
  type TaskType,
} from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@helio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import { cn } from '@helio/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  Handshake,
  ListTodo,
  Mail,
  Pencil,
  Phone,
  Plus,
  Trash2,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ThemedSelect } from '@/components/themed-select';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const TYPE_ICON: Record<TaskType, typeof ListTodo> = {
  TODO: ClipboardList,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: CalendarClock,
};

const PRIORITY_TONE: Record<TaskPriority, 'destructive' | 'secondary' | 'outline'> = {
  HIGH: 'destructive',
  MEDIUM: 'secondary',
  LOW: 'outline',
};

function formatDue(due: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(due);
}

export function TasksView() {
  const t = useTranslations('tasks');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType>('TODO');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');

  const tasksQuery = useQuery({
    ...trpc.crm.tasks.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });

  const createTask = useMutation(trpc.crm.createTask.mutationOptions());
  const updateTask = useMutation(trpc.crm.updateTask.mutationOptions());
  const setTaskStatus = useMutation(trpc.crm.setTaskStatus.mutationOptions());
  const deleteTask = useMutation(trpc.crm.deleteTask.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.crm.tasks.pathFilter());

  function resetForm() {
    setTitle('');
    setType('TODO');
    setPriority('MEDIUM');
    setDue('');
    setNotes('');
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !title.trim()) return;
    try {
      if (editingId) {
        await updateTask.mutateAsync({
          id: editingId,
          title: title.trim(),
          type,
          priority,
          dueAt: due ? new Date(due) : null,
          notes: notes.trim() ? notes.trim() : null,
        });
      } else {
        await createTask.mutateAsync({
          workspaceId,
          title: title.trim(),
          type,
          priority,
          // A date input yields YYYY-MM-DD; treat it as that day's due date.
          dueAt: due ? new Date(due) : null,
          notes: notes.trim() ? notes.trim() : null,
        });
      }
      await invalidate();
      toast.success(editingId ? t('taskUpdated') : t('taskCreated'));
      setCreateOpen(false);
      setEditingId(null);
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onToggle(id: string, status: 'OPEN' | 'DONE') {
    try {
      await setTaskStatus.mutateAsync({ id, status: status === 'DONE' ? 'OPEN' : 'DONE' });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteTask.mutateAsync({ id });
      await invalidate();
      toast.success(t('taskDeleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!workspaceId || tasksQuery.isLoading) {
    return <Skeleton className="h-72" data-testid="tasks-loading" />;
  }

  const tasks = tasksQuery.data ?? [];
  const groups = groupTasksByBucket(tasks);

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <ListTodo className="text-primary size-5" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="new-task">
            <Plus aria-hidden /> {t('newTask')}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">{t('subtitle')}</p>

      {tasks.length === 0 ? (
        <Card data-testid="tasks-empty">
          <CardHeader>
            <CardTitle className="text-base">{t('emptyTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">{t('emptyBody')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5" data-testid="task-list">
          {TASK_BUCKETS.filter((bucket) => groups[bucket].length > 0).map((bucket) => (
            <section key={bucket} className="grid gap-2" aria-label={t(`bucket.${bucket}`)}>
              <h2
                className={cn(
                  'text-xs font-semibold tracking-wide uppercase',
                  bucket === 'overdue' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {t(`bucket.${bucket}`)}
                <span className="ml-2 tabular-nums opacity-70">{groups[bucket].length}</span>
              </h2>
              {groups[bucket].map((task) => {
                const Icon = TYPE_ICON[task.type];
                const done = task.status === 'DONE';
                return (
                  <div
                    key={task.id}
                    className="bg-background flex items-center gap-3 rounded-md border p-3 text-sm shadow-xs"
                    data-testid="task-row"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={
                        done
                          ? t('reopen', { title: task.title })
                          : t('markDone', { title: task.title })
                      }
                      onClick={() => onToggle(task.id, task.status)}
                    >
                      {done ? (
                        <CheckCircle2 className="text-primary size-5" aria-hidden />
                      ) : (
                        <Circle className="text-muted-foreground size-5" aria-hidden />
                      )}
                    </Button>

                    <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />

                    <div className="grid min-w-0 grow gap-0.5">
                      <span
                        className={cn(
                          'truncate font-medium',
                          done && 'text-muted-foreground line-through',
                        )}
                      >
                        {task.title}
                      </span>
                      {task.notes && (
                        <span className="text-muted-foreground truncate text-xs">{task.notes}</span>
                      )}
                      {(task.contact?.email || task.deal?.title) && (
                        <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                          {task.contact?.email && (
                            <span className="flex items-center gap-1">
                              <User className="size-3" aria-hidden /> {task.contact.email}
                            </span>
                          )}
                          {task.deal?.title && (
                            <span className="flex items-center gap-1">
                              <Handshake className="size-3" aria-hidden /> {task.deal.title}
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {task.dueAt && (
                      <span
                        className={cn(
                          'shrink-0 text-xs tabular-nums',
                          bucket === 'overdue'
                            ? 'text-destructive font-medium'
                            : 'text-muted-foreground',
                        )}
                      >
                        {formatDue(task.dueAt)}
                      </span>
                    )}
                    <Badge variant={PRIORITY_TONE[task.priority]} className="shrink-0">
                      {t(`priority.${task.priority}`)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={t('editTask', { title: task.title })}
                      onClick={() => {
                        setEditingId(task.id);
                        setTitle(task.title);
                        setType(task.type);
                        setPriority(task.priority);
                        setDue(task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : '');
                        setNotes(task.notes ?? '');
                        setCreateOpen(true);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={t('deleteTask', { title: task.title })}
                      onClick={() => onDelete(task.id)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setEditingId(null);
            resetForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? t('editTaskTitle') : t('newTask')}</DialogTitle>
            <DialogDescription>{t('newTaskSubtitle')}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={onCreate}>
            <div className="grid gap-2">
              <Label htmlFor="task-title">{t('taskTitle')}</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="task-type">{t('taskType')}</Label>
                <ThemedSelect
                  id="task-type"
                  value={type}
                  onValueChange={(value) => setType(value as TaskType)}
                  className="w-full"
                  options={TASK_TYPES.map((value) => ({
                    value,
                    label: t(`type.${value}`),
                  }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="task-priority">{t('taskPriority')}</Label>
                <ThemedSelect
                  id="task-priority"
                  value={priority}
                  onValueChange={(value) => setPriority(value as TaskPriority)}
                  className="w-full"
                  options={TASK_PRIORITIES.map((value) => ({
                    value,
                    label: t(`priority.${value}`),
                  }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-due">{t('taskDue')}</Label>
              <Input
                id="task-due"
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-notes">{t('taskNotes')}</Label>
              <textarea
                id="task-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={2000}
                rows={3}
                className={cn(
                  'border-input bg-transparent dark:bg-input/30 rounded-md border px-3 py-2 text-sm shadow-xs outline-none',
                  'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                )}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createTask.isPending || !title.trim()}>
                {editingId ? t('saveTask') : t('createTask')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {t('cancel')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
