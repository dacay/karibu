"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, UserCircle, Upload, X, Volume2 } from "lucide-react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { api, type Avatar, ELEVENLABS_VOICES } from "@/lib/api";
import { useTTS } from "@/features/chat/hooks/useTTS";
import { useAvatarImageVersion, useBumpAvatarImageVersion } from "@/hooks/useAvatarImageVersion";
import { getAssetUrl } from "@/lib/assets";

function getAvatarImageUrl(avatar: Avatar, version: number): string | null {
  if (!avatar.imageS3Key) return null;
  const base = getAssetUrl(avatar.imageS3Key);
  return version ? `${base}?v=${version}` : base;
}

// ─── Voice selector ────────────────────────────────────────────────────────────

interface VoiceSelectorProps {
  value: string;
  onChange: (id: string) => void;
}

function VoiceSelector({ value, onChange }: VoiceSelectorProps) {
  const female = ELEVENLABS_VOICES.filter((v) => v.gender === "female");
  const male = ELEVENLABS_VOICES.filter((v) => v.gender === "male");
  const { state, speak, stop } = useTTS();
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);

  function handlePreview(voiceId: string, voiceName: string) {
    if (previewingVoiceId === voiceId && (state === "loading" || state === "playing")) {
      stop();
      setPreviewingVoiceId(null);
      return;
    }
    setPreviewingVoiceId(voiceId);
    speak(`Hi, I'm ${voiceName}. This is what I sound like.`, voiceId).then(() => {
      setPreviewingVoiceId(null);
    });
  }

  function handleChange(voiceId: string) {
    stop();
    setPreviewingVoiceId(null);
    onChange(voiceId);
  }

  function isVoiceActive(voiceId: string) {
    return previewingVoiceId === voiceId && (state === "loading" || state === "playing");
  }

  function renderVoiceGroup(voices: typeof ELEVENLABS_VOICES, label: string) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <div className="flex flex-wrap gap-2">
          {voices.map((v) => (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => handleChange(v.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleChange(v.id); } }}
              className={[
                "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                value === v.id
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:border-primary/40 hover:bg-muted/50",
              ].join(" ")}
            >
              <div className="flex flex-col items-start">
                <span className="font-medium">{v.name}</span>
                <span className="text-xs text-muted-foreground">{v.description}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 ml-1"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePreview(v.id, v.name);
                }}
                aria-label={isVoiceActive(v.id) ? "Stop preview" : `Preview ${v.name}`}
              >
                {isVoiceActive(v.id) ? (
                  <span className="block size-2.5 rounded-[1px] bg-current" />
                ) : (
                  <Volume2 className="size-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {renderVoiceGroup(female, "Female")}
      {renderVoiceGroup(male, "Male")}
    </div>
  );
}

// ─── Image picker ──────────────────────────────────────────────────────────────

interface ImagePickerProps {
  previewUrl: string | null;
  onFileChange: (file: File | null) => void;
}

