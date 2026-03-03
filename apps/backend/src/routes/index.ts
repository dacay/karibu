import { Hono } from 'hono';
import health from './health.js';
import auth from './auth.js';
import chat from './chat.js';
import documents from './documents.js';
import userRouter from './user.js';
import dna from './dna.js';
import team from './team.js';
import patterns from './patterns.js';
import avatarsRouter from './avatars.js';
import org from './org.js';
import microlearnings from './microlearnings.js';
import userGroups from './user-groups.js';

import { organizationMiddleware } from '../middleware/organization.js';

export const registerRoutes = (app: Hono) => {

  // Health check route (no organization context needed)
  app.route('/', health);

  // Apply organization middleware to all non-health routes
  app.use('*', organizationMiddleware());

  // Authentication routes
  app.route('/auth', auth);

  // Chat routes (auth middleware applied inside chat router)
  app.route('/chat', chat);

  // Document upload and management routes
  app.route('/documents', documents);

  // DNA topics, subtopics, and values routes
  app.route('/dna', dna);

  // Team management routes (admin only)
  app.route('/team', team);

  // Conversation patterns routes (admin only)
  app.route('/patterns', patterns);

  // Avatar management routes (admin only)
  app.route('/avatars', avatarsRouter);

  // Organization config routes (admin only)
  app.route('/org', org);

  // Microlearning and sequence routes (admin only)
  app.route('/microlearnings', microlearnings);

  // User group management routes (admin only)
  app.route('/user-groups', userGroups);

  // User profile and preferences routes
  app.route('/user', userRouter);
}
