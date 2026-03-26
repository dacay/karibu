"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Keyboard, Mic, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { ChatAgentAvatar } from "./ChatAgentAvatar";
import { useTTS } from "../hooks/useTTS";
import { useStreamTTS, type StreamTTSController } from "../hooks/useStreamTTS";
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

// ─── Markdown stripping (shared with useTTS) ────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/!?\[.*?\]\(.*?\)/g, "")
    .replace(/^[-*_]{3,}$/gm, "")
    .replace(/\n{2,}/g, " ")
    .trim();
}

// ─── Token buffering config ─────────────────────────────────────────────────

/** Minimum characters to accumulate before sending a chunk to TTS. */
const MIN_CHUNK_SIZE = 40;

/** Characters that signal a good point to send a chunk (sentence/clause boundaries). */
const BOUNDARY_RE = /[.!?;,:\n]\s*$/;

export function ChatInterface({
  endpoint,
  chatId,
  initialMessages,
  microlearningId,
  avatar,
  autoPlayVoice = false,
  className,
  onComplete,
  onRestart,
}: ChatConfig) {

  const resolvedAvatar = { ...DEFAULT_AVATAR, ...avatar };

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const hasAutoStarted = useRef(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  // Legacy TTS (non-streaming fallback — kept for autoPlayVoice in text mode)
  const { speak, stop: stopLegacyTTS, isSpeaking: isLegacySpeaking } = useTTS();

  // Streaming TTS
  const { startStream, stop: stopStreamTTS, isSpeaking: isStreamSpeaking } = useStreamTTS();
  const streamControllerRef = useRef<StreamTTSController | null>(null);
  const sentCharsRef = useRef(0);
  const chunkBufferRef = useRef("");

  const isSpeaking = isLegacySpeaking || isStreamSpeaking;

  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const { messages, sendMessage, status } = useChat({
    id: chatId,
    messages: initialMessages,
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
      stopLegacyTTS();
      stopStreamTTS();
      setSpeakingMessageId(null);
      sendMessage({ text });
    } else {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    }
  }, [sendMessage, stopLegacyTTS, stopStreamTTS]);

  // When silence detected with no speech, restart mic if loop is running
  const handleNoSpeech = useCallback(() => {
    if (modeRef.current === "voice" && !voicePausedRef.current) {
      startListeningRef.current();
    }
  }, []);

  const { state: voiceState, isSupported: isVoiceSupported, startListening, stopListening, discardListening } =
    useVoiceInput(handleVoiceTranscript, handleNoSpeech);

  // Keep refs up-to-date so async callbacks always call the latest version
  const startListeningRef   = useRef(startListening);
  const stopListeningRef    = useRef(stopListening);
  const discardListeningRef = useRef(discardListening);
  useEffect(() => { startListeningRef.current   = startListening;   }, [startListening]);
  useEffect(() => { stopListeningRef.current    = stopListening;    }, [stopListening]);
  useEffect(() => { discardListeningRef.current = discardListening; }, [discardListening]);

  // Incremented each time a new speak() call starts; lets old callbacks
  // detect they were superseded and skip restarting the mic.
  const ttsGenerationRef = useRef(0);

  // Stop voice (TTS + mic) when the learner navigates away from the chat page
  useEffect(() => {
    return () => {
      ttsGenerationRef.current += 1;
      stopLegacyTTS();
      stopStreamTTS();
      discardListeningRef.current();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    voicePausedRef.current = true;
    ttsGenerationRef.current += 1;
    stopLegacyTTS();
    stopStreamTTS();
    streamControllerRef.current = null;
    setSpeakingMessageId(null);
    discardListening();
    setVoicePaused(true);
  }, [stopLegacyTTS, stopStreamTTS, discardListening]);

  // Resume: unpause and start listening
  const handleStartVoice = useCallback(() => {
    setVoicePaused(false);
    voicePausedRef.current = false;
    startListeningRef.current();
  }, []);

  // ─── Streaming TTS: open WS when streaming starts ───────────────────────────

  const prevStatusRef = useRef(status);

  useEffect(() => {
    const wasActive =
      prevStatusRef.current === "submitted" ||
      prevStatusRef.current === "streaming";
    const justStartedStreaming =
      prevStatusRef.current === "submitted" && status === "streaming";
    const justFinishedStreaming = wasActive && status === "ready";

    prevStatusRef.current = status;

    const effectiveAutoPlay = autoPlayVoice || modeRef.current === "voice";
    if (!effectiveAutoPlay) return;

    // When streaming starts: open the TTS WebSocket
    if (justStartedStreaming) {
      const last = messages[messages.length - 1] as UIMessage | undefined;
      if (last?.role !== "assistant") return;

      setSpeakingMessageId(last.id);
      sentCharsRef.current = 0;
      chunkBufferRef.current = "";

      const generation = ++ttsGenerationRef.current;

      const controller = startStream(resolvedAvatar.voiceId, () => {
        // onDone — called when all audio has finished playing
        setSpeakingMessageId(null);
        if (ttsGenerationRef.current !== generation) return;
        if (modeRef.current === "voice" && !voicePausedRef.current) {
          startListeningRef.current();
        }
      });

      streamControllerRef.current = controller;
      return;
    }

    // When streaming finishes: flush and close the TTS stream
    if (justFinishedStreaming && streamControllerRef.current) {
      const last = messages[messages.length - 1] as UIMessage | undefined;
      if (last?.role === "assistant") {
        // Send any remaining buffered text
        const fullText = stripMarkdown(extractText(last));
        const remaining = fullText.slice(sentCharsRef.current);
        if (remaining.length > 0) {
          streamControllerRef.current.sendChunk(remaining);
          sentCharsRef.current = fullText.length;
        }
      }

      streamControllerRef.current.finish();
      streamControllerRef.current = null;
      chunkBufferRef.current = "";
      return;
    }

    // Fallback: if streaming finished but we never opened a stream (e.g. very fast response),
    // use legacy TTS
    if (justFinishedStreaming && !streamControllerRef.current) {
      const last = messages[messages.length - 1] as UIMessage | undefined;
      if (last?.role !== "assistant") return;

      const text = extractText(last);
      if (!text) return;

      setSpeakingMessageId(last.id);
      const generation = ++ttsGenerationRef.current;

      speak(text, resolvedAvatar.voiceId).finally(() => {
        setSpeakingMessageId(null);
        if (ttsGenerationRef.current !== generation) return;
        if (modeRef.current === "voice" && !voicePausedRef.current) {
          startListeningRef.current();
        }
      });
    }

  }, [status, messages, autoPlayVoice, speak, startStream, resolvedAvatar.voiceId]);

  // ─── Streaming TTS: send text chunks as the LLM streams ────────────────────

  useEffect(() => {
    if (status !== "streaming" || !streamControllerRef.current) return;

    const last = messages[messages.length - 1] as UIMessage | undefined;
    if (last?.role !== "assistant") return;

    const fullText = stripMarkdown(extractText(last));
    const newText = fullText.slice(sentCharsRef.current);

    if (newText.length === 0) return;

    // Accumulate into buffer
    chunkBufferRef.current += newText;
    sentCharsRef.current = fullText.length;

    // Send when we have enough text and hit a natural boundary
    if (
      chunkBufferRef.current.length >= MIN_CHUNK_SIZE &&
      BOUNDARY_RE.test(chunkBufferRef.current)
    ) {
      streamControllerRef.current.sendChunk(chunkBufferRef.current);
      chunkBufferRef.current = "";
    }
  }, [status, messages]);

  const handleSend = useCallback(() => {

    const text = input.trim();
    if (!text || isLoading) return;

    stopLegacyTTS();
    stopStreamTTS();
    streamControllerRef.current = null;
    setSpeakingMessageId(null);
    sendMessage({ text });
    setInput("");

  }, [input, isLoading, sendMessage, stopLegacyTTS, stopStreamTTS]);

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
        {onRestart && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRestart}
            className="flex items-center gap-1.5 shrink-0"
            aria-label="Restart session"
          >
            <RotateCcw className="size-4" />
            <span>Restart</span>
          </Button>
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
