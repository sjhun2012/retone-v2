# Re:Tone v2

This source package intentionally excludes API keys and local environment files. Set `OPENAI_API_KEY` to enable AI features.

For a presentation-only deployment, `DATABASE_URL` is optional: accounts and chat data stay in memory and reset when the server restarts. Set `DATABASE_URL` to a PostgreSQL connection string to persist accounts, AI cache, and reports.
