"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "./ChatMessage";
import { TypingIndicator } from "./TypingIndicator";
import type { UIMessage } from "ai";
import type { ChatAvatar } from "../types";

interface ChatMessagesProps {
  messages: UIMessage[];
  chatId: string;
  isLoading: boolean;
  avatar?: ChatAvatar;
  speakingMessageId?: string | null;
  onOptionClick?: (text: string) => void;
}

export function ChatMessages({
  messages,
  chatId,
  isLoading,
  avatar,
  speakingMessageId,
  onOptionClick,
}: ChatMessagesProps) {

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Only the most recent assistant message keeps its multiple-choice chips interactive;
  // once the learner replies, earlier chips should no longer render.
  let latestAssistantMessageId: string | null = null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {

    if (messages[i].role === "assistant") {
      latestAssistantMessageId = messages[i].id;
      break;
    }

    if (messages[i].role === "user") break;
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 px-4 py-6">
        {messages.length === 0 && !isLoading && (
          <p className="text-center text-sm text-muted-foreground">
            Start a conversation
          </p>
        )}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            chatId={chatId}
            avatar={avatar}
            isSpeaking={speakingMessageId === message.id}
            isLatestAssistant={message.id === latestAssistantMessageId}
            onOptionClick={onOptionClick}
          />
        ))}
        {isLoading && <TypingIndicator avatar={avatar} />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
