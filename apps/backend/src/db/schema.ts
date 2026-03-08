import { pgTable, uuid, text, timestamp, pgEnum, jsonb, integer, index, boolean } from 'drizzle-orm/pg-core';

// Role enum
export const roleEnum = pgEnum('role', ['admin', 'user']);

// Microlearning status enum
export const microlearningStatusEnum = pgEnum('microlearning_status', ['draft', 'published']);

// Timestamp helpers
const timestamps = {
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
};

// Organizations table
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  subdomain: text('subdomain').notNull().unique(),
  pronunciation: text('pronunciation'),
  learnerTerm: text('learner_term').notNull().default('user'),
  learnerTermPlural: text('learner_term_plural').notNull().default('users'),
  ...timestamps,
});

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(), // bcrypt hashed
  phoneNumber: text('phone_number'), // E.164 format (e.g., +14155552671)
  role: roleEnum('role').notNull().default('user'),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  // User's preferred avatar — stored as plain uuid (no FK) to avoid circular reference with avatars table
  preferredAvatarId: uuid('preferred_avatar_id'),
  ...timestamps,
});

// Auth sessions table - tracks active JWT tokens for revocation
export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(), // JWT ID (jti claim)
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'), // null = active, set = revoked
  ipAddress: text('ip_address'), // Optional: track where session was created
  userAgent: text('user_agent'), // Optional: track client info
  createdAt: timestamps.createdAt,
});

// Notification logs table - records every notification attempt and its outcome
export const notificationChannelEnum = pgEnum('notification_channel', ['sms']);
export const notificationStatusEnum = pgEnum('notification_status', ['sent', 'failed']);

export const notificationLogs = pgTable('notification_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel: notificationChannelEnum('channel').notNull(),
  status: notificationStatusEnum('status').notNull(),
  metadata: jsonb('metadata'), // platform-specific payload (e.g. Twilio SID, error details)
  createdAt: timestamps.createdAt,
});

// Auth tokens table - for direct URL login (magic links, etc.)
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(), // Unique token (use crypto.randomBytes)
  expiresAt: timestamp('expires_at').notNull(),
  lastUsedAt: timestamp('last_used_at'), // Track last time the token was used
  createdAt: timestamps.createdAt,
});

// Microlearning sequences table
export const microlearningSequences = pgTable('microlearning_sequences', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  ...timestamps,
});

// Microlearnings table
export const microlearnings = pgTable('microlearnings', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: microlearningStatusEnum('status').notNull().default('draft'),
  topicId: uuid('topic_id').references(() => dnaTopics.id, { onDelete: 'set null' }),
  subtopicIds: jsonb('subtopic_ids').$type<string[]>(),
  patternId: uuid('pattern_id').references(() => conversationPatterns.id, { onDelete: 'set null' }),
  avatarId: uuid('avatar_id').references(() => avatars.id, { onDelete: 'set null' }),
  sequenceId: uuid('sequence_id').references(() => microlearningSequences.id, { onDelete: 'set null' }),
  position: integer('position'),
  ...timestamps,
});

// User groups table - named cohorts within an organization (e.g. "All Members")
export const userGroups = pgTable('user_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isAll: boolean('is_all').notNull().default(false),
  createdAt: timestamps.createdAt,
}, (table) => [
  index('user_groups_organization_id_idx').on(table.organizationId),
]);

// User group members table
export const userGroupMembers = pgTable('user_group_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamps.createdAt,
});

// Microlearning sequence assignments table - assigns a sequence to a user group
export const microlearningSequenceAssignments = pgTable('microlearning_sequence_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sequenceId: uuid('sequence_id').notNull().references(() => microlearningSequences.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  createdAt: timestamps.createdAt,
});

// Microlearning progress table - tracks user interaction with a microlearning
export const microlearningProgressStatusEnum = pgEnum('microlearning_progress_status', ['active', 'completed', 'expired']);

export const microlearningProgress = pgTable('microlearning_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  microlearningId: uuid('microlearning_id').notNull().references(() => microlearnings.id, { onDelete: 'cascade' }),
  status: microlearningProgressStatusEnum('status').notNull().default('active'),
  openedAt: timestamp('opened_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  expiredAt: timestamp('expired_at'),
});

// Chat type enum
export const chatTypeEnum = pgEnum('chat_type', ['microlearning', 'discussion']);

