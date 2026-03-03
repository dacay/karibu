import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { sql } from '../db/index.js';
import { logger } from '../config/logger.js';

const metricsRouter = new Hono();

metricsRouter.use('*', authMiddleware());
metricsRouter.use('*', requireRole('admin'));

/**
 * GET /metrics
 * Returns all dashboard metrics for the current organization (admin only).
 *
 * Metrics:
 *   i.   Usage frequency: how often learners used it (sessions per day, totals)
 *   ii.  Session duration: how long they used it (avg/min/max in minutes)
 *   iii. Messages per day per nurse
 *   iv.  Return visits: nurses who came back after microlearning completion, with monthly delta
 *   v.   Time to complete a microlearning: avg/min/max in both minutes and message count
 *   vi.  Microlearnings completed this month
 */
metricsRouter.get('/', async (c) => {

  const auth = c.get('auth');
  const orgId = auth.organizationId;

  logger.info({ orgId }, 'Fetching metrics...');

  const [
    usageFrequency,
    sessionDuration,
    messagesPerDayPerNurse,
    returnVisits,
    completionMetrics,
    completionsThisMonth,
  ] = await Promise.all([
    getUsageFrequency(orgId),
    getSessionDuration(orgId),
    getMessagesPerDayPerNurse(orgId),
    getReturnVisits(orgId),
    getCompletionMetrics(orgId),
    getCompletionsThisMonth(orgId),
  ]);

  logger.info({ orgId }, 'Metrics fetched.');

  return c.json({
    usageFrequency,
    sessionDuration,
    messagesPerDayPerNurse,
    returnVisits,
    completionMetrics,
    completionsThisMonth,
  });
});

// i. How often learners used it
async function getUsageFrequency(orgId: string) {

  const [totals] = await sql<[{ total_sessions: string; unique_learners: string }]>`
    SELECT
      COUNT(DISTINCT c.id)      AS total_sessions,
      COUNT(DISTINCT c.user_id) AS unique_learners
    FROM chats c
    JOIN users u ON c.user_id = u.id
    WHERE c.organization_id = ${orgId}
      AND u.role = 'user'
  `;

  const sessionsPerDay = await sql<Array<{ date: string; count: string }>>`
    SELECT
      DATE(c.created_at)::text AS date,
      COUNT(*)::text           AS count
    FROM chats c
    JOIN users u ON c.user_id = u.id
    WHERE c.organization_id = ${orgId}
      AND u.role = 'user'
    GROUP BY DATE(c.created_at)
    ORDER BY date DESC
    LIMIT 30
  `;

  return {
    totalSessions: parseInt(totals.total_sessions, 10),
    uniqueLearners: parseInt(totals.unique_learners, 10),
    sessionsPerDay: sessionsPerDay.map((r) => ({
      date: r.date,
      count: parseInt(r.count, 10),
    })),
  };
}

// ii. How long they used it (session duration in minutes)
async function getSessionDuration(orgId: string) {

  const [stats] = await sql<[{
    avg_minutes: string | null;
    min_minutes: string | null;
    max_minutes: string | null;
  }]>`
    SELECT
      ROUND(AVG(duration_minutes)::numeric, 1)::text AS avg_minutes,
      ROUND(MIN(duration_minutes)::numeric, 1)::text AS min_minutes,
      ROUND(MAX(duration_minutes)::numeric, 1)::text AS max_minutes
    FROM (
      SELECT
        EXTRACT(EPOCH FROM (MAX(cm.created_at) - MIN(cm.created_at))) / 60 AS duration_minutes
      FROM chats c
      JOIN chat_messages cm ON cm.chat_id = c.id
      JOIN users u           ON c.user_id  = u.id
      WHERE c.organization_id = ${orgId}
        AND u.role = 'user'
      GROUP BY c.id
      HAVING COUNT(cm.id) > 1
    ) durations
  `;

  return {
    avgMinutes: stats.avg_minutes !== null ? parseFloat(stats.avg_minutes) : null,
    minMinutes: stats.min_minutes !== null ? parseFloat(stats.min_minutes) : null,
    maxMinutes: stats.max_minutes !== null ? parseFloat(stats.max_minutes) : null,
  };
}

// iii. Messages per day per nurse (user-sent messages only)
async function getMessagesPerDayPerNurse(orgId: string) {

  const rows = await sql<Array<{
    user_id: string;
    email: string;
    date: string;
    message_count: string;
  }>>`
    SELECT
      u.id                         AS user_id,
      u.email,
      DATE(cm.created_at)::text    AS date,
      COUNT(cm.id)::text           AS message_count
    FROM chat_messages cm
    JOIN chats c ON cm.chat_id = c.id
    JOIN users u  ON c.user_id  = u.id
    WHERE c.organization_id = ${orgId}
      AND u.role = 'user'
      AND cm.role = 'user'
    GROUP BY u.id, u.email, DATE(cm.created_at)
    ORDER BY date DESC, message_count DESC
    LIMIT 200
  `;

  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    date: r.date,
    messageCount: parseInt(r.message_count, 10),
  }));
}

