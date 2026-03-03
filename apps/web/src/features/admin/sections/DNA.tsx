"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dna,
  Upload,
  Trash2,
  FileText,
  AlertCircle,
  Plus,
  Check,
  X,
  Wand2,
  Pencil,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { api, type Document, type DnaTopic, type DnaSubtopic, type DnaValue } from "@/lib/api";

// ─── Document helpers ────────────────────────────────────────────────────────

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];
const ACCEPTED_EXTENSIONS = ".pdf,.doc,.docx,.txt,.md";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function documentStatusBadge(status: Document["status"]) {
  if (status === "processed")
    return <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 hover:bg-green-100">Processed</Badge>;
  if (status === "processing")
    return <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-100">Processing</Badge>;
  if (status === "failed")
    return <Badge variant="destructive" className="text-xs">Failed</Badge>;
  return <Badge variant="secondary" className="text-xs">Uploaded</Badge>;
}

// ─── DNA helpers ─────────────────────────────────────────────────────────────

function approvalBadge(approval: DnaValue["approval"]) {
  if (approval === "approved")
    return <Badge className="text-xs bg-green-100 text-green-700 hover:bg-green-100 border-0">Approved</Badge>;
  if (approval === "rejected")
    return <Badge className="text-xs bg-muted text-muted-foreground hover:bg-muted border-0">Rejected</Badge>;
  return <Badge className="text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-100 border-0">Pending</Badge>;
}

function synthesisBadge(status: DnaSubtopic["synthesisStatus"]) {
  if (status === "running")
    return <Badge className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-100 border-0">Running</Badge>;
  if (status === "done")
    return <Badge className="text-xs bg-green-100 text-green-700 hover:bg-green-100 border-0">Done</Badge>;
  if (status === "failed")
    return <Badge className="text-xs bg-red-100 text-red-700 hover:bg-red-100 border-0">Not Found</Badge>;
  return null;
}

// ─── Inline form ─────────────────────────────────────────────────────────────

interface InlineFormProps {
  placeholder: string;
  descriptionPlaceholder?: string;
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

function InlineForm({ placeholder, descriptionPlaceholder, onSave, onCancel, isLoading }: InlineFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="flex flex-col gap-2 p-3 border rounded-lg bg-muted/30">
      <Input
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name, description); }}
        autoFocus
      />
      {descriptionPlaceholder && (
        <Input
          placeholder={descriptionPlaceholder}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name, description); }}
        />
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!name.trim() || isLoading} onClick={() => onSave(name, description)}>
          {isLoading ? <Spinner className="size-3 mr-1" /> : null}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Value row ───────────────────────────────────────────────────────────────

