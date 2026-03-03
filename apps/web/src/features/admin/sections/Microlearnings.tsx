"use client";

import { useState, useRef, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ListOrdered,
  X,
  Users,
  Globe,
  FileText,
  MoreHorizontal,
  Tag,
  Hash,
  MessageSquare,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  api,
  type Microlearning,
  type MicrolearningSequence,
  type DnaTopic,
  type ConversationPattern,
  type Avatar,
  type UserGroup,
  type SequenceAssignment,
} from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UNASSIGNED = "unassigned";

function topicLabel(topicId: string | null, topics: DnaTopic[]): string {
  if (!topicId) return "";
  return topics.find((t) => t.id === topicId)?.name ?? "";
}

function subtopicLabel(ids: string[] | null, topics: DnaTopic[]): string {
  if (!ids || ids.length === 0) return "";
  const all = topics.flatMap((t) => t.subtopics);
  return ids.map((id) => all.find((s) => s.id === id)?.name).filter(Boolean).join(", ");
}

interface MetaParts {
  topic: string;
  subtopics: string;
  pattern: string;
  avatar: string;
}

function metaParts(ml: Microlearning, topics: DnaTopic[], patterns: ConversationPattern[], avatars: Avatar[]): MetaParts {
  return {
    topic: topicLabel(ml.topicId, topics),
    subtopics: subtopicLabel(ml.subtopicIds, topics),
    pattern: ml.patternId ? (patterns.find((x) => x.id === ml.patternId)?.name ?? "") : "",
    avatar: ml.avatarId ? (avatars.find((x) => x.id === ml.avatarId)?.name ?? "") : "",
  };
}

