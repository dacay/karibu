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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  api,
  type Microlearning,
  type MicrolearningSequence,
  type DnaTopic,
  type ConversationPattern,
  type Avatar,
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

function metaLine(ml: Microlearning, topics: DnaTopic[], patterns: ConversationPattern[], avatars: Avatar[]): string {
  const parts: string[] = [];
  const t = topicLabel(ml.topicId, topics);
  const s = subtopicLabel(ml.subtopicIds, topics);
  const p = ml.patternId ? (patterns.find((x) => x.id === ml.patternId)?.name ?? "") : "";
  const a = ml.avatarId ? (avatars.find((x) => x.id === ml.avatarId)?.name ?? "") : "";
  if (t) parts.push(t);
  if (s) parts.push(s);
  if (p) parts.push(p);
  if (a) parts.push(a);
  return parts.join(" · ");
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
          <label className="text-xs font-medium text-muted-foreground">Topic</label>
          <NativeSelect value={topicId} onChange={handleTopicChange} placeholder="No topic">
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Pattern</label>
          <NativeSelect value={patternId} onChange={setPatternId} placeholder="No pattern">
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
        <label className="text-xs font-medium text-muted-foreground">Avatar</label>
        <NativeSelect value={avatarId} onChange={setAvatarId} placeholder="No avatar">
          {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </NativeSelect>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={!title.trim() || isLoading} onClick={() => onSave({ title, topicId, subtopicIds, patternId, avatarId })}>
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
  onDelete: () => void;
  isDeleting: boolean;
}

function MlRow({
  ml,
  index,
  groupId,
  dropTarget,
  isDragging,
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
  onDelete,
  isDeleting,
}: MlRowProps) {
  const isEditing = editingMlId === ml.id;
  const meta = metaLine(ml, topics, patterns, avatars);

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

  return (
    <div
      draggable={!isEditing}
      onDragStart={() => onDragStart(ml.id, groupId)}
      onDragOver={(e) => onDragOver(e, groupId, index)}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={[
        "group flex items-center gap-2 rounded-md border bg-card px-3 py-2.5 transition-opacity",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
    >
      <GripVertical className="size-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{ml.title}</p>
        {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onStartEdit}
          aria-label="Edit"
        >
          <Pencil className="size-3.5" />
        </Button>
        {onRemoveFromSequence ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onRemoveFromSequence}
            aria-label="Remove from sequence"
          >
            <X className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            disabled={isDeleting}
            onClick={onDelete}
            aria-label="Delete"
          >
            {isDeleting ? <Spinner className="size-3.5" /> : <Trash2 className="size-3.5" />}
          </Button>
        )}
      </div>
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
  const seqQuery = useQuery({ queryKey: ["ml-sequences"], queryFn: () => api.microlearnings.listSequences() });
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
    mutationFn: (v: { name: string; description: string }) => api.microlearnings.createSequence(v),
    onSuccess: () => { invalidate(); setCreatingSeq(false); },
  });

  const updateSeqMutation = useMutation({
    mutationFn: ({ id, v }: { id: string; v: { name: string; description: string } }) =>
      api.microlearnings.updateSequence(id, v),
    onSuccess: () => { invalidate(); setEditingSeqId(null); },
  });

  const deleteSeqMutation = useMutation({
    mutationFn: (id: string) => api.microlearnings.deleteSequence(id),
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
        await api.microlearnings.reorderSequence(toGroup, newTargetOrder);
      }
      if (newSourceOrder !== null && fromGroup !== UNASSIGNED) {
        await api.microlearnings.reorderSequence(fromGroup, newSourceOrder);
      }
    },
    onSuccess: () => invalidate(),
  });

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handleDragStart(mlId: string, fromGroup: string) {
    dragRef.current = { mlId, fromGroup };
    setDraggingMlId(mlId);
  }

  function handleDragOver(e: React.DragEvent, groupId: string, index: number) {
    e.preventDefault();
    e.stopPropagation(); // prevent group-level handler from overriding
    const rect = e.currentTarget.getBoundingClientRect();
    const beforeIndex = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
    setDropTarget({ groupId, beforeIndex });
  }

  function handleGroupDragOver(e: React.DragEvent, groupId: string, itemCount: number) {
    e.preventDefault();
    // Only fires if no item handler called stopPropagation (i.e. hovering over gap / header / empty area)
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

    // Moving to unassigned
    if (toGroup === UNASSIGNED) {
      if (fromGroup === UNASSIGNED) return; // already unassigned, no-op
      const srcSeq = sequences.find((s) => s.id === fromGroup);
      const newSourceOrder = srcSeq
        ? srcSeq.microlearnings.filter((m) => m.id !== mlId).map((m) => m.id)
        : null;
      moveMutation.mutate({ mlId, toGroup: UNASSIGNED, newTargetOrder: [], fromGroup, newSourceOrder });
      return;
    }

    // Moving to a sequence
    const targetSeq = sequences.find((s) => s.id === toGroup);
    if (!targetSeq) return;

    if (fromGroup === toGroup) {
      // Reorder within same sequence
      const items = targetSeq.microlearnings;
      const fromIdx = items.findIndex((m) => m.id === mlId);
      if (fromIdx === -1) return;
      const withoutMl = items.filter((m) => m.id !== mlId).map((m) => m.id);
      const adjustedIdx = fromIdx < beforeIndex ? beforeIndex - 1 : beforeIndex;
      const clamped = Math.max(0, Math.min(adjustedIdx, withoutMl.length));
      withoutMl.splice(clamped, 0, mlId);
      // No-op if order didn't change
      if (withoutMl.join(",") === items.map((m) => m.id).join(",")) return;
      moveMutation.mutate({ mlId, toGroup, newTargetOrder: withoutMl, fromGroup, newSourceOrder: null });
    } else {
      // Cross-group move
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
    <div className="space-y-6">
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
              <Plus className="size-4 mr-1" />
              New Microlearning
            </Button>
          )}
          {!creatingSeq && (
            <Button size="sm" onClick={() => setCreatingSeq(true)}>
              <Plus className="size-4 mr-1" />
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
        <div className="space-y-6">

          {/* ── Sequences ─────────────────────────────────────────────────── */}
          {sequences.length === 0 && !creatingSeq && (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <ListOrdered className="size-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground">No sequences yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create a sequence to start organizing microlearnings.
              </p>
              <Button size="sm" className="mt-3" onClick={() => setCreatingSeq(true)}>
                <Plus className="size-3 mr-1" />
                New Sequence
              </Button>
            </div>
          )}

          {sequences.map((seq) => {
            const isEditingSeq = editingSeqId === seq.id;
            const seqMls = seq.microlearnings;
            const isDraggingOver = dropTarget?.groupId === seq.id;

            return (
              <div key={seq.id}>
                {/* Sequence header */}
                <div className="flex items-start gap-2 mb-3 group/seq">
                  <ListOrdered className="size-4 shrink-0 text-muted-foreground mt-0.5" />

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
                      <>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{seq.name}</span>
                          <Badge variant="secondary" className="text-xs">
                            {seqMls.length} ML{seqMls.length !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        {seq.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{seq.description}</p>
                        )}
                      </>
                    )}
                  </div>

                  {!isEditingSeq && (
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/seq:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground"
                        onClick={() => setEditingSeqId(seq.id)}
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
                        aria-label="Delete sequence"
                      >
                        {deleteSeqMutation.isPending && deleteSeqMutation.variables === seq.id
                          ? <Spinner className="size-3.5" />
                          : <Trash2 className="size-3.5" />}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Sequence ML list — drop target */}
                <div
                  onDragOver={(e) => handleGroupDragOver(e, seq.id, seqMls.length)}
                  onDrop={handleDrop}
                  className={[
                    "ml-6 rounded-lg border transition-colors space-y-1 p-1.5 min-h-14",
                    isDraggingOver && !dropTarget?.beforeIndex && seqMls.length === 0
                      ? "border-primary bg-primary/5"
                      : "border-border",
                  ].join(" ")}
                >
                  {seqMls.length === 0 && !isDraggingOver && (
                    <div className="flex items-center justify-center h-10">
                      <p className="text-xs text-muted-foreground">
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

          <div>
            {/* Unassigned header */}
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Unassigned</span>
              {unassigned.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {unassigned.length}
                </Badge>
              )}
            </div>

            {/* Unassigned list — also a drop target */}
            <div
              onDragOver={(e) => handleGroupDragOver(e, UNASSIGNED, unassigned.length)}
              onDrop={handleDrop}
              className={[
                "space-y-1",
                draggingMlId && dropTarget?.groupId === UNASSIGNED && unassigned.length === 0
                  ? "rounded-lg border border-dashed border-primary/50 bg-primary/5 p-2 min-h-12"
                  : "",
              ].join(" ")}
            >
              {unassigned.length === 0 && !draggingMlId && (
                <p className="text-xs text-muted-foreground py-1">
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
                  <Plus className="size-3 mr-1" />
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
