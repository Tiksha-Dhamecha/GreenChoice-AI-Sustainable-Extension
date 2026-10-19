# GreenChoice GPT-OSS 120B migration

- All four Groq inference call sites now use `openai/gpt-oss-120b`.
- Existing API routes, prompt scoring rules, response parsing, fallbacks, and browser extension logic are preserved.
- Copy `backend/.env.example` to `backend/.env`, then set `GROQ_API_KEY`.
- Install dependencies with `pip install -r backend/requirements.txt` and run `python backend/app.py`.
- No changes are necessary to `content.js` or `popup.js` because backend response contracts are unchanged.
- Model outputs can differ; test against known products before production use.
