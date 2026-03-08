"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Keyboard, Mic, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { ChatAgentAvatar } from "./ChatAgentAvatar";
import { useTTS } from "../hooks/useTTS";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { DEFAULT_AVATAR } from "../constants";
import type { ChatConfig } from "../types";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("karibu_token");
}

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");
}

export function ChatInterface({
  endpoint,
  chatId,
  microlearningId,
  avatar,
  autoPlayVoice = false,
  className,
  onComplete,
}: ChatConfig) {

  const resolvedAvatar = { ...DEFAULT_AVATAR, ...avatar };

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const hasAutoStarted = useRef(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const { speak, stop, isSpeaking } = useTTS();
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const { messages, sendMessage, status } = useChat({
    id: chatId,
    transport: new DefaultChatTransport({
      api: endpoint,
      headers: () => {
        const token = getToken();
        return token ? { Authorization: `Bearer ${token}` } : ({} as Record<string, string>);
      },
      body: {
        chatId,
        ...(microlearningId ? { microlearningId } : {}),
      },
    }),
  });

  // Auto-start ML lessons — send a hidden trigger so the AI opens the conversation
  useEffect(() => {
    if (!microlearningId) return;
    if (hasAutoStarted.current || messages.length > 0) return;
    hasAutoStarted.current = true;
    sendMessage({ text: "__start__" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch messages for completion signal attached via messageMetadata
  useEffect(() => {
    if (isCompleted) return;
    const last = messages[messages.length - 1] as UIMessage | undefined;
    if (
      last?.role === "assistant" &&
      (last.metadata as { mlCompleted?: boolean } | undefined)?.mlCompleted
    ) {
      setIsCompleted(true);
      onComplete?.();
    }
  }, [messages, isCompleted, onComplete]);

  const isLoading = status === "submitted" || status === "streaming";

  // Refs for stale-closure–safe access inside async callbacks
  const modeRef        = useRef(mode);
  const voicePausedRef = useRef(voicePaused);
  useEffect(() => { modeRef.current        = mode;        }, [mode]);
  useEffect(() => { voicePausedRef.current = voicePaused; }, [voicePaused]);

  // Voice transcript handler — auto-send in voice mode, fill input in text mode
  const handleVoiceTranscript = useCallback((text: string) => {
    if (modeRef.current === "voice") {
      stop();
      setSpeakingMessageId(null);
      sendMessage({ text });
    } else {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    }
  }, [sendMessage, stop]);

  // When silence detected with no speech, restart mic if loop is running
  const handleNoSpeech = useCallback(() => {
    if (modeRef.current === "voice" && !voicePausedRef.current) {
      startListeningRef.current();
    }
  }, []);

  const { state: voiceState, isSupported: isVoiceSupported, startListening, stopListening, discardListening } =
    useVoiceInput(handleVoiceTranscript, handleNoSpeech);

  // Keep refs up-to-date so async callbacks always call the latest version
  const startListeningRef = useRef(startListening);
  const stopListeningRef  = useRef(stopListening);
  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);
  useEffect(() => { stopListeningRef.current  = stopListening;  }, [stopListening]);

  // Incremented each time a new speak() call starts; lets old .finally() callbacks
  // detect they were superseded and skip restarting the mic.
  const ttsGenerationRef = useRef(0);

  // Start mic when switching to voice mode; stop it when leaving
  useEffect(() => {
    if (mode === "voice") {
      setVoicePaused(false);
      startListeningRef.current();
    } else {
      stopListeningRef.current();
    }
  }, [mode]);

  // Stop the loop and let the user decide when to continue
  const handleStopVoice = useCallback(() => {
    // Sync ref immediately — stop() may fire audio events before React commits setVoicePaused
    voicePausedRef.current = true;
    ttsGenerationRef.current += 1; // invalidate any pending .finally()
    stop();
    setSpeakingMessageId(null);
    discardListening(); // stop mic and throw away any recorded audio
    setVoicePaused(true);
  }, [stop]);

  // Resume: unpause and start listening
  const handleStartVoice = useCallback(() => {
    setVoicePaused(false);
    voicePausedRef.current = false; // sync ref immediately so the effect sees it
    startListeningRef.current();
  }, []);

  // Auto-speak last assistant message when streaming finishes
  const prevStatusRef = useRef(status);

  useEffect(() => {

    const wasActive =
      prevStatusRef.current === "submitted" ||
      prevStatusRef.current === "streaming";
    prevStatusRef.current = status;

    const effectiveAutoPlay = autoPlayVoice || modeRef.current === "voice";
    if (!effectiveAutoPlay) return;
    if (!wasActive || status !== "ready") return;

    const last = messages[messages.length - 1] as UIMessage | undefined;
    if (last?.role !== "assistant") return;

    const text = extractText(last);
    if (!text) return;

    setSpeakingMessageId(last.id);
    const generation = ++ttsGenerationRef.current;

    speak(text, resolvedAvatar.voiceId).finally(() => {
      setSpeakingMessageId(null);
      // Only restart the mic if this speak() wasn't superseded by a newer one or a manual stop
      if (ttsGenerationRef.current !== generation) return;
      if (modeRef.current === "voice" && !voicePausedRef.current) {
        startListeningRef.current();
      }
    });

  }, [status, messages, autoPlayVoice, speak, resolvedAvatar.voiceId]);

  const handleSend = useCallback(() => {

    const text = input.trim();
    if (!text || isLoading) return;

    stop();
    setSpeakingMessageId(null);
    sendMessage({ text });
    setInput("");

  }, [input, isLoading, sendMessage, stop]);

  return (
    <div className={cn("flex h-full flex-col overflow-hidden", className)}>
      {/* Header with avatar + mode toggle */}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <ChatAgentAvatar
          avatar={resolvedAvatar}
          isSpeaking={isSpeaking}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {resolvedAvatar.name ?? "Assistant"}
          </p>
          {isSpeaking && (
            <p className="text-xs text-muted-foreground">Speaking...</p>
          )}
        </div>
        {isCompleted && (
          <Badge variant="outline" className="shrink-0 gap-1 border-green-500 text-green-600">
            <CheckCircle2 className="size-3" />
            Completed
          </Badge>
        )}
        <Button
          type="button"
          variant={mode === "voice" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode((m) => (m === "text" ? "voice" : "text"))}
          className="flex items-center gap-1.5 shrink-0"
          aria-label={mode === "voice" ? "Switch to text mode" : "Switch to voice mode"}
        >
          {mode === "voice" ? (
            <>
              <Keyboard className="size-4" />
              <span>Text</span>
            </>
          ) : (
            <>
              <Mic className="size-4" />
              <span>Voice</span>
            </>
          )}
        </Button>
      </div>

      {/* Messages */}
      <ChatMessages
        messages={(messages as UIMessage[]).filter(
          (m) => !(m.role === "user" && extractText(m) === "__start__")
        )}
        chatId={chatId}
        isLoading={isLoading}
        avatar={resolvedAvatar}
        speakingMessageId={speakingMessageId}
      />

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSend}
        isLoading={isLoading}
        mode={mode}
        voiceState={voiceState}
        isVoiceSupported={isVoiceSupported}
        startListening={startListening}
        stopListening={stopListening}
        isSpeaking={isSpeaking}
        voicePaused={voicePaused}
        onStopVoice={handleStopVoice}
        onStartVoice={handleStartVoice}
      />
    </div>
  );
}