// iv. How many nurses went back after microlearning completed and asked a different question
async function getReturnVisits(orgId: string) {

  // Total unique return visitors (ever)
  const [totals] = await sql<[{ total: string; total_learners: string }]>`
    WITH completed_users AS (
      SELECT
        mp.user_id,
        MAX(mp.completed_at) AS last_completion
      FROM microlearning_progress mp
      JOIN users u ON mp.user_id = u.id
      WHERE u.organization_id = ${orgId}
        AND mp.status = 'completed'
      GROUP BY mp.user_id
    ),
    return_visitors AS (
      SELECT DISTINCT cu.user_id
      FROM completed_users cu
      JOIN chats c ON c.user_id = cu.user_id
      WHERE c.organization_id = ${orgId}
        AND c.created_at > cu.last_completion
    ),
    all_learners AS (
      SELECT COUNT(DISTINCT user_id) AS cnt
      FROM completed_users
    )
    SELECT
      (SELECT COUNT(*) FROM return_visitors)::text AS total,
      (SELECT cnt      FROM all_learners)::text    AS total_learners
  `;

  // Return visitors by month (for delta over time)
  const byMonth = await sql<Array<{ month: string; count: string }>>`
    WITH completed_users AS (
      SELECT
        mp.user_id,
        mp.completed_at
      FROM microlearning_progress mp
      JOIN users u ON mp.user_id = u.id
      WHERE u.organization_id = ${orgId}
        AND mp.status = 'completed'
    )
    SELECT
      TO_CHAR(DATE_TRUNC('month', c.created_at), 'YYYY-MM') AS month,
      COUNT(DISTINCT c.user_id)::text                        AS count
    FROM chats c
    JOIN completed_users cu
      ON c.user_id = cu.user_id
     AND c.created_at > cu.completed_at
    WHERE c.organization_id = ${orgId}
    GROUP BY DATE_TRUNC('month', c.created_at)
    ORDER BY month ASC
  `;

  const total = parseInt(totals.total, 10);
  const totalLearners = parseInt(totals.total_learners, 10);

  // Delta: this month vs last month
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const thisMonthCount = parseInt(byMonth.find((r) => r.month === thisMonth)?.count ?? '0', 10);
  const lastMonthCount = parseInt(byMonth.find((r) => r.month === lastMonth)?.count ?? '0', 10);

  return {
    total,
    totalLearners,
    percentOfLearners: totalLearners > 0 ? Math.round((total / totalLearners) * 100) : 0,
    deltaVsLastMonth: thisMonthCount - lastMonthCount,
    thisMonthCount,
    lastMonthCount,
    byMonth: byMonth.map((r) => ({ month: r.month, count: parseInt(r.count, 10) })),
  };
}

// v. Average and range of time to reach a completed microlearning
async function getCompletionMetrics(orgId: string) {

  // Duration in minutes (opened_at → completed_at)
  const [timeStats] = await sql<[{
    avg_minutes: string | null;
    min_minutes: string | null;
    max_minutes: string | null;
  }]>`
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (mp.completed_at - mp.opened_at)) / 60)::numeric, 1)::text AS avg_minutes,
      ROUND(MIN(EXTRACT(EPOCH FROM (mp.completed_at - mp.opened_at)) / 60)::numeric, 1)::text AS min_minutes,
      ROUND(MAX(EXTRACT(EPOCH FROM (mp.completed_at - mp.opened_at)) / 60)::numeric, 1)::text AS max_minutes
    FROM microlearning_progress mp
    JOIN users u ON mp.user_id = u.id
    WHERE u.organization_id = ${orgId}
      AND mp.status = 'completed'
      AND mp.completed_at IS NOT NULL
  `;

  // Message count to completion (messages in the linked microlearning chat)
  const [msgStats] = await sql<[{
    avg_messages: string | null;
    min_messages: string | null;
    max_messages: string | null;
  }]>`
    SELECT
      ROUND(AVG(msg_count)::numeric, 1)::text AS avg_messages,
      MIN(msg_count)::text                     AS min_messages,
      MAX(msg_count)::text                     AS max_messages
    FROM (
      SELECT
        mp.id,
        COUNT(cm.id) AS msg_count
      FROM microlearning_progress mp
      JOIN users u   ON mp.user_id        = u.id
      JOIN chats c   ON c.user_id         = mp.user_id
                     AND c.microlearning_id = mp.microlearning_id
      JOIN chat_messages cm ON cm.chat_id = c.id
      WHERE u.organization_id = ${orgId}
        AND mp.status = 'completed'
      GROUP BY mp.id
    ) counts
  `;

  return {
    avgMinutes: timeStats.avg_minutes !== null ? parseFloat(timeStats.avg_minutes) : null,
    minMinutes: timeStats.min_minutes !== null ? parseFloat(timeStats.min_minutes) : null,
    maxMinutes: timeStats.max_minutes !== null ? parseFloat(timeStats.max_minutes) : null,
    avgMessages: msgStats.avg_messages !== null ? parseFloat(msgStats.avg_messages) : null,
    minMessages: msgStats.min_messages !== null ? parseInt(msgStats.min_messages, 10) : null,
    maxMessages: msgStats.max_messages !== null ? parseInt(msgStats.max_messages, 10) : null,
  };
}

// vi. Microlearnings completed over the current month
async function getCompletionsThisMonth(orgId: string) {

  const [row] = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count
    FROM microlearning_progress mp
    JOIN users u ON mp.user_id = u.id
    WHERE u.organization_id = ${orgId}
      AND mp.status = 'completed'
      AND mp.completed_at >= DATE_TRUNC('month', NOW())
      AND mp.completed_at <  DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
  `;

  return parseInt(row.count, 10);
}

export default metricsRouter;
