"use client";

import { useCallback, useRef, useState } from "react";

export type StreamTTSState =
  | "idle"       // nothing happening
  | "connecting" // WebSocket connecting
  | "streaming"  // receiving audio and playing
  | "draining"   // WebSocket closed, audio still playing
  | "error";

export interface UseStreamTTSReturn {
  state: StreamTTSState;
  isSpeaking: boolean;
  /** Open a TTS WebSocket. Returns a controller to send chunks, or null on error. */
  startStream: (voiceId?: string, onDone?: () => void) => StreamTTSController | null;
  /** Stop playback immediately and close the connection. */
  stop: () => void;
}

export interface StreamTTSController {
  /** Send a text chunk to be synthesized. */
  sendChunk: (text: string) => void;
  /** Signal that all text has been sent — flushes remaining audio then closes. */
  finish: () => void;
}

const SAMPLE_RATE = 24000;

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("karibu_token");
}

function getWsBaseUrl(): string {
  const httpUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
  // If the template includes {subdomain}, resolve it the same way getApiBaseUrl does
  let resolved = httpUrl;
  if (resolved.includes("{subdomain}") && typeof window !== "undefined") {
    const subdomain = window.location.hostname.split(".")[0];
    resolved = resolved.replace("{subdomain}", subdomain);
  }
  return resolved.replace(/^http/, "ws");
}

/**
 * Hook for streaming TTS via Deepgram WebSocket.
 *
 * Opens a WebSocket to the backend, sends text chunks as they arrive from the
 * LLM stream, receives linear16 PCM audio, and plays it with gapless scheduling
 * via AudioContext.
 */
export function useStreamTTS(): UseStreamTTSReturn {
  const [state, setState] = useState<StreamTTSState>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const onDoneCallbackRef = useRef<(() => void) | null>(null);
  const streamFinishedRef = useRef(false);

  const checkDrained = useCallback(() => {
    if (streamFinishedRef.current && activeSourcesRef.current.size === 0) {
      setState("idle");
      const cb = onDoneCallbackRef.current;
      onDoneCallbackRef.current = null;
      cb?.();
    }
  }, []);

  const cleanup = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }

    // Stop all scheduled audio sources
    for (const src of activeSourcesRef.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    activeSourcesRef.current.clear();

    // Close AudioContext
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;

    nextPlayTimeRef.current = 0;
    streamFinishedRef.current = false;
    onDoneCallbackRef.current = null;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setState("idle");
  }, [cleanup]);

  const playPcmChunk = useCallback((pcmData: ArrayBuffer) => {
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
    }

    // Resume if suspended (browser autoplay policy)
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    // Convert Int16 PCM to Float32
    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(nextPlayTimeRef.current, now);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      checkDrained();
    };
  }, [checkDrained]);

  const startStream = useCallback(
    (voiceId?: string, onDone?: () => void): StreamTTSController | null => {
      stop();

      const token = getToken();
      if (!token) {
        setState("error");
        return null;
      }

      setState("connecting");
      streamFinishedRef.current = false;
      onDoneCallbackRef.current = onDone ?? null;

      const wsBase = getWsBaseUrl();
      const params = new URLSearchParams({ token });
      if (voiceId) params.set("voiceId", voiceId);
      const url = `${wsBase}/chat/tts-stream?${params}`;

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current === ws) {
          setState("streaming");
        }
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          if (event.data.byteLength > 0) {
            playPcmChunk(event.data);
          }
        } else {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === "flushed" || msg.type === "done") {
              streamFinishedRef.current = true;
              setState("draining");
              checkDrained();
            } else if (msg.type === "error") {
              console.error("TTS stream error:", msg.message);
              cleanup();
              setState("error");
            }
          } catch {
            // Ignore
          }
        }
      };

      ws.onerror = () => {
        if (wsRef.current === ws) {
          cleanup();
          setState("error");
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          if (!streamFinishedRef.current) {
            // Unexpected close — mark finished and drain
            streamFinishedRef.current = true;
            setState("draining");
            checkDrained();
          }
        }
      };

      const controller: StreamTTSController = {
        sendChunk(text: string) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "chunk", text }));
          }
        },
        finish() {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "flush" }));
            ws.send(JSON.stringify({ type: "close" }));
          }
        },
      };

      return controller;
    },
    [stop, cleanup, playPcmChunk, checkDrained]
  );

  const isSpeaking = state === "streaming" || state === "draining" || state === "connecting";

  return { state, isSpeaking, startStream, stop };
}
