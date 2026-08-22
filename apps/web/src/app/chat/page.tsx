"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/AccountMenu";
import { ChatInterface, CHAT_ENDPOINTS } from "@/features/chat";
import type { ChatAvatar } from "@/features/chat";
import { api, localizationFor, getSignInPath } from "@/lib/api";
import { getVersionedAssetUrl } from "@/lib/assets";

export default function ChatPage() {

  const { user, isLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const chatId = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(getSignInPath());
    }
  }, [user, isLoading, router]);

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

  const language = profileData?.user.language ?? "en";

  const avatar = useMemo((): ChatAvatar | undefined => {
    if (!avatarsData?.avatars) return undefined;

    const toChatAvatar = (found: (typeof avatarsData.avatars)[number]): ChatAvatar => ({
      name: found.name,
      voiceId: localizationFor(found, language)?.voiceId,
      image: found.imageS3Key ? getVersionedAssetUrl(found.imageS3Key, found.updatedAt) : undefined,
    });

    const preferredAvatarId = profileData?.user.preferredAvatarId;
    if (preferredAvatarId) {
      const found = avatarsData.avatars.find((a) => a.id === preferredAvatarId);
      if (found) return toChatAvatar(found);
    }

    const defaultAvatarId = profileData?.user.defaultAvatarId;
    if (defaultAvatarId) {
      const found = avatarsData.avatars.find((a) => a.id === defaultAvatarId);
      if (found) return toChatAvatar(found);
    }

    return undefined;
  }, [profileData, avatarsData, language]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            aria-label="Go back"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="text-sm font-medium">Ask me anything</span>
        </div>
        <AccountMenu />
      </header>

      <div className="flex-1 overflow-hidden">
        <ChatInterface
          endpoint={CHAT_ENDPOINTS.assistant}
          chatId={chatId}
          avatar={avatar}
          autoPlayVoice={false}
          onLanguageChange={() => queryClient.invalidateQueries({ queryKey: ["user", "me"] })}
          className="h-full"
        />
      </div>
    </div>
  );
}
