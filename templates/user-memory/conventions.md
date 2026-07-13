# Memory conventions

These rules govern every file in this workspace. The worker (read/write) must
follow them.

## Layout

- `index.md` — index of every file here; one line per file. Keep it accurate.
- `profile.md` — core facts about the user: identity, key people, standing
  preferences that affect daily assistance. Check here first.
- `people/<first-name>.md` — one file per person in the user's life.
- `preferences/<area>.md` — likes and dislikes grouped by area
  (e.g. `preferences/food.md`, `preferences/entertainment.md`).
- `projects/<name>.md` — ongoing goals, plans, and projects.
- `notes/<topic>.md` — anything that fits nowhere else.
- `documents/<name>.<ext>` — long source material (stories, articles, pasted
  text). Do not grep or fully read documents unless the task is about that
  document; rely on the index summary instead.

## Writing rules

- Write facts in third person about the user: `- 2026-07-10: Bob is allergic
  to nuts.` Never first person.
- One fact per bullet, prefixed with the ISO date it was recorded.
- Append new bullets; do not rewrite existing bullets except to correct them.
  When correcting, replace the bullet rather than adding a contradicting one.
- A fact lives in exactly one file. If it could fit two, put it in the more
  specific one. Cross-reference with `[[path/to/other-file.md]]` when useful.
- File names: lowercase kebab-case with `.md` extension.

## Index format

One line per file, exactly:

- `path/from/root.md` — one-line summary (updated YYYY-MM-DD)

Whenever you create or change a file: add its line, or update its summary (if
the meaning changed) and its date (always).