function ValueRow({ value }: { value: DnaValue }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(value.content);

  const approveMutation = useMutation({
    mutationFn: (approval: "approved" | "rejected") => api.dna.updateValueApproval(value.id, approval),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dna"] }),
  });

  const editMutation = useMutation({
    mutationFn: (content: string) => api.dna.updateValueContent(value.id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dna"] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.dna.deleteValue(value.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dna"] }),
  });

  if (editing) {
    return (
      <div className="flex flex-col gap-2 px-4 pt-3 pb-2">
        <Input
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && editContent.trim()) editMutation.mutate(editContent); }}
          autoFocus
        />
        <div className="flex gap-2">
          <Button size="sm" disabled={!editContent.trim() || editMutation.isPending} onClick={() => editMutation.mutate(editContent)}>
            {editMutation.isPending ? <Spinner className="size-3 mr-1" /> : null}Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditContent(value.content); setEditing(false); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-4 pt-3 pb-2 group">
      <p className="flex-1 text-sm text-muted-foreground leading-snug">{value.content}</p>
      <div className="flex items-center gap-1 shrink-0">
        {value.userEdited && (
          <Badge className="text-xs bg-purple-100 text-purple-700 hover:bg-purple-100 border-0">Edited</Badge>
        )}
        {approvalBadge(value.approval)}
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => { setEditContent(value.content); setEditing(true); }}
          aria-label="Edit value"
        >
          <Pencil className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`size-6 text-muted-foreground hover:text-green-600 transition-opacity ${value.approval === "pending" ? "" : "opacity-0 group-hover:opacity-100"}`}
          disabled={approveMutation.isPending || value.approval === "approved"}
          onClick={() => approveMutation.mutate("approved")}
          aria-label="Approve"
        >
          {approveMutation.isPending && approveMutation.variables === "approved"
            ? <Spinner className="size-3" />
            : <Check className="size-3" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`size-6 text-muted-foreground hover:text-destructive transition-opacity ${value.approval === "pending" ? "" : "opacity-0 group-hover:opacity-100"}`}
          disabled={approveMutation.isPending || value.approval === "rejected"}
          onClick={() => approveMutation.mutate("rejected")}
          aria-label="Reject"
        >
          {approveMutation.isPending && approveMutation.variables === "rejected"
            ? <Spinner className="size-3" />
            : <X className="size-3" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
          disabled={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
          aria-label="Delete value"
        >
          {deleteMutation.isPending ? <Spinner className="size-3" /> : <Trash2 className="size-3" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Subtopic row ────────────────────────────────────────────────────────────

function SubtopicRow({ subtopic }: { subtopic: DnaSubtopic }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(subtopic.name);
  const [editDescription, setEditDescription] = useState(subtopic.description ?? "");

  const synthesizeMutation = useMutation({
    mutationFn: () => api.dna.synthesize(subtopic.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dna"] }),
    onError: () => queryClient.invalidateQueries({ queryKey: ["dna"] }),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.dna.updateSubtopic(subtopic.id, { name: editName, description: editDescription }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dna"] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.dna.deleteSubtopic(subtopic.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dna"] }),
  });

  const isRunning = subtopic.synthesisStatus === "running" || synthesizeMutation.isPending;

  return (
    <div className="border rounded-lg p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{subtopic.name}</p>
            {synthesisBadge(subtopic.synthesisStatus)}
          </div>
          {subtopic.description && !editing && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtopic.description}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={isRunning}
          onClick={() => synthesizeMutation.mutate()}
        >
          {isRunning
            ? <><Spinner className="size-3 mr-1" /> Synthesizing</>
            : <><Wand2 className="size-3 mr-1" /> {subtopic.lastSynthesizedAt ? "Resynthesize" : "Synthesize"}</>
          }
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => { setEditName(subtopic.name); setEditDescription(subtopic.description ?? ""); setEditing(true); }}
          aria-label={`Edit subtopic ${subtopic.name}`}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          disabled={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
          aria-label={`Delete subtopic ${subtopic.name}`}
        >
          {deleteMutation.isPending ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
        </Button>
      </div>

      {/* Synthesis error */}
      {synthesizeMutation.isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {synthesizeMutation.error?.message ?? "Synthesis failed. Please try again."}
        </div>
      )}

      {/* Inline edit form */}
      {editing && (
        <div className="flex flex-col gap-2 p-3 border rounded-lg bg-muted/30">
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Subtopic name" />
          <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description (optional)" />
          <div className="flex gap-2">
            <Button size="sm" disabled={!editName.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
              {updateMutation.isPending ? <Spinner className="size-3 mr-1" /> : null}Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Values */}
      {subtopic.values.length > 0 && (
        <Accordion type="single" collapsible defaultValue="values">
          <AccordionItem value="values" className="border-0">
            <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
              {subtopic.values.length} value{subtopic.values.length !== 1 ? "s" : ""}
            </AccordionTrigger>
            <AccordionContent>
              <div className="border rounded-lg divide-y">
                {subtopic.values.map((v) => <ValueRow key={v.id} value={v} />)}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

// ─── Topic item ──────────────────────────────────────────────────────────────

function TopicItem({ topic }: { topic: DnaTopic }) {
  const queryClient = useQueryClient();
  const [showAddSubtopic, setShowAddSubtopic] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(topic.name);
  const [editDescription, setEditDescription] = useState(topic.description ?? "");

  const deleteMutation = useMutation({
    mutationFn: () => api.dna.deleteTopic(topic.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dna"] }),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.dna.updateTopic(topic.id, { name: editName, description: editDescription }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dna"] });
      setEditing(false);
    },
  });

  const addSubtopicMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      api.dna.createSubtopic(topic.id, { name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dna"] });
      setShowAddSubtopic(false);
    },
  });

  return (
    <AccordionItem value={topic.id}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2 flex-1 mr-2">
          <span className="font-medium">{topic.name}</span>
          {topic.source === "discovered" && (
            <Badge variant="secondary" className="text-xs">Discovered</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground mr-1"
          onClick={(e) => { e.stopPropagation(); setEditName(topic.name); setEditDescription(topic.description ?? ""); setEditing(true); }}
          aria-label={`Edit topic ${topic.name}`}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-destructive mr-1"
          disabled={deleteMutation.isPending}
          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(); }}
          aria-label={`Delete topic ${topic.name}`}
        >
          {deleteMutation.isPending ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
        </Button>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pt-1">
          {editing ? (
            <div className="flex flex-col gap-2 p-3 border rounded-lg bg-muted/30">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Topic name" />
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description (optional)" />
              <div className="flex gap-2">
                <Button size="sm" disabled={!editName.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                  {updateMutation.isPending ? <Spinner className="size-3 mr-1" /> : null}Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : topic.description ? (
            <p className="text-sm text-muted-foreground">{topic.description}</p>
          ) : null}

          {/* Subtopics */}
          <div className="space-y-2">
            {topic.subtopics.map((s) => <SubtopicRow key={s.id} subtopic={s} />)}
          </div>

          {/* Add subtopic */}
          {showAddSubtopic ? (
            <InlineForm
              placeholder="Subtopic name"
              descriptionPlaceholder="Description (optional)"
              onSave={(name, description) => addSubtopicMutation.mutate({ name, description })}
              onCancel={() => setShowAddSubtopic(false)}
              isLoading={addSubtopicMutation.isPending}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setShowAddSubtopic(true)}
            >
              <Plus className="size-3 mr-1" />
              Add subtopic
            </Button>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// ─── Source documents accordion ──────────────────────────────────────────────

function SourceDocuments() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.documents.list(),
    refetchInterval: (query) => {
      const docs = query.state.data?.documents ?? [];
      const hasActive = docs.some((d) => d.status === "uploaded" || d.status === "processing");
      return hasActive ? 2000 : false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.documents.upload(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setUploadError(null);
    },
    onError: (err: Error) => setUploadError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.documents.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError("Unsupported file type. Please upload a PDF, Word document, or plain text file.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadError("File is too large. Maximum size is 20 MB.");
      return;
    }
    setUploadError(null);
    uploadMutation.mutate(file);
  };

  const documents = data?.documents ?? [];

  return (
    <div className="space-y-4">
      {/* Upload area */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload document"
        className={[
          "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30",
        ].join(" ")}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
      >
        {uploadMutation.isPending ? (
          <><Spinner className="size-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">Uploading...</p></>
        ) : (
          <>
            <Upload className="size-6 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">Drop a file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">PDF, Word, TXT, Markdown — up to 20 MB</p>
            </div>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {uploadError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {uploadError}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(doc.sizeBytes)}</p>
              </div>
              {documentStatusBadge(doc.status)}
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(doc.id)}
                aria-label={`Delete ${doc.name}`}
              >
                {deleteMutation.isPending && deleteMutation.variables === doc.id
                  ? <Spinner className="size-4" />
                  : <Trash2 className="size-4" />}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function DNASection() {
  const queryClient = useQueryClient();
  const [showAddTopic, setShowAddTopic] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dna"],
    queryFn: () => api.dna.list(),
  });

  const addTopicMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      api.dna.createTopic({ name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dna"] });
      setShowAddTopic(false);
    },
  });

  const topics = data?.topics ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Source</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Define your organization's knowledge source through topics, subtopics, and synthesized value statements.
        </p>
      </div>

      {/* Topics & Subtopics */}
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Topics &amp; Subtopics</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled title="Coming soon">
              <Wand2 className="size-3 mr-1" />
              Auto-discover
            </Button>
            <Button size="sm" onClick={() => setShowAddTopic(true)} disabled={showAddTopic}>
              <Plus className="size-3 mr-1" />
              Add Topic
            </Button>
          </div>
        </div>

        {/* Add topic inline form */}
        {showAddTopic && (
          <InlineForm
            placeholder="Topic name (e.g. Safety Culture)"
            descriptionPlaceholder="Description (optional)"
            onSave={(name, description) => addTopicMutation.mutate({ name, description })}
            onCancel={() => setShowAddTopic(false)}
            isLoading={addTopicMutation.isPending}
          />
        )}

        {/* Topics list */}
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : topics.length === 0 && !showAddTopic ? (
          <Card className="flex flex-col items-center justify-center gap-3 py-14">
            <Dna className="size-10 text-muted-foreground" />
            <CardContent className="p-0 text-center">
              <p className="text-sm font-medium text-muted-foreground">No topics defined yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add your first topic to start building your organization&apos;s knowledge source.
              </p>
              <Button size="sm" className="mt-4" onClick={() => setShowAddTopic(true)}>
                <Plus className="size-3 mr-1" />
                Add Topic
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Accordion type="multiple" defaultValue={topics.map((t) => t.id)} className="space-y-1">
            {topics.map((topic) => <TopicItem key={topic.id} topic={topic} />)}
          </Accordion>
        )}
      </div>

      <Separator />

      {/* Source Documents accordion */}
      <Accordion type="single" collapsible>
        <AccordionItem value="source-documents" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="text-base font-medium">Source Documents</span>
          </AccordionTrigger>
          <AccordionContent>
            <SourceDocuments />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
