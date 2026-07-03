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
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*(\d+)\.\s+/gm, "$1. ")
    .replace(/^[-*_]{3,}$/gm, "")
    .replace(/\|/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`#]/g, "")
    // ── Speech normalization (spoken form, not visual) ──
    // Expand Latin abbreviations Deepgram mangles ("e.g." etc.), and turn
    // parentheticals into comma-delimited asides so they get a natural pause
    // instead of running straight into the surrounding sentence.
    .replace(/\be\.g\./gi, "for example")
    .replace(/\bi\.e\./gi, "that is")
    .replace(/\betc\./gi, "and so on")
    .replace(/\bvs\.?/gi, "versus")
    .replace(/[“”"]/g, "")              // Deepgram shifts voice for quoted spans; drop the quotes
    .replace(/\s+\/\s+/g, ", ")         // spaced slash "A / B" reads as a hard stop → soft comma pause
    .replace(/\s*[()]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/,\s*(?=[.,!?;:])/g, "")   // comma sitting directly before other punctuation
    .replace(/([:;])\s*,\s*/g, "$1 ")   // punctuation immediately followed by a stray comma
    .replace(/,\s*,+/g, ", ")           // collapse doubled commas
    .trim()
    .replace(/^[\s,]+/, "");            // strip a leading comma left by an opening paren
}

// ─── Utterance segmentation for TTS ─────────────────────────────────────────

/**
 * Carve complete "utterances" out of buffered RAW (un-stripped) text so each
 * one can be markdown-stripped and sent to Deepgram whole.
 *
 * Boundaries are newlines and sentence punctuation *followed by whitespace* — so
 * decimals ("3.14") and the dot in a list marker ("1. Confirm") are NOT treated
 * as sentence ends. A completed segment that still has no letters (a bare "1.")
 * is held back and merged into the next one, so the list number stays attached
 * to its item and is read in context ("One. Prepare…") rather than in isolation.
 *
 * Returns the finished utterances plus the trailing partial to keep buffered.
 */
function takeUtterances(buf: string): { utterances: string[]; rest: string } {
  const boundary = /\n+|[.!?]+(?=\s)/g;
  const utterances: string[] = [];
  let last = 0;
  let pending = "";
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(buf)) !== null) {
    const end = m.index + m[0].length;
    pending += buf.slice(last, end);
    last = end;
    if (/[a-zA-Z]/.test(pending)) {
      utterances.push(pending);
      pending = "";
    }
  }
  return { utterances, rest: pending + buf.slice(last) };
}

/**
 * List items and headers have no terminal punctuation, so Deepgram would read
 * them straight into the next line as one run-on sentence. Give every chunk a
 * real full stop: Deepgram does NOT pause on a trailing `:` `;` or `,`, so strip
 * those and append a period unless the chunk already ends in `.` `!` or `?`.
 */
function withSentenceStop(s: string): string {
  const trimmed = s.replace(/[\s:;,]+$/, "");
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : trimmed + ".";
}

export function ChatInterface({
  endpoint,
  chatId,
  initialMessages,
  microlearningId,
  avatar,
  autoPlayVoice = false,
  className,
  onComplete,
  onLanguageChange,
  onRestart,
}: ChatConfig) {

  const resolvedAvatar = { ...DEFAULT_AVATAR, ...avatar };

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const hasAutoStarted = useRef(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  // Streaming TTS
  const { startStream, stop: stopStreamTTS, pause: pauseStreamTTS, resume: resumeStreamTTS, isSpeaking, isPaused: isSpeechPaused } = useStreamTTS();
  const streamControllerRef = useRef<StreamTTSController | null>(null);
  const sentCharsRef = useRef(0);
  const chunkBufferRef = useRef("");

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

  // Watch messages for a language change the AI applied via the setLanguage tool.
  // Fires once per new assistant message id so a switch propagates to the rest
  // of the app (profile, voice, avatar filtering).
  const lastLanguageMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1] as UIMessage | undefined;
    const changed = (last?.metadata as { languageChanged?: string } | undefined)?.languageChanged;
    if (last?.role === "assistant" && changed && lastLanguageMsgIdRef.current !== last.id) {
      lastLanguageMsgIdRef.current = last.id;
      onLanguageChange?.(changed);
    }
  }, [messages, onLanguageChange]);

  const isLoading = status === "submitted" || status === "streaming";

  // Refs for stale-closure–safe access inside async callbacks
  const modeRef        = useRef(mode);
  const voicePausedRef = useRef(voicePaused);
  useEffect(() => { modeRef.current        = mode;        }, [mode]);
  useEffect(() => { voicePausedRef.current = voicePaused; }, [voicePaused]);

  // Voice transcript handler — auto-send in voice mode, fill input in text mode
  const handleVoiceTranscript = useCallback((text: string) => {
    if (modeRef.current === "voice") {
      stopStreamTTS();
      setSpeakingMessageId(null);
      sendMessage({ text });
    } else {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    }
  }, [sendMessage, stopStreamTTS]);

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
    stopStreamTTS();
    streamControllerRef.current = null;
    setSpeakingMessageId(null);
    discardListening();
    setVoicePaused(true);
  }, [stopStreamTTS, discardListening]);

  // Resume: unpause and start listening
  const handleStartVoice = useCallback(() => {
    setVoicePaused(false);
    voicePausedRef.current = false;
    startListeningRef.current();
  }, []);

  // Pause AI playback mid-speech. Audio context is suspended; resuming continues
  // from the exact position. The stream keeps buffering in the background.
  const handlePauseSpeech = useCallback(() => {
    pauseStreamTTS();
  }, [pauseStreamTTS]);

  const handleResumeSpeech = useCallback(() => {
    resumeStreamTTS();
  }, [resumeStreamTTS]);

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

    // When streaming finishes: flush remaining buffer and close the TTS stream
    if (justFinishedStreaming && streamControllerRef.current) {
      const last = messages[messages.length - 1] as UIMessage | undefined;
      if (last?.role === "assistant") {
        // Pull in any raw text that streamed in after the last chunk effect,
        // then strip + send the whole remaining buffer as the final utterance.
        const rawFull = extractText(last);
        chunkBufferRef.current += rawFull.slice(sentCharsRef.current);
        sentCharsRef.current = rawFull.length;

        const clean = stripMarkdown(chunkBufferRef.current);
        if (clean.length > 0) {
          streamControllerRef.current.sendChunk(withSentenceStop(clean) + " ");
        }
        chunkBufferRef.current = "";
      }

      streamControllerRef.current.finish();
      streamControllerRef.current = null;
      chunkBufferRef.current = "";
    }

  }, [status, messages, autoPlayVoice, startStream, resolvedAvatar.voiceId]);

  // ─── Streaming TTS: send text chunks as the LLM streams ────────────────────

  useEffect(() => {
    if (status !== "streaming" || !streamControllerRef.current) return;

    const controller = streamControllerRef.current;
    const last = messages[messages.length - 1] as UIMessage | undefined;
    if (last?.role !== "assistant") return;

    // Cursor tracks the RAW, append-only message text so it never drifts.
    // (stripMarkdown is NOT prefix-stable across streaming ticks — cursoring
    // into its cumulative output drops characters at token boundaries.)
    const rawFull = extractText(last);
    const newRaw = rawFull.slice(sentCharsRef.current);
    if (newRaw.length === 0) return;

    chunkBufferRef.current += newRaw;
    sentCharsRef.current = rawFull.length;

    // Flush complete utterances; keep the trailing partial buffered so markdown
    // tokens (and list markers) are stripped whole, never split across a chunk.
    const { utterances, rest } = takeUtterances(chunkBufferRef.current);
    chunkBufferRef.current = rest;
    for (const utterance of utterances) {
      const clean = stripMarkdown(utterance);
      if (clean.length > 0) controller.sendChunk(withSentenceStop(clean) + " ");
    }
  }, [status, messages]);

  const submitText = useCallback((text: string) => {

    if (!text || isLoading) return;

    stopStreamTTS();
    streamControllerRef.current = null;
    setSpeakingMessageId(null);
    sendMessage({ text });

  }, [isLoading, sendMessage, stopStreamTTS]);

  const handleSend = useCallback(() => {

    const text = input.trim();
    if (!text) return;
    submitText(text);
    setInput("");

  }, [input, submitText]);

  const handleOptionClick = useCallback((text: string) => {

    submitText(text);
  }, [submitText]);

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
        onOptionClick={handleOptionClick}
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
        isSpeechPaused={isSpeechPaused}
        voicePaused={voicePaused}
        onStopVoice={handleStopVoice}
        onStartVoice={handleStartVoice}
        onPauseSpeech={handlePauseSpeech}
        onResumeSpeech={handleResumeSpeech}
      />
    </div>
  );
}
