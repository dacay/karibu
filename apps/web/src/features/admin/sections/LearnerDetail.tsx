"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  MessageSquare,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  Bot,
  User,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  api,
  type LearnerMLHistory,
  type LearnerChatSession,
  type ChatTranscriptMessage,
} from "@/lib/api";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProgressStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <Badge className="gap-1 text-xs bg-green-100 text-green-700 hover:bg-green-100 border-0">
          <CheckCircle2 className="size-3" />
          Completed
        </Badge>
      );
    case "active":
      return (
        <Badge className="gap-1 text-xs bg-blue-100 text-blue-700 hover:bg-blue-100 border-0">
          <Clock className="size-3" />
          Active
        </Badge>
      );
    case "expired":
      return (
        <Badge className="gap-1 text-xs bg-orange-100 text-orange-700 hover:bg-orange-100 border-0">
          <AlertCircle className="size-3" />
          Expired
        </Badge>
      );
    default:
      return null;
  }
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p: { type?: string }) => p.type === "text")
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
}

// ─── Chat Transcript Viewer ──────────────────────────────────────────────────

function ChatTranscriptViewer({ userId, chatId, onBack, chatLabel }: {
  userId: string;
  chatId: string;
  onBack: () => void;
  chatLabel: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["adminLearners", userId, "chats", chatId],
    queryFn: () => api.adminLearners.chatTranscript(userId, chatId),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  const messages = data?.messages ?? [];
  // Filter out system messages and __start__ triggers
  const visibleMessages = messages.filter((msg) => {
    if (msg.role === "system") return false;
    const text = extractTextFromParts(msg.parts);
    if (msg.role === "user" && text === "__start__") return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" />
          Back
        </Button>
        <h4 className="text-sm font-semibold">{chatLabel}</h4>
        {data?.chat && (
          <Badge variant="outline" className="text-[10px]">
            {data.chat.type === "microlearning" ? "ML" : "Assistant"}
          </Badge>
        )}
      </div>

      {visibleMessages.length === 0 ? (
        <Card className="py-8 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">No messages in this conversation.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatTranscriptMessage }) {
  const isUser = message.role === "user";
  const text = extractTextFromParts(message.parts);

  if (!text.trim()) return null;

  return (
    <div className={["flex gap-3", isUser ? "flex-row-reverse" : ""].join(" ")}>
      <div className={[
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted",
      ].join(" ")}>
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div className={[
        "max-w-[75%] rounded-lg px-4 py-2.5",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted",
      ].join(" ")}>
        <p className="text-sm whitespace-pre-wrap">{text}</p>
        <p className={[
          "text-[10px] mt-1",
          isUser ? "text-primary-foreground/60" : "text-muted-foreground",
        ].join(" ")}>
          {formatDateTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

// ─── Main Learner Detail View ────────────────────────────────────────────────

interface LearnerDetailViewProps {
  userId: string;
  email: string;
  onBack: () => void;
}

export function LearnerDetailView({ userId, email, onBack }: LearnerDetailViewProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChatLabel, setSelectedChatLabel] = useState("");

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["adminLearners", userId, "history"],
    queryFn: () => api.adminLearners.history(userId),
  });

  const { data: chatsData, isLoading: chatsLoading } = useQuery({
    queryKey: ["adminLearners", userId, "chats"],
    queryFn: () => api.adminLearners.chats(userId),
  });

  // If viewing a chat transcript
  if (selectedChatId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4 mr-1" />
            Back to list
          </Button>
          <span className="text-sm text-muted-foreground">{email}</span>
        </div>
        <ChatTranscriptViewer
          userId={userId}
          chatId={selectedChatId}
          onBack={() => setSelectedChatId(null)}
          chatLabel={selectedChatLabel}
        />
      </div>
    );
  }

  const history = historyData?.history ?? [];
  const chatSessions = chatsData?.chats ?? [];
  const mlChats = chatSessions.filter((c) => c.type === "microlearning");
  const discussionChats = chatSessions.filter((c) => c.type === "discussion");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" />
          Back
        </Button>
        <div>
          <h3 className="text-lg font-semibold">{email}</h3>
          <p className="text-xs text-muted-foreground">Learner activity and chat history</p>
        </div>
      </div>

      {/* Learning History */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">Learning History</h4>
        </div>

        {historyLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <Card className="py-6 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No microlearning activity yet.</p>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left font-medium text-muted-foreground px-5 py-2.5 w-full">Microlearning</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap hidden sm:table-cell">Started</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap hidden md:table-cell">Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item, i) => (
                    <tr key={item.id} className={["hover:bg-muted/30 transition-colors", i < history.length - 1 ? "border-b" : ""].join(" ")}>
                      <td className="px-5 py-2.5 font-medium">{item.title}</td>
                      <td className="px-4 py-2.5"><ProgressStatusBadge status={item.status} /></td>
                      <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{formatDate(item.openedAt)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                        {item.completedAt ? formatDate(item.completedAt) : item.expiredAt ? formatDate(item.expiredAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      <Separator />

      {/* Chat Transcripts */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">Chat Transcripts</h4>
        </div>

        {chatsLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : chatSessions.length === 0 ? (
          <Card className="py-6 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No chat sessions yet.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* ML chats */}
            {mlChats.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Microlearning Sessions</p>
                <Card>
                  <CardContent className="p-0">
                    {mlChats.map((chat, i) => (
                      <button
                        key={chat.id}
                        type="button"
                        className={[
                          "flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer",
                          i < mlChats.length - 1 ? "border-b" : "",
                        ].join(" ")}
                        onClick={() => {
                          setSelectedChatId(chat.id);
                          setSelectedChatLabel(chat.microlearningTitle ?? "ML Session");
                        }}
                      >
                        <BookOpen className="size-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{chat.microlearningTitle ?? "Untitled ML"}</p>
                          <p className="text-xs text-muted-foreground">
                            {chat.messageCount} messages &middot; {formatDate(chat.updatedAt)}
                          </p>
                        </div>
                        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Discussion chats */}
            {discussionChats.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assistant Conversations</p>
                <Card>
                  <CardContent className="p-0">
                    {discussionChats.map((chat, i) => (
                      <button
                        key={chat.id}
                        type="button"
                        className={[
                          "flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer",
                          i < discussionChats.length - 1 ? "border-b" : "",
                        ].join(" ")}
                        onClick={() => {
                          setSelectedChatId(chat.id);
                          setSelectedChatLabel("Ask Me Anything");
                        }}
                      >
                        <MessageSquare className="size-4 text-blue-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">Ask Me Anything</p>
                          <p className="text-xs text-muted-foreground">
                            {chat.messageCount} messages &middot; {formatDate(chat.updatedAt)}
                          </p>
                        </div>
                        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