function ImagePicker({ previewUrl, onFileChange }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    onFileChange(file);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="size-20 shrink-0 rounded-lg border bg-muted flex items-center justify-center overflow-hidden">
        {previewUrl ? (
          <Image src={previewUrl} alt="Avatar preview" width={80} height={80} className="object-cover size-full" unoptimized />
        ) : (
          <UserCircle className="size-10 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          {previewUrl ? "Change image" : "Upload image"}
        </Button>
        {previewUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => {
              onFileChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <X className="size-3.5" />
            Remove
          </Button>
        )}
        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or GIF — max 5 MB</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ─── Avatar form ───────────────────────────────────────────────────────────────

interface AvatarFormValues {
  name: string;
  personality: string;
  voiceId: string;
  imageFile: File | null;
  existingImageUrl: string | null;
}

interface AvatarFormProps {
  initial?: Partial<AvatarFormValues>;
  onSave: (values: AvatarFormValues) => void;
  onCancel: () => void;
  isLoading: boolean;
  submitLabel?: string;
}

function AvatarForm({
  initial = {},
  onSave,
  onCancel,
  isLoading,
  submitLabel = "Save",
}: AvatarFormProps) {
  const [name, setName] = useState(initial.name ?? "");
  const [personality, setPersonality] = useState(initial.personality ?? "");
  const [voiceId, setVoiceId] = useState(initial.voiceId ?? ELEVENLABS_VOICES[0].id);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImageUrl] = useState<string | null>(initial.existingImageUrl ?? null);
  const [imageRemoved, setImageRemoved] = useState(false);

  const previewUrl = imageFile
    ? URL.createObjectURL(imageFile)
    : imageRemoved
    ? null
    : existingImageUrl;

  function handleImageChange(file: File | null) {
    setImageFile(file);
    if (!file) setImageRemoved(true);
  }

  const valid = name.trim().length > 0 && personality.trim().length > 0 && voiceId.length > 0;

  return (
    <div className="flex flex-col gap-4 p-4 border rounded-lg bg-muted/30">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="avatar-name">Name</Label>
          <Input
            id="avatar-name"
            placeholder="Avatar name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="avatar-personality">Personality</Label>
        <Textarea
          id="avatar-personality"
          placeholder="Describe how this avatar behaves, its tone, communication style, and role in the learning experience."
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          rows={5}
          className="resize-none text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Image</Label>
        <ImagePicker previewUrl={previewUrl} onFileChange={handleImageChange} />
      </div>

      <div className="space-y-1.5">
        <Label>Voice</Label>
        <VoiceSelector value={voiceId} onChange={setVoiceId} />
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!valid || isLoading}
          onClick={() => onSave({ name, personality, voiceId, imageFile, existingImageUrl: imageRemoved ? null : existingImageUrl })}
        >
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

// ─── Avatar card ───────────────────────────────────────────────────────────────

interface AvatarCardProps {
  avatar: Avatar;
}

function AvatarCard({ avatar }: AvatarCardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const avatarImageVersion = useAvatarImageVersion();
  const bumpAvatarImageVersion = useBumpAvatarImageVersion();

  const voice = ELEVENLABS_VOICES.find((v) => v.id === avatar.voiceId);
  const imageUrl = getAvatarImageUrl(avatar, avatarImageVersion);

  const updateMutation = useMutation({
    mutationFn: (values: AvatarFormValues) => {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("personality", values.personality);
      formData.append("voiceId", values.voiceId);
      if (values.imageFile) formData.append("image", values.imageFile);
      return api.avatars.update(avatar.id, formData);
    },
    onSuccess: (_data, variables) => {
      if (variables.imageFile) bumpAvatarImageVersion();
      queryClient.invalidateQueries({ queryKey: ["avatars"] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.avatars.delete(avatar.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["avatars"] }),
  });

  if (editing) {
    return (
      <AvatarForm
        initial={{
          name: avatar.name,
          personality: avatar.personality,
          voiceId: avatar.voiceId,
          existingImageUrl: imageUrl,
        }}
        onSave={(values) => updateMutation.mutate(values)}
        onCancel={() => setEditing(false)}
        isLoading={updateMutation.isPending}
        submitLabel="Update"
      />
    );
  }

  return (
    <Card className="group">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="size-12 shrink-0 rounded-lg border bg-muted flex items-center justify-center overflow-hidden">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt={avatar.name}
                  width={48}
                  height={48}
                  className="object-cover size-full"
                  unoptimized
                />
              ) : (
                <UserCircle className="size-7 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">{avatar.name}</CardTitle>
                {avatar.isBuiltIn && (
                  <Badge variant="secondary" className="text-xs">Built-in</Badge>
                )}
              </div>
              {voice && (
                <p className="text-xs text-muted-foreground">
                  {voice.name} · {voice.gender === "female" ? "Female" : "Male"} · {voice.description}
                </p>
              )}
            </div>
          </div>
          {!avatar.isBuiltIn && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setEditing(true)}
                aria-label="Edit avatar"
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                aria-label="Delete avatar"
              >
                {deleteMutation.isPending ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed border rounded-md p-3 bg-muted/30">
          {avatar.personality}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Main section ──────────────────────────────────────────────────────────────

export function AvatarsSection() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const bumpAvatarImageVersion = useBumpAvatarImageVersion();

  const { data, isLoading } = useQuery({
    queryKey: ["avatars"],
    queryFn: () => api.avatars.list(),
  });

  const createMutation = useMutation({
    mutationFn: (values: AvatarFormValues) => {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("personality", values.personality);
      formData.append("voiceId", values.voiceId);
      if (values.imageFile) formData.append("image", values.imageFile);
      return api.avatars.create(formData);
    },
    onSuccess: (_data, variables) => {
      if (variables.imageFile) bumpAvatarImageVersion();
      queryClient.invalidateQueries({ queryKey: ["avatars"] });
      setCreating(false);
    },
  });

  const avatarList = data?.avatars ?? [];
  const builtIn = avatarList.filter((a) => a.isBuiltIn);
  const custom = avatarList.filter((a) => !a.isBuiltIn);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Avatars</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure AI avatars that deliver learning experiences.
          </p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4 mr-1" />
            New Avatar
          </Button>
        )}
      </div>

      {creating && (
        <AvatarForm
          onSave={(values) => createMutation.mutate(values)}
          onCancel={() => setCreating(false)}
          isLoading={createMutation.isPending}
          submitLabel="Create Avatar"
        />
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {!isLoading && (
        <>
          {builtIn.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Built-in Avatars
              </h3>
              {builtIn.map((avatar) => (
                <AvatarCard key={avatar.id} avatar={avatar} />
              ))}
            </div>
          )}

          {builtIn.length > 0 && custom.length > 0 && <Separator />}

          {custom.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Your Avatars
              </h3>
              {custom.map((avatar) => (
                <AvatarCard key={avatar.id} avatar={avatar} />
              ))}
            </div>
          )}

          {avatarList.length === 0 && !creating && (
            <Card className="min-h-64 flex flex-col items-center justify-center gap-3">
              <UserCircle className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                No avatars yet. Create one to define an AI persona for your learners.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
