import mammoth from 'mammoth';
import { eq } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { downloadFromDocsBucket } from './s3.js';
import { addDocumentChunks } from './chromadb.js';
import { embedTexts } from './embeddings.js';
import { logger } from '../config/logger.js';

type DocumentRecord = InferSelectModel<typeof documents>;

const CHUNK_SIZE = 500;    // ~100–125 tokens, fits all-MiniLM-L6-v2's 256-token limit
const CHUNK_OVERLAP = 100; // 20% overlap to preserve cross-boundary context

export const extractText = async (buffer: Buffer, mimeType: string): Promise<string> => {
  switch (mimeType) {
    case 'application/pdf': {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useWorkerFetch: false,
        isEvalSupported: false,
        disableAutoFetch: true,
        disableStream: true,
      });
      const pdf = await loadingTask.promise;
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item: any) => ('str' in item ? item.str : '')).join(' '));
      }
      return pages.join('\n');
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case 'text/plain':
    case 'text/markdown':
      return buffer.toString('utf-8');
    default:
      throw new Error(`Unsupported MIME type for text extraction: ${mimeType}`);
  }
};

export const chunkText = (text: string): string[] => {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const chunk = text.slice(start, start + CHUNK_SIZE).trim();
    if (chunk.length > 0) chunks.push(chunk);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
};

/**
 * Full processing pipeline. Never throws — safe for fire-and-forget.
 * Status flow: processing → processed | failed
 */
export const processDocument = async (document: DocumentRecord): Promise<void> => {
  const { id: documentId, organizationId, s3Key, mimeType, name } = document;

  logger.info({ documentId, organizationId }, 'Document processing started.');

  try {
    await db.update(documents).set({ status: 'processing' }).where(eq(documents.id, documentId));
  } catch (err) {
    logger.error({ err, documentId }, 'Failed to set document status to processing.');
    return;
  }

  try {
    const buffer = await downloadFromDocsBucket(s3Key);
    const text = await extractText(buffer, mimeType);

    if (text.trim().length === 0) {
      throw new Error('Extracted text is empty — document may be image-only or corrupt.');
    }

    const chunks = chunkText(text);
    const embeddings = await embedTexts(chunks);
    const chunkIds = await addDocumentChunks({ documentId, organizationId, chunks, embeddings, filename: name });

    await db
      .update(documents)
      .set({ status: 'processed', chromaDocumentId: chunkIds[0] ?? null })
      .where(eq(documents.id, documentId));

    logger.info({ documentId, chunkCount: chunks.length }, 'Document processed successfully.');

  } catch (err) {
    logger.error({ err, documentId }, 'Document processing failed.');
    await db
      .update(documents)
      .set({ status: 'failed' })
      .where(eq(documents.id, documentId))
      .catch((err) => logger.error({ err, documentId }, 'Failed to set document status to failed.'));
  }
};
