import WebSocket from 'ws';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const DEEPGRAM_TTS_WS_URL = 'wss://api.deepgram.com/v1/speak';
const SAMPLE_RATE = 24000;

/**
 * Handle a client WebSocket connection for streaming TTS.
 *
 * Protocol (client → server):
 *   { type: "chunk", text: "..." }   – send text to Deepgram for synthesis
 *   { type: "flush" }                – flush remaining buffered audio
 *   { type: "close" }                – signal end of input
 *
 * Protocol (server → client):
 *   Binary frames                     – raw linear16 PCM audio at 24 kHz
 *   { type: "flushed" }              – Deepgram finished flushing
 *   { type: "done" }                 – stream complete, connection closing
 *   { type: "error", message: "..." } – error occurred
 */
export function handleTTSStream(clientWs: WebSocket, voiceId: string) {
  if (!env.DEEPGRAM_API_KEY) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'TTS is not configured on this server.' }));
    clientWs.close();
    return;
  }

  const dgUrl = new URL(DEEPGRAM_TTS_WS_URL);
  dgUrl.searchParams.set('model', voiceId);
  dgUrl.searchParams.set('encoding', 'linear16');
  dgUrl.searchParams.set('sample_rate', String(SAMPLE_RATE));
  dgUrl.searchParams.set('container', 'none');

  const dgWs = new WebSocket(dgUrl.toString(), {
    headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` },
  });

  let dgOpen = false;
  const pendingMessages: string[] = [];

  dgWs.on('open', () => {
    dgOpen = true;
    // Drain any messages that arrived before Deepgram connected
    for (const msg of pendingMessages) {
      dgWs.send(msg);
    }
    pendingMessages.length = 0;
  });

  // Forward audio from Deepgram to client
  dgWs.on('message', (data, isBinary) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;

    if (isBinary) {
      clientWs.send(data, { binary: true });
    } else {
      // Deepgram sends JSON metadata (Flushed, Warning, etc.)
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'Flushed') {
          clientWs.send(JSON.stringify({ type: 'flushed' }));
        }
      } catch {
        // Ignore unparseable messages
      }
    }
  });

  dgWs.on('error', (err) => {
    logger.error({ err }, 'Deepgram TTS WebSocket error');
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'TTS stream failed' }));
      clientWs.close();
    }
  });

  dgWs.on('close', () => {
    dgOpen = false;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'done' }));
      clientWs.close();
    }
  });

  // Handle messages from client
  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      const forward = (payload: string) => {
        if (dgOpen) {
          dgWs.send(payload);
        } else {
          pendingMessages.push(payload);
        }
      };

      switch (msg.type) {
        case 'chunk':
          if (typeof msg.text === 'string' && msg.text.length > 0) {
            forward(JSON.stringify({ type: 'Speak', text: msg.text }));
          }
          break;
        case 'flush':
          forward(JSON.stringify({ type: 'Flush' }));
          break;
        case 'close':
          forward(JSON.stringify({ type: 'Close' }));
          break;
        default:
          break;
      }
    } catch {
      logger.warn('Received invalid TTS stream message from client');
    }
  });

  // Cleanup when client disconnects
  clientWs.on('close', () => {
    if (dgWs.readyState === WebSocket.OPEN || dgWs.readyState === WebSocket.CONNECTING) {
      dgWs.close();
    }
  });

  clientWs.on('error', (err) => {
    logger.error({ err }, 'Client TTS WebSocket error');
    if (dgWs.readyState === WebSocket.OPEN) {
      dgWs.close();
    }
  });
}