// Chats table - AI conversation sessions
export const chats = pgTable('chats', {
  id: text('id').primaryKey(), // client-generated UUID (passed from useChat)
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  type: chatTypeEnum('type').notNull(),
  microlearningId: uuid('microlearning_id').references(() => microlearnings.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  index('chats_user_id_idx').on(table.userId),
]);

// Chat messages table - individual messages in AI SDK UIMessage format
export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(), // server-generated via createIdGenerator
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  parts: jsonb('parts').notNull(), // UIMessage parts array
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('chat_messages_chat_id_idx').on(table.chatId),
]);

// DNA enums
export const dnaSourceEnum = pgEnum('dna_source', ['manual', 'discovered']);
export const dnaStatusEnum = pgEnum('dna_status', ['suggested', 'active', 'rejected']);
export const dnaSynthesisStatusEnum = pgEnum('dna_synthesis_status', ['idle', 'running', 'done', 'failed']);
export const dnaApprovalEnum = pgEnum('dna_approval', ['pending', 'approved', 'rejected']);

// DNA topics table - top-level knowledge domains
export const dnaTopics = pgTable('dna_topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  source: dnaSourceEnum('source').notNull().default('manual'),
  status: dnaStatusEnum('status').notNull().default('active'),
  ...timestamps,
}, (table) => [
  index('dna_topics_organization_id_idx').on(table.organizationId),
]);

// DNA subtopics table - specific aspects within a topic
export const dnaSubtopics = pgTable('dna_subtopics', {
  id: uuid('id').primaryKey().defaultRandom(),
  topicId: uuid('topic_id').notNull().references(() => dnaTopics.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  source: dnaSourceEnum('source').notNull().default('manual'),
  status: dnaStatusEnum('status').notNull().default('active'),
  synthesisStatus: dnaSynthesisStatusEnum('synthesis_status').notNull().default('idle'),
  lastSynthesizedAt: timestamp('last_synthesized_at'),
  ...timestamps,
}, (table) => [
  index('dna_subtopics_topic_id_idx').on(table.topicId),
  index('dna_subtopics_organization_id_idx').on(table.organizationId),
]);

// DNA values table - synthesized content for a subtopic, subject to human approval
export const dnaValues = pgTable('dna_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  subtopicId: uuid('subtopic_id').notNull().references(() => dnaSubtopics.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  approval: dnaApprovalEnum('approval').notNull().default('pending'),
  userEdited: boolean('user_edited').notNull().default(false),
  ...timestamps,
}, (table) => [
  index('dna_values_subtopic_id_idx').on(table.subtopicId),
]);

// Conversation patterns table - defines AI conversation modes for microlearnings
export const conversationPatterns = pgTable('conversation_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }), // null = built-in global pattern
  name: text('name').notNull(),
  description: text('description').notNull(),
  prompt: text('prompt').notNull(),
  isBuiltIn: boolean('is_built_in').notNull().default(false),
  ...timestamps,
}, (table) => [
  index('conversation_patterns_organization_id_idx').on(table.organizationId),
]);

// Avatars table - AI personas with name, personality, image and voice
export const avatars = pgTable('avatars', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }), // null = built-in
  name: text('name').notNull(),
  personality: text('personality').notNull(),
  imageS3Key: text('image_s3_key'),
  imageS3Bucket: text('image_s3_bucket'),
  voiceId: text('voice_id').notNull(),
  isBuiltIn: boolean('is_built_in').notNull().default(false),
  ...timestamps,
}, (table) => [
  index('avatars_organization_id_idx').on(table.organizationId),
]);

// Flagged messages status enum
export const flaggedMessageStatusEnum = pgEnum('flagged_message_status', ['open', 'reviewed', 'dismissed']);

// Flagged messages table - messages flagged by users as potentially incorrect
export const flaggedMessages = pgTable('flagged_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: text('message_id').notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  flaggedBy: uuid('flagged_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  status: flaggedMessageStatusEnum('status').notNull().default('open'),
  ...timestamps,
}, (table) => [
  index('flagged_messages_organization_id_idx').on(table.organizationId),
  index('flagged_messages_status_idx').on(table.status),
]);

// Document status enum
export const documentStatusEnum = pgEnum('document_status', ['uploaded', 'processing', 'processed', 'failed']);

// Documents table - uploaded source documents for DNA calculation
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // original filename
  s3Key: text('s3_key').notNull(), // S3 object key
  s3Bucket: text('s3_bucket').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  status: documentStatusEnum('status').notNull().default('uploaded'),
  chromaDocumentId: text('chroma_document_id'), // ChromaDB document ID once embedded
  ...timestamps,
}, (table) => [
  index('documents_organization_id_idx').on(table.organizationId),
]);
