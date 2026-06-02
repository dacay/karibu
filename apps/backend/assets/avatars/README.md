# Built-in avatar images

These images are uploaded to the assets bucket (CDN-fronted) and attached to the
built-in avatars seeded by `src/scripts/seed.defaults.ts` (`seedBuiltInAvatars`).

Each avatar's `imageFile` in that script points to one of the files below. Drop the
corresponding photo here using the exact filename, then run the seed:

```bash
pnpm db:seed:defaults   # or pnpm db:seed:dev
```

| File         | Avatar | Voice (Deepgram)        | Description of the source photo                                  |
| ------------ | ------ | ----------------------- | ---------------------------------------------------------------- |
| `amara.jpg`  | Amara  | Athena (authoritative)  | Professional woman in a navy blazer and glasses, office setting  |
| `mei.jpg`    | Mei    | Aurora (bright)         | Young woman in a denim shirt with a bright, cheerful smile       |
| `nora.jpg`   | Nora   | Asteria (warm)          | Nurse in blue scrubs with a stethoscope, hospital corridor       |
| `julian.jpg` | Julian | Orion (deep)            | Man in a white lab coat and glasses, neutral grey background     |
| `diego.jpg`  | Diego  | Apollo (engaging)       | Man with glasses and a beard in a casual tee, home-office setting |

## Notes

- Supported formats: JPEG, PNG, WebP, GIF. If you use a different extension, update
  the matching `imageFile` entry in `seed.defaults.ts`.
- Seeding is resilient: if a file is missing or S3 isn't configured, the avatar is
  still created/updated — just without an image. Re-running the seed once the file
  and S3 credentials are present will backfill the image.
- Built-in avatar images are stored under the shared key `builtin/avatars/{slug}.{ext}`
  (no per-organization scoping), built by `buildBuiltInAvatarImageKey` in `services/s3.ts`.
