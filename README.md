# my-first-app

A to-do app with multiple lists: a React frontend ([Vite](https://vite.dev)), a Python API
([FastAPI](https://fastapi.tiangolo.com)), and Postgres on [Neon](https://neon.com).
Hosted on [Render](https://render.com).

```
React (src/)  →  FastAPI (backend/main.py)  →  Neon Postgres
```

## Run locally

One-time setup:

```sh
npm install
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
neon env pull        # writes DATABASE_URL to .env.local (git-ignored)
```

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
| GET    | `/api/lists`            |                     |
| POST   | `/api/lists`            | `{"name": "..."}`   |
| PATCH  | `/api/lists/{id}`       | `{"name": "..."}`   |
| DELETE | `/api/lists/{id}`       |                     |
| GET    | `/api/lists/{id}/todos` |                     |
| POST   | `/api/lists/{id}/todos` | `{"title": "..."}`  |
| PATCH  | `/api/todos/{id}`       | `{"done": true}`    |
| DELETE | `/api/todos/{id}`       |                     |

Deleting a list also deletes its to-dos. The `lists` and `todos` tables are created automatically when the API starts;
to-dos from before lists existed are moved into a list called "My list".

## Deploy

`render.yaml` defines one free Render web service. It builds the React app,
installs the Python packages, and starts the API, which also serves the app.
Every push to `main` redeploys. `DATABASE_URL` is set in the Render dashboard.
