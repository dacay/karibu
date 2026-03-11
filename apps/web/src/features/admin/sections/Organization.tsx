"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, CheckCircle, AlertCircle, Building2, Timer, ImageOff } from "lucide-react";
import Image from "next/image";
import { api, type OrgConfig } from "@/lib/api";
import { useSubdomain } from "@/hooks/useSubdomain";
import { useBumpLogoVersion } from "@/hooks/useLogoVersion";
import { getLogoUrl } from "@/lib/assets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

type UploadStatus = "idle" | "uploading" | "done" | "error";

// ─── Logo upload ───────────────────────────────────────────────────────────────

interface LogoUploadProps {
  variant: "light" | "dark";
  subdomain: string | null;
}

function LogoUpload({ variant, subdomain }: LogoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [cacheBust, setCacheBust] = useState<number | null>(null);
  const [imgError, setImgError] = useState(false);
  const bumpLogoVersion = useBumpLogoVersion();

  const cdnPath = subdomain ? getLogoUrl(subdomain, variant) : null;

  const previewSrc = cdnPath
    ? cacheBust
      ? `${cdnPath}?v=${cacheBust}`
      : cdnPath
    : null;

  async function handleFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus("error");
      return;
    }

    setStatus("uploading");

    try {
      await api.org.uploadLogo(variant, file);
      setImgError(false);
      setCacheBust(Date.now());
      bumpLogoVersion();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  const label = variant === "light" ? "Light logo" : "Dark logo";
  const hint = variant === "light"
    ? "Used on light backgrounds"
    : "Used on dark backgrounds";

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>

      <div
        className="relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-6 transition-colors hover:border-primary/50 cursor-pointer"
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className={`mb-1 rounded p-2 ${variant === "dark" ? "bg-gray-900" : "bg-gray-50"}`}>
          {previewSrc && !imgError ? (
            <Image
              src={previewSrc}
              alt={`${label} preview`}
              width={120}
              height={40}
              className="object-contain"
              unoptimized
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex items-center justify-center w-[120px] h-[40px]">
              <ImageOff className={`size-5 ${variant === "dark" ? "text-gray-600" : "text-gray-300"}`} />
            </div>
          )}
        </div>

        {status === "uploading" ? (
          <Spinner className="size-5 text-muted-foreground" />
        ) : status === "done" ? (
          <CheckCircle className="size-5 text-green-600" />
        ) : status === "error" ? (
          <AlertCircle className="size-5 text-destructive" />
        ) : (
          <Upload className="size-5 text-muted-foreground" />
        )}

        <p className="text-sm text-muted-foreground text-center">
          {status === "uploading" && "Uploading..."}
          {status === "done" && "Uploaded."}
          {status === "error" && "Upload failed. Try again."}
          {status === "idle" && "Click or drag a PNG, JPEG, WebP, or SVG"}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={handleChange}
        />
      </div>
    </div>
  );
}

// ─── Organization section ──────────────────────────────────────────────────────

