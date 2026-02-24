"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Copy, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { api, type ConversationPattern } from "@/lib/api";

// ─── Pattern form ─────────────────────────────────────────────────────────────

interface PatternFormProps {
  initialName?: string;
  initialDescription?: string;
  initialPrompt?: string;
  onSave: (values: { name: string; description: string; prompt: string }) => void;
  onCancel: () => void;
  isLoading: boolean;
  submitLabel?: string;
}

function PatternForm({
  initialName = "",
  initialDescription = "",
  initialPrompt = "",
  onSave,
  onCancel,
  isLoading,
  submitLabel = "Save",
}: PatternFormProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [prompt, setPrompt] = useState(initialPrompt);

  const valid = name.trim().length > 0 && prompt.trim().length > 0;

  return (
    <div className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/30">
      <Input
        placeholder="Pattern name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Input
        placeholder="Short description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Textarea
        placeholder="Conversation prompt — describe how the AI should behave, what role it plays, and how it references the DNA source of truth."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={6}
        className="resize-none text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={!valid || isLoading} onClick={() => onSave({ name, description, prompt })}>
          {isLoading ? <Spinner className="size-3 mr-1" /> : null}
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Pattern card ─────────────────────────────────────────────────────────────

interface PatternCardProps {
  pattern: ConversationPattern;
  onUseAsTemplate: (pattern: ConversationPattern) => void;
}

function PatternCard({ pattern, onUseAsTemplate }: PatternCardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (values: { name: string; description: string; prompt: string }) =>
      api.patterns.update(pattern.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patterns"] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.patterns.delete(pattern.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patterns"] }),
  });

  if (editing) {
    return (
      <PatternForm
        initialName={pattern.name}
        initialDescription={pattern.description}
        initialPrompt={pattern.prompt}
        onSave={(values) => updateMutation.mutate(values)}
        onCancel={() => setEditing(false)}
        isLoading={updateMutation.isPending}
        submitLabel="Update"
      />
    );
  }

  return (
    <Card className="group">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base">{pattern.name}</CardTitle>
            {pattern.isBuiltIn && (
              <Badge variant="secondary" className="text-xs">Built-in</Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {pattern.isBuiltIn ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground h-7 gap-1"
                onClick={() => onUseAsTemplate(pattern)}
              >
                <Copy className="size-3" />
                Use as template
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setEditing(true)}
                  aria-label="Edit pattern"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                  aria-label="Delete pattern"
                >
                  {deleteMutation.isPending ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
        {pattern.description && (
          <p className="text-sm text-muted-foreground">{pattern.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed border rounded-md p-3 bg-muted/30">
          {pattern.prompt}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function PatternsSection() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [templateValues, setTemplateValues] = useState<Partial<ConversationPattern> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["patterns"],
    queryFn: () => api.patterns.list(),
  });

  const createMutation = useMutation({
    mutationFn: (values: { name: string; description: string; prompt: string }) =>
      api.patterns.create(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patterns"] });
      setCreating(false);
      setTemplateValues(null);
    },
  });

  const patterns = data?.patterns ?? [];
  const builtIn = patterns.filter((p) => p.isBuiltIn);
  const custom = patterns.filter((p) => !p.isBuiltIn);

  function handleUseAsTemplate(pattern: ConversationPattern) {
    setTemplateValues(pattern);
    setCreating(true);
  }

  function handleCancelCreate() {
    setCreating(false);
    setTemplateValues(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Conversation Patterns</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Define how the AI engages with learners during microlearning sessions.
          </p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4 mr-1" />
            New Pattern
          </Button>
        )}
      </div>

      {creating && (
        <PatternForm
          initialName={templateValues ? `${templateValues.name} (copy)` : ""}
          initialDescription={templateValues?.description ?? ""}
          initialPrompt={templateValues?.prompt ?? ""}
          onSave={(values) => createMutation.mutate(values)}
          onCancel={handleCancelCreate}
          isLoading={createMutation.isPending}
          submitLabel="Create Pattern"
        />
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {!isLoading && (
        <>
          {/* Built-in patterns */}
          {builtIn.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Built-in Patterns
              </h3>
              {builtIn.map((pattern) => (
                <PatternCard
                  key={pattern.id}
                  pattern={pattern}
                  onUseAsTemplate={handleUseAsTemplate}
                />
              ))}
            </div>
          )}

          {builtIn.length > 0 && custom.length > 0 && <Separator />}

          {/* Custom patterns */}
          {custom.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Your Patterns
              </h3>
              {custom.map((pattern) => (
                <PatternCard
                  key={pattern.id}
                  pattern={pattern}
                  onUseAsTemplate={handleUseAsTemplate}
                />
              ))}
            </div>
          )}

          {/* Empty state — only shown when there are no custom patterns and no built-ins loaded yet */}
          {patterns.length === 0 && !creating && (
            <Card className="min-h-64 flex flex-col items-center justify-center gap-3">
              <MessageSquare className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                No patterns yet. Create one to define how the AI converses with learners.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
