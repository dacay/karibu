# Built-in avatar images

These images are uploaded to the assets bucket (CDN-fronted) and attached to the
built-in avatars seeded by `src/scripts/seed.defaults.ts` (`seedBuiltInAvatars`).
The avatar definitions themselves live in `src/config/built-in-avatars.ts`
(`BUILT_IN_AVATARS`), shared between the seed script and the chat routes.

Each avatar's `imageFile` in `BUILT_IN_AVATARS` points to one of the files below. Drop the
corresponding photo here using the exact filename, then run the seed:

```bash
pnpm db:seed:defaults   # or pnpm db:seed:dev
```

| File         | Avatar | Voice EN / ES              | Description of the source photo |
| ------------ | ------ | -------------------------- | ------------------------------- |
| `maria.jpg`  | Maria  | Janus / Estrella           |                                 |
| `sofia.jpg`  | Sofia  | Electra / Diana            |                                 |
| `ana.jpg`    | Ana    | Harmonia / Selena          |                                 |
| `daniel.jpg` | Daniel | Orpheus / Néstor           |                                 |
| `david.jpg`  | David  | Mars / Sirio               |                                 |
| `alex.jpg`   | Alex   | Odysseus / Javier          |                                 |

## Notes

- Supported formats: JPEG, PNG, WebP, GIF. If you use a different extension, update
  the matching `imageFile` entry in `built-in-avatars.ts`.
- Seeding is resilient: if a file is missing or S3 isn't configured, the avatar is
  still created/updated — just without an image. Re-running the seed once the file
  and S3 credentials are present will backfill the image.
- Built-in avatar images are stored under the shared key `builtin/avatars/{slug}.{ext}`
  (no per-organization scoping), built by `buildBuiltInAvatarImageKey` in `services/s3.ts`.
