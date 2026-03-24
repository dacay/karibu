"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/AccountMenu";
import { ChatInterface, CHAT_ENDPOINTS } from "@/features/chat";
import type { ChatAvatar } from "@/features/chat";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/assets";

export default function ChatPage() {

  const { user, isLoading } = useAuth();
  const router = useRouter();
  const chatId = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
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

  const avatar = useMemo((): ChatAvatar | undefined => {
    const preferredAvatarId = profileData?.user.preferredAvatarId;
    if (!preferredAvatarId || !avatarsData?.avatars) return undefined;

    const found = avatarsData.avatars.find((a) => a.id === preferredAvatarId);
    if (!found) return undefined;

    return {
      name: found.name,
      voiceId: found.voiceId,
      image: found.imageS3Key ? getAssetUrl(found.imageS3Key) : undefined,
    };
  }, [profileData, avatarsData]);

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
          className="h-full"
        />
      </div>
    </div>
  );
}