export function OrganizationSection() {
  const queryClient = useQueryClient();
  const { subdomain } = useSubdomain();

  const { data: config, isLoading } = useQuery({
    queryKey: ["org", "config"],
    queryFn: api.org.getConfig,
  });

  const [name, setName] = useState("");
  const [pronunciation, setPronunciation] = useState("");
  const [learnerTerm, setLearnerTerm] = useState("user");
  const [learnerTermPlural, setLearnerTermPlural] = useState("users");
  const [expirationIntervalHours, setExpirationIntervalHours] = useState(8);
  const [identitySaveStatus, setIdentitySaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sessionSaveStatus, setSessionSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (config) {
      setName(config.name);
      setPronunciation(config.pronunciation ?? "");
      setLearnerTerm(config.learnerTerm);
      setLearnerTermPlural(config.learnerTermPlural);
      setExpirationIntervalHours(config.expirationIntervalHours);
    }
  }, [config]);

  const identityMutation = useMutation({
    mutationFn: (body: { name: string; pronunciation: string | null; learnerTerm: string; learnerTermPlural: string }) =>
      api.org.updateConfig(body),
    onMutate: () => setIdentitySaveStatus("saving"),
    onSuccess: (updated) => {
      queryClient.setQueryData(["org", "config"], updated);
      setIdentitySaveStatus("saved");
      setTimeout(() => setIdentitySaveStatus("idle"), 2000);
    },
    onError: () => {
      setIdentitySaveStatus("error");
      setTimeout(() => setIdentitySaveStatus("idle"), 3000);
    },
  });

  const sessionMutation = useMutation({
    mutationFn: (body: { expirationIntervalHours: number }) =>
      api.org.updateConfig(body),
    onMutate: () => setSessionSaveStatus("saving"),
    onSuccess: (updated) => {
      queryClient.setQueryData(["org", "config"], updated);
      setSessionSaveStatus("saved");
      setTimeout(() => setSessionSaveStatus("idle"), 2000);
    },
    onError: () => {
      setSessionSaveStatus("error");
      setTimeout(() => setSessionSaveStatus("idle"), 3000);
    },
  });

  function handleIdentitySave() {
    identityMutation.mutate({
      name: name.trim(),
      pronunciation: pronunciation.trim() || null,
      learnerTerm: learnerTerm.trim() || "user",
      learnerTermPlural: learnerTermPlural.trim() || "users",
    });
  }

  function handleSessionSave() {
    sessionMutation.mutate({ expirationIntervalHours });
  }

  const isIdentityDirty =
    name !== (config?.name ?? "") ||
    pronunciation !== (config?.pronunciation ?? "") ||
    learnerTerm !== (config?.learnerTerm ?? "user") ||
    learnerTermPlural !== (config?.learnerTermPlural ?? "users");

  const isSessionDirty =
    expirationIntervalHours !== (config?.expirationIntervalHours ?? 8);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Organization</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your organization's identity and branding.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Identity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="size-4" />
                Identity
              </CardTitle>
              <CardDescription>
                How your organization is named and pronounced.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Corp"
                  maxLength={100}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="org-pronunciation">
                  Pronunciation{" "}
                  <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="org-pronunciation"
                  value={pronunciation}
                  onChange={(e) => setPronunciation(e.target.value)}
                  placeholder='e.g. "AK-mee"'
                  maxLength={200}
                />
                <p className="text-xs text-muted-foreground">
                  Phonetic hint used by AI avatars when saying your org name.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="learner-term">Learner term</Label>
                  <Input
                    id="learner-term"
                    value={learnerTerm}
                    onChange={(e) => setLearnerTerm(e.target.value)}
                    placeholder="user"
                    maxLength={50}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="learner-term-plural">Plural</Label>
                  <Input
                    id="learner-term-plural"
                    value={learnerTermPlural}
                    onChange={(e) => setLearnerTermPlural(e.target.value)}
                    placeholder="users"
                    maxLength={50}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                How learners are referred to in the dashboard (e.g. nurse / nurses).
              </p>

              <div className="flex items-center gap-3 pt-1">
                <Button
                  onClick={handleIdentitySave}
                  disabled={!isIdentityDirty || identitySaveStatus === "saving"}
                  size="sm"
                >
                  {identitySaveStatus === "saving" && <Spinner className="mr-1.5" />}
                  {identitySaveStatus === "saving" ? "Saving..." : "Save changes"}
                </Button>

                {identitySaveStatus === "saved" && (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle className="size-3.5" />
                    Saved.
                  </span>
                )}
                {identitySaveStatus === "error" && (
                  <span className="flex items-center gap-1 text-sm text-destructive">
                    <AlertCircle className="size-3.5" />
                    Failed to save.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Logos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="size-4" />
                Logo
              </CardTitle>
              <CardDescription>
                Upload light and dark variants of your organization logo.
                Recommended size: 200 x 60 px.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <LogoUpload variant="light" subdomain={subdomain} />
              <LogoUpload variant="dark" subdomain={subdomain} />
            </CardContent>
          </Card>

          {/* Session settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Timer className="size-4" />
                Session settings
              </CardTitle>
              <CardDescription>
                Control how long learners have to complete a microlearning before it expires.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="expiration-interval">Expiration window (hours)</Label>
                <Input
                  id="expiration-interval"
                  type="number"
                  min={1}
                  max={720}
                  value={expirationIntervalHours}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1 && val <= 720) {
                      setExpirationIntervalHours(val);
                    }
                  }}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  An active microlearning expires if not completed within this many hours of being opened (1–720).
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button
                  onClick={handleSessionSave}
                  disabled={!isSessionDirty || sessionSaveStatus === "saving"}
                  size="sm"
                >
                  {sessionSaveStatus === "saving" && <Spinner className="mr-1.5" />}
                  {sessionSaveStatus === "saving" ? "Saving..." : "Save changes"}
                </Button>

                {sessionSaveStatus === "saved" && (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle className="size-3.5" />
                    Saved.
                  </span>
                )}
                {sessionSaveStatus === "error" && (
                  <span className="flex items-center gap-1 text-sm text-destructive">
                    <AlertCircle className="size-3.5" />
                    Failed to save.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
