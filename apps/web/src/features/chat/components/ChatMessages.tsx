"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./ChatMessage";
import { TypingIndicator } from "./TypingIndicator";
import type { UIMessage } from "ai";
import type { ChatAvatar } from "../types";

interface ChatMessagesProps {
  messages: UIMessage[];
  isLoading: boolean;
  avatar?: ChatAvatar;
  speakingMessageId?: string | null;
  error?: Error;
  onRetry?: () => void;
}

export function ChatMessages({
  messages,
  isLoading,
  avatar,
  speakingMessageId,
  error,
  onRetry,
}: ChatMessagesProps) {

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, error]);

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 px-4 py-6">
        {messages.length === 0 && !isLoading && !error && (
          <p className="text-center text-sm text-muted-foreground">
            Start a conversation
          </p>
        )}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            avatar={avatar}
            isSpeaking={speakingMessageId === message.id}
          />
        ))}
        {isLoading && <TypingIndicator avatar={avatar} />}
        {error && !isLoading && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">
              Something went wrong. Check your connection and try again.
            </span>
            {onRetry && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRetry}
                className="h-auto shrink-0 gap-1.5 px-2 py-1 text-destructive hover:bg-destructive/20 hover:text-destructive"
              >
                <RotateCcw className="size-3.5" />
                Retry
              </Button>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
