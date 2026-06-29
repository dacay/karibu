import { CloudClient, type Collection, type EmbeddingFunction } from 'chromadb';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { embedText, embedTexts } from './embeddings.js';

let chromaClient: CloudClient | null = null;
let documentCollection: Collection | null = null;
let manualCollection: Collection | null = null;

const getChromaClient = (): CloudClient => {

  if (chromaClient) return chromaClient;

  chromaClient = new CloudClient({
    apiKey: env.CHROMA_API_KEY,
    tenant: env.CHROMA_TENANT,
    database: env.CHROMA_DATABASE,
  });

  return chromaClient;
}

/**
 * Get or create the documents collection in ChromaDB.
 * Uses the collection name from config.
 */
export const getDocumentCollection = async (): Promise<Collection> => {

  if (documentCollection) return documentCollection;

  const client = getChromaClient();

  const embeddingFunction: EmbeddingFunction = {
    generate: (texts: string[]) => embedTexts(texts),
  };

  documentCollection = await client.getOrCreateCollection({
    name: env.CHROMA_COLLECTION_NAME,
    embeddingFunction,
    metadata: { description: 'Karibu organization documents for DNA calculation' },
  });

  logger.info({ collection: env.CHROMA_COLLECTION_NAME }, 'ChromaDB collection ready.');

  return documentCollection;
}

/**
 * Get or create the central Karibu manual collection in ChromaDB.
 * This collection is organization-agnostic: it holds product documentation
 * about how to use Karibu and is shared across all organizations.
 */
export const getManualCollection = async (): Promise<Collection> => {

  if (manualCollection) return manualCollection;

  const client = getChromaClient();

  const embeddingFunction: EmbeddingFunction = {
    generate: (texts: string[]) => embedTexts(texts),
  };

  manualCollection = await client.getOrCreateCollection({
    name: env.CHROMA_MANUAL_COLLECTION_NAME,
    embeddingFunction,
    metadata: { description: 'Karibu product manual — how to use Karibu (shared across all organizations)' },
  });

  logger.info({ collection: env.CHROMA_MANUAL_COLLECTION_NAME }, 'ChromaDB manual collection ready.');

  return manualCollection;
}

export interface AddManualChunksParams {
  sourceId: string;
  chunks: string[];
  embeddings: number[][];
  filename: string;
}

/**
 * Add Karibu manual text chunks to the central (org-agnostic) collection.
 * Chunks are keyed by sourceId so a re-upload of the same source can be replaced.
 */
export const addManualChunks = async ({
  sourceId,
  chunks,
  embeddings,
  filename,
}: AddManualChunksParams): Promise<string[]> => {

  const collection = await getManualCollection();

  const ids = chunks.map((_, i) => `${sourceId}_chunk_${i}`);

  const metadatas = chunks.map(() => ({
    sourceId,
    filename,
    addedAt: new Date().toISOString(),
  }));

  await collection.add({
    ids,
    documents: chunks,
    embeddings,
    metadatas,
  });

  logger.info({ sourceId, chunkCount: chunks.length }, 'Manual chunks added to ChromaDB.');

  return ids;
}

/**
 * Delete all manual chunks for a given sourceId from the central collection.
 */
export const deleteManualChunks = async (sourceId: string): Promise<void> => {

  const collection = await getManualCollection();

  await collection.delete({
    where: { sourceId },
  });

  logger.info({ sourceId }, 'Manual chunks deleted from ChromaDB.');
}

export interface AddDocumentChunksParams {
  documentId: string;
  organizationId: string;
  chunks: string[];
  embeddings: number[][];
  filename: string;
}

/**
 * Add document text chunks to ChromaDB with pre-computed embeddings.
 * Each chunk is stored with metadata for filtering by organization/document.
 */
export const addDocumentChunks = async ({
  documentId,
  organizationId,
  chunks,
  embeddings,
  filename,
}: AddDocumentChunksParams): Promise<string[]> => {

  const collection = await getDocumentCollection();

  const ids = chunks.map((_, i) => `${documentId}_chunk_${i}`);

  const metadatas = chunks.map(() => ({
    documentId,
    organizationId,
    filename,
    addedAt: new Date().toISOString(),
  }));

  await collection.add({
    ids,
    documents: chunks,
    embeddings,
    metadatas,
  });

  logger.info({ documentId, chunkCount: chunks.length }, 'Document chunks added to ChromaDB.');

  return ids;
}

/**
 * Delete all chunks for a given document from ChromaDB.
 */
export const deleteDocumentChunks = async (documentId: string): Promise<void> => {

  const collection = await getDocumentCollection();

  await collection.delete({
    where: { documentId },
  });

  logger.info({ documentId }, 'Document chunks deleted from ChromaDB.');
}

export interface QueryResult {
  ids: string[];
  documents: (string | null)[];
  distances: (number | null)[] | null;
  metadatas: (Record<string, string> | null)[];
}

/**
 * Query the documents collection for chunks relevant to a query string.
 * Optionally filter by organizationId to scope results to a tenant.
 */
