import type { AvatarLocalization } from '../db/schema.js';

export interface BuiltInAvatar {
  slug: string;
  name: string;
  imageFile: string;
  localizations: Record<string, AvatarLocalization>;
}

// Built-in avatars available to all organizations.
// organizationId is null — these are global personas.
// `imageFile` refers to a bundled image under apps/backend/assets/avatars/.
// Each avatar is authored as an English + Spanish pair under `localizations`.
// A localization's `voiceId` is a Deepgram Aura-2 voice id (see DEEPGRAM_VOICES in
// the web app). Its `description` is written in the first person and in that
// language: it is both spoken as the avatar's self-introduction
// ("Hi, I'm {name}. {description}") and injected into the chat system prompt to
// shape the AI's tone — so keep it to a single short sentence about tone only.
// Deliberately no backstory: personas describe how the avatar speaks, never who
// they are, so they can never compete with the organization's source of truth.
//
// BUILT_IN_AVATARS[0] is also the code-level fallback persona used when a
// session has neither a learner-preferred nor an org-default avatar.
export const BUILT_IN_AVATARS: BuiltInAvatar[] = [
  {
    slug: 'maria',
    name: 'Maria',
    imageFile: 'maria.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-janus-en', // Southern, smooth, trustworthy
        description: " ",
      },
      es: {
        voiceId: 'aura-2-estrella-es', // Warm, articulate
        description: ' ',
      },
    },
  },
  {
    slug: 'sofia',
    name: 'Sofia',
    imageFile: 'sofia.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-electra-en', // Professional, engaging
        description: " ",
      },
      es: {
        voiceId: 'aura-2-diana-es', // Confident, polished
        description: ' ',
      },
    },
  },
  {
    slug: 'daniel',
    name: 'Daniel',
    imageFile: 'daniel.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-orpheus-en', // Rich, expressive
        description: " ",
      },
      es: {
        voiceId: 'aura-2-nestor-es', // Assertive, professional
        description: ' ',
      },
    },
  },
  {
    slug: 'david',
    name: 'David',
    imageFile: 'david.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-mars-en', // Smooth, patient baritone
        description: " ",
      },
      es: {
        voiceId: 'aura-2-sirio-es', // Deep, resonant
        description: 'Soy tranquilo y paciente, y me apoyo en ejemplos breves y cotidianos.',
      },
    },
  }
];
