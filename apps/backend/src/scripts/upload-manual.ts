import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { embedTexts } from '../services/embeddings.js';
import { addManualChunks, deleteManualChunks } from '../services/chromadb.js';

// Chunks a plain-text file, computes embeddings, and uploads them to the central
// Karibu manual collection (org-agnostic). Re-running with the same sourceId
// replaces the previous content for that source.
//
// Usage:
//   tsx src/scripts/upload-manual.ts <path-to-txt> [sourceId]
//
// sourceId defaults to the file name without extension (e.g. "getting-started").

// Mirrors document-processor.ts chunking so manual + org docs chunk identically.
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

const chunkText = (text: string): string[] => {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const chunk = text.slice(start, start + CHUNK_SIZE).trim();
    if (chunk.length > 0) chunks.push(chunk);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
};

const [, , filePath, sourceIdArg] = process.argv;

if (!filePath) {
  console.error('Usage: tsx src/scripts/upload-manual.ts <path-to-txt> [sourceId]');
  process.exit(1);
}

const sourceId = sourceIdArg ?? basename(filePath, extname(filePath));

async function run() {
  const filename = basename(filePath!);

  const text = await readFile(filePath!, 'utf-8');
  if (text.trim().length === 0) {
    console.error(`File is empty: ${filePath}`);
    process.exit(1);
  }

  const chunks = chunkText(text);
  console.log(`Chunked "${filename}" into ${chunks.length} chunk(s) (sourceId: ${sourceId}).`);

  const embeddings = await embedTexts(chunks);
  console.log(`Computed ${embeddings.length} embedding(s).`);

  // Replace any existing content for this sourceId so re-uploads don't duplicate.
  await deleteManualChunks(sourceId);

  const ids = await addManualChunks({ sourceId, chunks, embeddings, filename });
  console.log(`Uploaded ${ids.length} chunk(s) to the Karibu manual collection.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
