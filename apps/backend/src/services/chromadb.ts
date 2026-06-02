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
 * Sample document chunks for an organization without a specific query.
 * Returns up to `limit` chunks, useful for broad content analysis like auto-discovery.
 */
export const sampleDocumentChunks = async (
  organizationId: string,
  limit = 40
): Promise<{ ids: string[]; documents: (string | null)[] }> => {

  const collection = await getDocumentCollection();

  const results = await collection.get({
    where: { organizationId },
    limit,
  });

  logger.debug({ organizationId, count: results.ids.length }, 'Document chunks sampled from ChromaDB.');

  return {
    ids: results.ids,
    documents: results.documents,
  };
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