export const queryDocuments = async (
  queryText: string,
  organizationId: string,
  nResults = 10
): Promise<QueryResult> => {

  const collection = await getDocumentCollection();

  const queryEmbedding = await embedText(queryText);

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults,
    where: { organizationId },
  });

  return {
    ids: results.ids[0] ?? [],
    documents: results.documents[0] ?? [],
    distances: results.distances?.[0] ?? null,
    metadatas: (results.metadatas[0] ?? []) as (Record<string, string> | null)[],
  };
}

/**
 * Query the central Karibu manual collection for chunks relevant to a query string.
 * Unlike queryDocuments, this is NOT scoped to an organization — the manual is shared.
 */
export const queryManual = async (
  queryText: string,
  nResults = 5
): Promise<QueryResult> => {

  const collection = await getManualCollection();

  const queryEmbedding = await embedText(queryText);

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults,
  });

  return {
    ids: results.ids[0] ?? [],
    documents: results.documents[0] ?? [],
    distances: results.distances?.[0] ?? null,
    metadatas: (results.metadatas[0] ?? []) as (Record<string, string> | null)[],
  };
}

/**
 * Sample document chunks for an organization without a specific query, useful for
 * broad content analysis like auto-discovery.
 *
 * A plain `get` with a `limit` returns a contiguous head slice of the collection,
 * which over-represents whichever document was inserted first (and only its opening
 * chunks). To stay representative regardless of corpus size this instead:
 *   1. fetches every chunk for the org (a metadata scan — cheap),
 *   2. when the total exceeds `cap`, allocates the cap across documents round-robin
 *      so a single large document cannot crowd out smaller ones, and
 *   3. picks each document's quota evenly strided across its full length, so a
 *      document is characterized by its whole span rather than just its intro.
 * Results are interleaved across documents so any downstream truncation stays balanced.
 */
export const sampleDocumentChunks = async (
  organizationId: string,
  cap = 800
): Promise<{ ids: string[]; documents: (string | null)[] }> => {

  const collection = await getDocumentCollection();

  const results = await collection.get({
    where: { organizationId },
  });

  // Group chunk positions by document, recovering the document id and in-doc index
  // from the `${documentId}_chunk_${i}` id format written by addDocumentChunks.
  const byDocument = new Map<string, { id: string; document: string | null; index: number }[]>();

  results.ids.forEach((id, i) => {
    const sep = id.lastIndexOf('_chunk_');
    const documentId = sep === -1 ? id : id.slice(0, sep);
    const index = sep === -1 ? i : Number(id.slice(sep + '_chunk_'.length));

    const list = byDocument.get(documentId) ?? [];
    list.push({ id, document: results.documents[i] ?? null, index: Number.isNaN(index) ? i : index });
    byDocument.set(documentId, list);
  });

  // Sort each document's chunks into reading order so striding spans beginning → end.
  for (const list of byDocument.values()) {
    list.sort((a, b) => a.index - b.index);
  }

  const docIds = [...byDocument.keys()];
  const total = results.ids.length;

  // Allocate the cap across documents round-robin: each pass hands one slot to every
  // document that still has chunks left, so small documents fill up and the remainder
  // flows to larger ones — never one document monopolizing the budget.
  const quota = new Map<string, number>(docIds.map((d) => [d, 0]));
  let slots = Math.min(cap, total);
  while (slots > 0) {
    let progressed = false;
    for (const docId of docIds) {
      if (slots === 0) break;
      if ((quota.get(docId) ?? 0) < byDocument.get(docId)!.length) {
        quota.set(docId, (quota.get(docId) ?? 0) + 1);
        slots--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  // For each document, pick its quota evenly strided across its full set of chunks.
  const picked = new Map<string, { id: string; document: string | null }[]>();
  for (const docId of docIds) {
    const list = byDocument.get(docId)!;
    const take = quota.get(docId) ?? 0;
    const chosen =
      take >= list.length
        ? list
        : Array.from({ length: take }, (_, k) => list[Math.floor((k * list.length) / take)]);
    picked.set(docId, chosen.map(({ id, document }) => ({ id, document })));
  }

  // Interleave across documents (round-robin) so the result stays balanced even if
  // the caller only consumes a prefix of it.
  const ids: string[] = [];
  const documents: (string | null)[] = [];
  const maxLen = Math.max(0, ...docIds.map((d) => picked.get(d)!.length));
  for (let round = 0; round < maxLen; round++) {
    for (const docId of docIds) {
      const item = picked.get(docId)![round];
      if (item) {
        ids.push(item.id);
        documents.push(item.document);
      }
    }
  }

  logger.debug(
    { organizationId, total, documentCount: docIds.length, sampled: ids.length },
    'Document chunks sampled from ChromaDB.'
  );

  return { ids, documents };
}

/**
 * Check connectivity to ChromaDB by listing collections.
 */
export const checkChromaConnection = async (): Promise<boolean> => {

  try {

    const client = getChromaClient();
    await client.listCollections();

    return true;

  } catch (err) {

    logger.warn({ err }, 'ChromaDB connection check failed.');

    return false;
  }
}
