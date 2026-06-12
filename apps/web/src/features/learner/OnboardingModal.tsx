"use client";

import { useState } from "react";
import { Sparkles, Volume2, Loader2, Check } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useTTS } from "@/features/chat/hooks/useTTS";
import { getVersionedAssetUrl } from "@/lib/assets";
import {
  api,
  avatarSupportsLanguage,
  localizationFor,
  LANGUAGES,
  type Avatar as AvatarType,
  type LanguageCode,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULT_OPTION = "default";

function avatarImageUrl(avatar: AvatarType): string | null {
  if (!avatar.imageS3Key) return null;
  return getVersionedAssetUrl(avatar.imageS3Key, avatar.updatedAt);
}

export function OnboardingModal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: profileData } = useQuery({
    queryKey: ["user", "me"],
    queryFn: api.user.me,
    enabled: !!user,
  });

  const { data: avatarsData } = useQuery({
    queryKey: ["avatars"],
    queryFn: api.avatars.list,
    enabled: !!user,
  });

  const profile = profileData?.user;
  const avatars = avatarsData?.avatars ?? [];

  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState<"welcome" | "avatar">("welcome");

  // Show only for learners who have never completed onboarding, until dismissed.
  const open =
    !dismissed &&
    !!profile &&
    profile.role === "user" &&
    profile.onboardingCompletedAt === null;

  const completeMutation = useMutation({
    mutationFn: api.user.completeOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });

  const preferenceMutation = useMutation({
    mutationFn: (preferredAvatarId: string | null) =>
      api.user.updatePreferences({ preferredAvatarId }),
    // Optimistic: reflect the choice instantly so the click feels immediate,
    // then reconcile with the server in the background.
    onMutate: async (preferredAvatarId) => {
      await queryClient.cancelQueries({ queryKey: ["user", "me"] });
      const previous = queryClient.getQueryData<{ user: typeof profile }>(["user", "me"]);
      if (previous?.user) {
        queryClient.setQueryData(["user", "me"], {
          user: { ...previous.user, preferredAvatarId },
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["user", "me"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });

  const languageMutation = useMutation({
    mutationFn: (language: LanguageCode) => api.user.updatePreferences({ language }),
    onMutate: async (language) => {
      await queryClient.cancelQueries({ queryKey: ["user", "me"] });
      const previous = queryClient.getQueryData<{ user: typeof profile }>(["user", "me"]);
      if (previous?.user) {
        queryClient.setQueryData(["user", "me"], {
          user: { ...previous.user, language },
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["user", "me"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });

  const language: LanguageCode = profile?.language ?? "en";

  // Only show avatars available in the chosen language.
  const selectableAvatars = avatars.filter((a) => avatarSupportsLanguage(a, language));

  const { state: ttsState, speak, stop } = useTTS();
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // Dismissal (skip, X, outside click, or finish) all mark onboarding as done so
  // it never reappears — onboarding is entirely optional.
  function dismiss() {
    stop();
    setDismissed(true);
    completeMutation.mutate();
  }

  function handlePreview(avatar: AvatarType) {
    if (previewingId === avatar.id && (ttsState === "loading" || ttsState === "playing")) {
      stop();
      setPreviewingId(null);
      return;
    }
    setPreviewingId(avatar.id);
    const localization = localizationFor(avatar, language);
    speak(`Hi, I'm ${avatar.name}. ${localization?.description ?? ""}`, localization?.voiceId).finally(() => {
      setPreviewingId((cur) => (cur === avatar.id ? null : cur));
    });
  }

  const selectedId = profile?.preferredAvatarId ?? DEFAULT_OPTION;

  function selectAvatar(value: string) {
    preferenceMutation.mutate(value === DEFAULT_OPTION ? null : value);
  }

  function isPreviewing(id: string) {
    return previewingId === id && (ttsState === "loading" || ttsState === "playing");
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className="max-w-lg">
        {step === "welcome" ? (
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-7" />
            </div>
            <DialogHeader className="mb-2 items-center">
              <DialogTitle className="text-2xl">
                Welcome{profile?.firstName ? `, ${profile.firstName}` : ""}!
              </DialogTitle>
            </DialogHeader>
            <p className="max-w-sm text-sm text-muted-foreground">
              {user?.organizationName ? `${user.organizationName} uses ` : "We use "}
              Karibu to deliver short, focused learning sessions. You can pick the
              assistant voice and look that feels right for you — or keep the default.
              This is completely optional, and you can change it anytime from your account menu.
            </p>
            <div className="mt-6 flex w-full items-center justify-between gap-3">
              <Button variant="ghost" onClick={dismiss}>
                Skip
              </Button>
              <Button onClick={() => setStep("avatar")}>
                Choose your avatar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <DialogHeader>
              <DialogTitle>Choose your avatar</DialogTitle>
            </DialogHeader>
            <p className="-mt-2 mb-3 text-sm text-muted-foreground">
              Pick the assistant that will guide your sessions. Press play to hear
              each voice.
            </p>

            {/* Language selector — filters the avatars shown below */}
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Language</span>
              <div className="flex gap-1">
                {LANGUAGES.map(({ code, label }) => (
                  <Button
                    key={code}
                    type="button"
                    size="sm"
                    variant={language === code ? "default" : "outline"}
                    onClick={() => { stop(); setPreviewingId(null); languageMutation.mutate(code); }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {/* Default option */}
              <button
                type="button"
                onClick={() => selectAvatar(DEFAULT_OPTION)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  selectedId === DEFAULT_OPTION
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-muted/50",
                )}
              >
                <Avatar className="size-11">
                  <AvatarFallback>
                    <Sparkles className="size-5 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-sm font-medium">Default</p>
                  <p className="text-xs text-muted-foreground">
                    Use the avatar chosen by your organization.
                  </p>
                </div>
                {selectedId === DEFAULT_OPTION && <Check className="size-4 text-primary" />}
              </button>

              {selectableAvatars.map((avatar) => {
                const img = avatarImageUrl(avatar);
                const active = selectedId === avatar.id;
                return (
                  <div
                    key={avatar.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectAvatar(avatar.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectAvatar(avatar.id);
                      }
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/50",
                    )}
                  >
                    <Avatar className="size-11">
                      {img && <AvatarImage src={img} alt={avatar.name} />}
                      <AvatarFallback>{avatar.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{avatar.name}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {localizationFor(avatar, language)?.description}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      title={`Preview ${avatar.name}'s voice`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePreview(avatar);
                      }}
                    >
                      {isPreviewing(avatar.id) ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Volume2 className="size-4" />
                      )}
                    </Button>
                    {active && <Check className="size-4 shrink-0 text-primary" />}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <Button variant="ghost" onClick={() => { stop(); setStep("welcome"); }}>
                Back
              </Button>
              <Button onClick={dismiss}>
                Get started
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
