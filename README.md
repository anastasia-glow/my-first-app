# Anastasiabeauty

A skin diary with Claude-powered pattern analysis, plus multiple to-do lists:
a React frontend ([Vite](https://vite.dev)), a Python API
([FastAPI](https://fastapi.tiangolo.com)), and Postgres on [Neon](https://neon.com).
Hosted on [Render](https://render.com).

```
React (src/)  →  FastAPI (backend/)  →  Neon Postgres
                         ↘  Claude API (Analyze)
```

## Skin diary

Log one entry per day: a skin rating (1–10), morning and evening products, what
you ate, hours slept, and notes. Once you have 14 or more entries, **Analyze**
sends your last 90 days of entries to Claude (`claude-opus-5-5`) and shows which
products, foods and sleep habits line up with better or worse skin. Each
analysis is saved, so the latest one shows without calling Claude again.

## Run locally

One-time setup:

```sh
npm install
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
neon env pull        # writes DATABASE_URL to .env.local (git-ignored)
```

For **Analyze**, also add your Claude API key to `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

To try Analyze with sample data, check out a Neon dev branch
(`neon checkout dev --create`), start the API, and run
`backend/.venv/bin/python scripts/seed_sample_diary.py`. It refuses to run on
the production branch.

Then, in two terminals:

```sh
npm run api          # Python API on http://localhost:8000 (docs at /docs)
npm run dev          # React app on http://localhost:5173
```

The React dev server forwards `/api` requests to the Python API.

## API

| Method | Path                    | Body                |
| ------ | ----------------------- | ------------------- |
| GET    | `/api/health`           |                     |
| GET    | `/api/entries`          |                     |
| PUT    | `/api/entries/{date}`   | entry (see below)   |
| DELETE | `/api/entries/{date}`   |                     |
| POST   | `/api/analyze`          | `{"days": 90}` (optional) |
| GET    | `/api/analyses/latest`  |                     |
| GET    | `/api/lists`            |                     |
| POST   | `/api/lists`            | `{"name": "..."}`   |
| PATCH  | `/api/lists/{id}`       | `{"name": "..."}`   |
| DELETE | `/api/lists/{id}`       |                     |
| GET    | `/api/lists/{id}/todos` |                     |
| POST   | `/api/lists/{id}/todos` | `{"title": "..."}`  |
| PATCH  | `/api/todos/{id}`       | `{"done": true}`    |
| DELETE | `/api/todos/{id}`       |                     |

An entry is `{"rating": 1-10, "morning_products": [...], "evening_products": [...],
"food": "...", "sleep_hours": 7.5, "notes": "..."}`; saving a date that already
has an entry updates it. Deleting a list also deletes its to-dos. All tables are created automatically when the API starts;
to-dos from before lists existed are moved into a list called "My list".

## Deploy

`render.yaml` defines one free Render web service. It builds the React app,
installs the Python packages, and starts the API, which also serves the app.
Every push to `main` redeploys. `DATABASE_URL` and `ANTHROPIC_API_KEY` are set in
the Render dashboard.
