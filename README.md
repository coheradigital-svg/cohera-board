# Cohera Board

Internal board for Cohera Digital. Static page on GitHub Pages, data in Supabase.

- `index.html`, `app.js`, `board.css`, `parser.js`, `calendar.js` — the app
- `db-supabase.js`, `config.js` — data layer and public settings
- `supabase/schema.sql` — run once in the Supabase SQL editor
- `tools/board.py` — Claude reads and writes rows with the service key from the private `.env`