function StatusBadge({ status }: { status: "draft" | "published" }) {
  if (status === "published") {
    return (
      <Badge className="text-[10px] px-1.5 py-0 h-4 bg-green-100 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800 shrink-0">
        Published
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 shrink-0">
      Draft
    </Badge>
  );
}

// ─── Assign popover ───────────────────────────────────────────────────────────

function AssignPopover({ seqId }: { seqId: string }) {
  const queryClient = useQueryClient();

  const groupsQuery = useQuery({
    queryKey: ["user-groups"],
    queryFn: () => api.userGroups.list(),
  });

  const assignmentsQuery = useQuery({
    queryKey: ["seq-assignments", seqId],
    queryFn: () => api.sequences.listAssignments(seqId),
  });

  const assignMutation = useMutation({
    mutationFn: (groupId: string) => api.sequences.assign(seqId, groupId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["seq-assignments", seqId] }),
  });

  const unassignMutation = useMutation({
    mutationFn: (groupId: string) => api.sequences.unassign(seqId, groupId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["seq-assignments", seqId] }),
  });

  const groups: UserGroup[] = groupsQuery.data?.groups ?? [];
  const assignments: SequenceAssignment[] = assignmentsQuery.data?.assignments ?? [];
  const assignedGroupIds = new Set(assignments.map((a) => a.groupId));
  const assignedCount = assignments.length;

  function handleToggle(groupId: string) {
    if (assignedGroupIds.has(groupId)) {
      unassignMutation.mutate(groupId);
    } else {
      assignMutation.mutate(groupId);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <Users className="size-3" />
          {assignedCount > 0 ? `${assignedCount} group${assignedCount !== 1 ? "s" : ""}` : "Assign"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <p className="text-xs font-semibold mb-2.5 text-foreground">Assign to groups</p>
        {groupsQuery.isLoading || assignmentsQuery.isLoading ? (
          <div className="flex justify-center py-3">
            <Spinner className="size-4" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 leading-relaxed">
            No groups yet. Invite team members to auto-create the All Members group.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {groups.map((group) => {
              const checked = assignedGroupIds.has(group.id);
              const isMutating =
                (assignMutation.isPending && assignMutation.variables === group.id) ||
                (unassignMutation.isPending && unassignMutation.variables === group.id);
              return (
                <label
                  key={group.id}
                  className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-2 hover:bg-muted/60 transition-colors"
                >
                  {isMutating ? (
                    <Spinner className="size-3.5 shrink-0" />
                  ) : (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggle(group.id)}
                      className="rounded border-input"
                    />
                  )}
                  <span className="text-sm flex-1 truncate">{group.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{group.memberCount}</span>
                </label>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Styled select ────────────────────────────────────────────────────────────

function NativeSelect({ value, onChange, children, placeholder, disabled }: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
}

// ─── Microlearning form ───────────────────────────────────────────────────────

interface MlFormValues {
  title: string;
  topicId: string;
  subtopicIds: string[];
  patternId: string;
  avatarId: string;
}

function MlForm({
  initial = {},
  topics,
  patterns,
  avatars,
  onSave,
  onCancel,
  isLoading,
  submitLabel = "Save",
}: {
  initial?: Partial<MlFormValues>;
  topics: DnaTopic[];
  patterns: ConversationPattern[];
  avatars: Avatar[];
  onSave: (v: MlFormValues) => void;
  onCancel: () => void;
  isLoading: boolean;
  submitLabel?: string;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [topicId, setTopicId] = useState(initial.topicId ?? "");
  const [subtopicIds, setSubtopicIds] = useState<string[]>(initial.subtopicIds ?? []);
  const [patternId, setPatternId] = useState(initial.patternId ?? "");
  const [avatarId, setAvatarId] = useState(initial.avatarId ?? "");

  const selectedTopic = topics.find((t) => t.id === topicId);

  function handleTopicChange(id: string) {
    setTopicId(id);
    setSubtopicIds([]);
  }

  function toggleSubtopic(id: string) {
    setSubtopicIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/30">
      <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Topic <span className="text-destructive">*</span></label>
          <NativeSelect value={topicId} onChange={handleTopicChange} placeholder="Select topic">
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Pattern <span className="text-destructive">*</span></label>
          <NativeSelect value={patternId} onChange={setPatternId} placeholder="Select pattern">
            {patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </div>
      </div>

      {selectedTopic && selectedTopic.subtopics.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Subtopics</label>
          <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-background">
            {selectedTopic.subtopics.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={subtopicIds.includes(s.id)}
                  onChange={() => toggleSubtopic(s.id)}
                  className="rounded border-input"
                />
                <span className="text-sm">{s.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Avatar <span className="text-destructive">*</span></label>
        <NativeSelect value={avatarId} onChange={setAvatarId} placeholder="Select avatar">
          {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </NativeSelect>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={!title.trim() || !topicId || !patternId || !avatarId || isLoading} onClick={() => onSave({ title, topicId, subtopicIds, patternId, avatarId })}>
          {isLoading ? <Spinner className="size-3 mr-1" /> : null}
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Sequence name form ───────────────────────────────────────────────────────

function SequenceForm({ initial, onSave, onCancel, isLoading, submitLabel = "Create Sequence" }: {
  initial?: { name: string; description: string };
  onSave: (v: { name: string; description: string }) => void;
  onCancel: () => void;
  isLoading: boolean;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  return (
    <div className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/30">
      <Input placeholder="Sequence name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <Textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="resize-none text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={!name.trim() || isLoading} onClick={() => onSave({ name, description })}>
          {isLoading ? <Spinner className="size-3 mr-1" /> : null}
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Drop indicator line ──────────────────────────────────────────────────────

function DropLine({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <div className="h-0.5 rounded-full bg-primary mx-2" />;
}

// ─── ML row (draggable) ───────────────────────────────────────────────────────

interface MlRowProps {
  ml: Microlearning;
  index: number;
  groupId: string;
  dropTarget: { groupId: string; beforeIndex: number } | null;
  isDragging: boolean;
  isPending: boolean;
  topics: DnaTopic[];
  patterns: ConversationPattern[];
  avatars: Avatar[];
  sequences: MicrolearningSequence[];
  editingMlId: string | null;
  onDragStart: (mlId: string, fromGroup: string) => void;
  onDragOver: (e: React.DragEvent, groupId: string, index: number) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRemoveFromSequence?: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (values: MlFormValues) => void;
  isSavingEdit: boolean;
  onToggleStatus: () => void;
  isTogglingStatus: boolean;
  onDelete: () => void;
  isDeleting: boolean;
}

function MlRow({
  ml,
  index,
  groupId,
  dropTarget,
  isDragging,
  isPending,
  topics,
  patterns,
  avatars,
  sequences,
  editingMlId,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onRemoveFromSequence,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit,
  onToggleStatus,
  isTogglingStatus,
  onDelete,
  isDeleting,
}: MlRowProps) {
  const isEditing = editingMlId === ml.id;
  const meta = metaParts(ml, topics, patterns, avatars);

  if (isEditing) {
    return (
      <MlForm
        initial={{
          title: ml.title,
          topicId: ml.topicId ?? "",
          subtopicIds: ml.subtopicIds ?? [],
          patternId: ml.patternId ?? "",
          avatarId: ml.avatarId ?? "",
        }}
        topics={topics}
        patterns={patterns}
        avatars={avatars}
        onSave={onSaveEdit}
        onCancel={onCancelEdit}
        isLoading={isSavingEdit}
        submitLabel="Update"
      />
    );
  }

  const subtopicList = meta.subtopics ? meta.subtopics.split(", ").filter(Boolean) : [];

  // Detect per-category loading: id is set but label resolved to empty = data not yet loaded
  const topicLoading = !!ml.topicId && !meta.topic;
  const patternLoading = !!ml.patternId && !meta.pattern;
  const avatarLoading = !!ml.avatarId && !meta.avatar;
  const subtopicsLoading = !!(ml.subtopicIds?.length) && subtopicList.length === 0;

  const hasAnything = meta.topic || meta.pattern || meta.avatar || subtopicList.length > 0
    || topicLoading || patternLoading || avatarLoading || subtopicsLoading;

  return (
    <div
      draggable={!isEditing && !isPending}
      onDragStart={() => onDragStart(ml.id, groupId)}
      onDragOver={(e) => onDragOver(e, groupId, index)}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={[
        "flex items-center gap-3 rounded-lg border bg-card px-3 py-3 transition-opacity",
        isDragging || isPending ? "opacity-40" : "",
      ].join(" ")}
    >
      {/* Drag handle */}
      {isPending
        ? <Spinner className="size-4 shrink-0 text-muted-foreground" />
        : <GripVertical className="size-4 shrink-0 text-muted-foreground/40 cursor-grab active:cursor-grabbing hover:text-muted-foreground transition-colors" />
      }

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium leading-none">{ml.title}</span>
          <StatusBadge status={ml.status} />
        </div>
        {hasAnything && (
          <div className="flex items-center gap-1 flex-wrap">
            {/* Topic */}
            {topicLoading ? (
              <span className="inline-flex h-4 w-16 rounded bg-muted/50 animate-pulse" />
            ) : meta.topic && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                <Tag className="size-2.5 shrink-0" />
                {meta.topic}
              </span>
            )}
            {/* Subtopics */}
            {subtopicsLoading ? (
              <span className="inline-flex h-4 w-12 rounded bg-muted/40 animate-pulse" />
            ) : subtopicList.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-muted/50 text-muted-foreground/70"
              >
                <Hash className="size-2.5 shrink-0" />
                {s}
              </span>
            ))}
            {/* Pattern */}
            {patternLoading ? (
              <span className="inline-flex h-4 w-20 rounded bg-blue-500/10 animate-pulse" />
            ) : meta.pattern && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500 dark:text-blue-400">
                <MessageSquare className="size-2.5 shrink-0" />
                {meta.pattern}
              </span>
            )}
            {/* Avatar */}
            {avatarLoading ? (
              <span className="inline-flex h-4 w-14 rounded bg-violet-500/10 animate-pulse" />
            ) : meta.avatar && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/10 text-violet-500 dark:text-violet-400">
                <UserRound className="size-2.5 shrink-0" />
                {meta.avatar}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions — kebab menu, always visible */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            disabled={isTogglingStatus || isDeleting}
          >
            {isTogglingStatus || isDeleting
              ? <Spinner className="size-3.5" />
              : <MoreHorizontal className="size-4" />
            }
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onToggleStatus}>
            {ml.status === "draft"
              ? <><Globe className="size-3.5 mr-2" /> Publish</>
              : <><FileText className="size-3.5 mr-2" /> Unpublish</>
            }
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onStartEdit}>
            <Pencil className="size-3.5 mr-2" />
            Edit
          </DropdownMenuItem>
          {onRemoveFromSequence && (
            <DropdownMenuItem onClick={onRemoveFromSequence}>
              <X className="size-3.5 mr-2" />
              Remove from sequence
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function MicrolearningsSection() {
  const queryClient = useQueryClient();

  // Create form visibility
  const [creatingMl, setCreatingMl] = useState(false);
  const [creatingSeq, setCreatingSeq] = useState(false);

  // Inline editing
  const [editingMlId, setEditingMlId] = useState<string | null>(null);
  const [editingSeqId, setEditingSeqId] = useState<string | null>(null);

  // Drag state
  const dragRef = useRef<{ mlId: string; fromGroup: string } | null>(null);
  const [draggingMlId, setDraggingMlId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ groupId: string; beforeIndex: number } | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const mlQuery = useQuery({ queryKey: ["microlearnings"], queryFn: () => api.microlearnings.list() });
  const seqQuery = useQuery({ queryKey: ["ml-sequences"], queryFn: () => api.sequences.list() });
  const dnaQuery = useQuery({ queryKey: ["dna"], queryFn: () => api.dna.list() });
  const patternsQuery = useQuery({ queryKey: ["patterns"], queryFn: () => api.patterns.list() });
  const avatarsQuery = useQuery({ queryKey: ["avatars"], queryFn: () => api.avatars.list() });

  const mls = mlQuery.data?.microlearnings ?? [];
  const sequences = seqQuery.data?.sequences ?? [];
  const topics = dnaQuery.data?.topics ?? [];
  const patterns = patternsQuery.data?.patterns ?? [];
  const avatars = avatarsQuery.data?.avatars ?? [];
  const isLoading = mlQuery.isLoading || seqQuery.isLoading;

  const unassigned = mls.filter((m) => !m.sequenceId);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["microlearnings"] });
    queryClient.invalidateQueries({ queryKey: ["ml-sequences"] });
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMlMutation = useMutation({
    mutationFn: (v: MlFormValues) =>
      api.microlearnings.create({
        title: v.title,
        topicId: v.topicId || null,
        subtopicIds: v.subtopicIds,
        patternId: v.patternId || null,
        avatarId: v.avatarId || null,
        sequenceId: null,
      }),
    onSuccess: () => { invalidate(); setCreatingMl(false); },
  });

  const updateMlMutation = useMutation({
    mutationFn: ({ id, v }: { id: string; v: MlFormValues }) =>
      api.microlearnings.update(id, {
        title: v.title,
        topicId: v.topicId || null,
        subtopicIds: v.subtopicIds,
        patternId: v.patternId || null,
        avatarId: v.avatarId || null,
      }),
    onSuccess: () => { invalidate(); setEditingMlId(null); },
  });

  const deleteMlMutation = useMutation({
    mutationFn: (id: string) => api.microlearnings.delete(id),
    onSuccess: () => invalidate(),
  });

  const createSeqMutation = useMutation({
    mutationFn: (v: { name: string; description: string }) => api.sequences.create(v),
    onSuccess: () => { invalidate(); setCreatingSeq(false); },
  });

  const updateSeqMutation = useMutation({
    mutationFn: ({ id, v }: { id: string; v: { name: string; description: string } }) =>
      api.sequences.update(id, v),
    onSuccess: () => { invalidate(); setEditingSeqId(null); },
  });

  const deleteSeqMutation = useMutation({
    mutationFn: (id: string) => api.sequences.delete(id),
    onSuccess: () => invalidate(),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "draft" | "published" }) =>
      api.microlearnings.update(id, { status }),
    onSuccess: () => invalidate(),
  });

  const moveMutation = useMutation({
    mutationFn: async ({
      mlId,
      toGroup,
      newTargetOrder,
      fromGroup,
      newSourceOrder,
    }: {
      mlId: string;
      toGroup: string;
      newTargetOrder: string[];
      fromGroup: string;
      newSourceOrder: string[] | null;
    }) => {
      if (toGroup === UNASSIGNED) {
        await api.microlearnings.update(mlId, { sequenceId: null, position: null });
      } else {
        await api.sequences.reorder(toGroup, newTargetOrder);
      }
      if (newSourceOrder !== null && fromGroup !== UNASSIGNED) {
        await api.sequences.reorder(fromGroup, newSourceOrder);
      }
    },
    onSuccess: () => invalidate(),
  });

  const pendingMlId = moveMutation.isPending ? moveMutation.variables?.mlId : null;

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handleDragStart(mlId: string, fromGroup: string) {
    if (moveMutation.isPending) return;
    dragRef.current = { mlId, fromGroup };
    setDraggingMlId(mlId);
  }

  function handleDragOver(e: React.DragEvent, groupId: string, index: number) {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const beforeIndex = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
    setDropTarget({ groupId, beforeIndex });
  }

  function handleGroupDragOver(e: React.DragEvent, groupId: string, itemCount: number) {
    e.preventDefault();
    setDropTarget({ groupId, beforeIndex: itemCount });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!dragRef.current || !dropTarget) return;

    const { mlId, fromGroup } = dragRef.current;
    const { groupId: toGroup, beforeIndex } = dropTarget;

    dragRef.current = null;
    setDraggingMlId(null);
    setDropTarget(null);

    if (toGroup === UNASSIGNED) {
      if (fromGroup === UNASSIGNED) return;
      const srcSeq = sequences.find((s) => s.id === fromGroup);
      const newSourceOrder = srcSeq
        ? srcSeq.microlearnings.filter((m) => m.id !== mlId).map((m) => m.id)
        : null;
      moveMutation.mutate({ mlId, toGroup: UNASSIGNED, newTargetOrder: [], fromGroup, newSourceOrder });
      return;
    }

    const targetSeq = sequences.find((s) => s.id === toGroup);
    if (!targetSeq) return;

    if (fromGroup === toGroup) {
      const items = targetSeq.microlearnings;
      const fromIdx = items.findIndex((m) => m.id === mlId);
      if (fromIdx === -1) return;
      const withoutMl = items.filter((m) => m.id !== mlId).map((m) => m.id);
      const adjustedIdx = fromIdx < beforeIndex ? beforeIndex - 1 : beforeIndex;
      const clamped = Math.max(0, Math.min(adjustedIdx, withoutMl.length));
      withoutMl.splice(clamped, 0, mlId);
      if (withoutMl.join(",") === items.map((m) => m.id).join(",")) return;
      moveMutation.mutate({ mlId, toGroup, newTargetOrder: withoutMl, fromGroup, newSourceOrder: null });
    } else {
      const currentTargetIds = targetSeq.microlearnings.map((m) => m.id);
      const clamped = Math.max(0, Math.min(beforeIndex, currentTargetIds.length));
      const newTargetOrder = [...currentTargetIds.slice(0, clamped), mlId, ...currentTargetIds.slice(clamped)];

      let newSourceOrder: string[] | null = null;
      if (fromGroup !== UNASSIGNED) {
        const srcSeq = sequences.find((s) => s.id === fromGroup);
        newSourceOrder = srcSeq
          ? srcSeq.microlearnings.filter((m) => m.id !== mlId).map((m) => m.id)
          : null;
      }
      moveMutation.mutate({ mlId, toGroup, newTargetOrder, fromGroup, newSourceOrder });
    }
  }

  function handleDragEnd() {
    dragRef.current = null;
    setDraggingMlId(null);
    setDropTarget(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Microlearnings</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Drag microlearnings into sequences to organize them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!creatingMl && (
            <Button size="sm" variant="outline" onClick={() => setCreatingMl(true)}>
              <Plus className="size-3.5 mr-1.5" />
              New Microlearning
            </Button>
          )}
          {!creatingSeq && (
            <Button size="sm" onClick={() => setCreatingSeq(true)}>
              <Plus className="size-3.5 mr-1.5" />
              New Sequence
            </Button>
          )}
        </div>
      </div>

      {/* New sequence form */}
      {creatingSeq && (
        <SequenceForm
          onSave={(v) => createSeqMutation.mutate(v)}
          onCancel={() => setCreatingSeq(false)}
          isLoading={createSeqMutation.isPending}
        />
      )}

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {!isLoading && (
        <div className="space-y-8">

          {/* ── Sequences ─────────────────────────────────────────────────── */}
          {sequences.length === 0 && !creatingSeq && (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <ListOrdered className="size-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium">No sequences yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create a sequence to start organizing microlearnings.
              </p>
              <Button size="sm" className="mt-4" onClick={() => setCreatingSeq(true)}>
                <Plus className="size-3.5 mr-1.5" />
                New Sequence
              </Button>
            </div>
          )}

          {sequences.map((seq) => {
            const isEditingSeq = editingSeqId === seq.id;
            const seqMls = seq.microlearnings;
            const isDraggingOver = dropTarget?.groupId === seq.id;

            return (
              <div key={seq.id} className="rounded-xl border bg-muted/20 overflow-hidden">

                {/* Sequence header band */}
                <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
                  <ListOrdered className="size-4 shrink-0 text-muted-foreground" />

                  <div className="flex-1 min-w-0">
                    {isEditingSeq ? (
                      <SequenceForm
                        initial={{ name: seq.name, description: seq.description ?? "" }}
                        onSave={(v) => updateSeqMutation.mutate({ id: seq.id, v })}
                        onCancel={() => setEditingSeqId(null)}
                        isLoading={updateSeqMutation.isPending}
                        submitLabel="Save"
                      />
                    ) : (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-base leading-none">{seq.name}</span>
                          <Badge variant="secondary" className="text-xs tabular-nums">
                            {seqMls.length} ML{seqMls.length !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        {seq.description && (
                          <p className="text-xs text-muted-foreground mt-1">{seq.description}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {!isEditingSeq && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <AssignPopover seqId={seq.id} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onClick={() => setEditingSeqId(seq.id)}
                        title="Edit sequence"
                        aria-label="Edit sequence"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        disabled={deleteSeqMutation.isPending && deleteSeqMutation.variables === seq.id}
                        onClick={() => deleteSeqMutation.mutate(seq.id)}
                        title="Delete sequence"
                        aria-label="Delete sequence"
                      >
                        {deleteSeqMutation.isPending && deleteSeqMutation.variables === seq.id
                          ? <Spinner className="size-3.5" />
                          : <Trash2 className="size-3.5" />}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Sequence ML list */}
                <div
                  onDragOver={(e) => handleGroupDragOver(e, seq.id, seqMls.length)}
                  onDrop={handleDrop}
                  className={[
                    "p-2 space-y-1.5 min-h-16 transition-colors",
                    isDraggingOver && seqMls.length === 0 ? "bg-primary/5" : "",
                  ].join(" ")}
                >
                  {seqMls.length === 0 && !isDraggingOver && (
                    <div className="flex items-center justify-center h-12">
                      <p className="text-xs text-muted-foreground/60 italic">
                        Drop microlearnings here
                      </p>
                    </div>
                  )}

                  {seqMls.map((ml, index) => (
                    <Fragment key={ml.id}>
                      <DropLine visible={dropTarget?.groupId === seq.id && dropTarget.beforeIndex === index} />
                      <MlRow
                        ml={ml}
                        index={index}
                        groupId={seq.id}
                        dropTarget={dropTarget}
                        isDragging={draggingMlId === ml.id}
                        isPending={pendingMlId === ml.id}
                        topics={topics}
                        patterns={patterns}
                        avatars={avatars}
                        sequences={sequences}
                        editingMlId={editingMlId}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        onRemoveFromSequence={() =>
                          moveMutation.mutate({
                            mlId: ml.id,
                            toGroup: UNASSIGNED,
                            newTargetOrder: [],
                            fromGroup: seq.id,
                            newSourceOrder: seqMls.filter((m) => m.id !== ml.id).map((m) => m.id),
                          })
                        }
                        onStartEdit={() => setEditingMlId(ml.id)}
                        onCancelEdit={() => setEditingMlId(null)}
                        onSaveEdit={(v) => updateMlMutation.mutate({ id: ml.id, v })}
                        isSavingEdit={updateMlMutation.isPending && updateMlMutation.variables?.id === ml.id}
                        onToggleStatus={() =>
                          toggleStatusMutation.mutate({
                            id: ml.id,
                            status: ml.status === "draft" ? "published" : "draft",
                          })
                        }
                        isTogglingStatus={toggleStatusMutation.isPending && toggleStatusMutation.variables?.id === ml.id}
                        onDelete={() => deleteMlMutation.mutate(ml.id)}
                        isDeleting={deleteMlMutation.isPending && deleteMlMutation.variables === ml.id}
                      />
                    </Fragment>
                  ))}
                  <DropLine visible={dropTarget?.groupId === seq.id && dropTarget.beforeIndex === seqMls.length} />
                </div>
              </div>
            );
          })}

          {/* ── Unassigned ────────────────────────────────────────────────── */}
          {(sequences.length > 0 || unassigned.length > 0) && (
            <Separator />
          )}

          <div
            onDragOver={(e) => handleGroupDragOver(e, UNASSIGNED, unassigned.length)}
            onDrop={handleDrop}
          >
            {/* Unassigned header */}
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="size-4 text-muted-foreground/60" />
              <span className="text-sm font-medium text-muted-foreground/80 italic">Unassigned</span>
              {unassigned.length > 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground border-dashed">
                  {unassigned.length}
                </Badge>
              )}
            </div>

            {/* Unassigned list */}
            <div
              className={[
                "space-y-1.5",
                draggingMlId
                  ? "min-h-14 rounded-xl border border-dashed p-2 transition-colors"
                  : "",
                draggingMlId && dropTarget?.groupId === UNASSIGNED
                  ? "border-primary bg-primary/5"
                  : draggingMlId
                    ? "border-border"
                    : "",
              ].join(" ")}
            >
              {unassigned.length === 0 && !draggingMlId && (
                <p className="text-xs text-muted-foreground/60 italic py-1">
                  All microlearnings are assigned to sequences.
                </p>
              )}

              {unassigned.map((ml, index) => (
                <Fragment key={ml.id}>
                  <DropLine visible={dropTarget?.groupId === UNASSIGNED && dropTarget.beforeIndex === index} />
                  <MlRow
                    ml={ml}
                    index={index}
                    groupId={UNASSIGNED}
                    dropTarget={dropTarget}
                    isDragging={draggingMlId === ml.id}
                    isPending={pendingMlId === ml.id}
                    topics={topics}
                    patterns={patterns}
                    avatars={avatars}
                    sequences={sequences}
                    editingMlId={editingMlId}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onStartEdit={() => setEditingMlId(ml.id)}
                    onCancelEdit={() => setEditingMlId(null)}
                    onSaveEdit={(v) => updateMlMutation.mutate({ id: ml.id, v })}
                    isSavingEdit={updateMlMutation.isPending && updateMlMutation.variables?.id === ml.id}
                    onToggleStatus={() =>
                      toggleStatusMutation.mutate({
                        id: ml.id,
                        status: ml.status === "draft" ? "published" : "draft",
                      })
                    }
                    isTogglingStatus={toggleStatusMutation.isPending && toggleStatusMutation.variables?.id === ml.id}
                    onDelete={() => deleteMlMutation.mutate(ml.id)}
                    isDeleting={deleteMlMutation.isPending && deleteMlMutation.variables === ml.id}
                  />
                </Fragment>
              ))}
              <DropLine visible={dropTarget?.groupId === UNASSIGNED && dropTarget.beforeIndex === unassigned.length} />
            </div>

            {/* New microlearning form / button */}
            <div className="mt-3">
              {creatingMl ? (
                <MlForm
                  topics={topics}
                  patterns={patterns}
                  avatars={avatars}
                  onSave={(v) => createMlMutation.mutate(v)}
                  onCancel={() => setCreatingMl(false)}
                  isLoading={createMlMutation.isPending}
                  submitLabel="Create Microlearning"
                />
              ) : (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setCreatingMl(true)}>
                  <Plus className="size-3.5 mr-1.5" />
                  New Microlearning
                </Button>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
