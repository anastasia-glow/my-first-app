import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent

# Locally, `neon deploy` writes DATABASE_URL to .env.local. On Render it is set
# as an environment variable instead, and this does nothing.
load_dotenv(ROOT / ".env.local")

# DATABASE_URL is Neon's pooled connection (PgBouncer in transaction mode),
# which doesn't support prepared statements, so they are turned off.
pool = ConnectionPool(
    os.environ["DATABASE_URL"],
    kwargs={"prepare_threshold": None, "row_factory": dict_row},
    min_size=0,
    max_size=5,
    open=False,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    with pool.connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS todos (
                id         SERIAL PRIMARY KEY,
                title      TEXT NOT NULL,
                done       BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
    yield
    pool.close()


app = FastAPI(title="my-first-app API", lifespan=lifespan)


class TodoCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class TodoUpdate(BaseModel):
    done: bool


@app.get("/api/health")
def health():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"ok": True}


@app.get("/api/todos")
def list_todos():
    with pool.connection() as conn:
        return conn.execute("SELECT * FROM todos ORDER BY id").fetchall()


@app.post("/api/todos", status_code=201)
def create_todo(todo: TodoCreate):
    with pool.connection() as conn:
        return conn.execute(
            "INSERT INTO todos (title) VALUES (%s) RETURNING *", (todo.title.strip(),)
        ).fetchone()


@app.patch("/api/todos/{todo_id}")
def update_todo(todo_id: int, todo: TodoUpdate):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE todos SET done = %s WHERE id = %s RETURNING *", (todo.done, todo_id)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Todo not found")
    return row


@app.delete("/api/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: int):
    with pool.connection() as conn:
        deleted = conn.execute("DELETE FROM todos WHERE id = %s", (todo_id,)).rowcount
    if not deleted:
        raise HTTPException(404, "Todo not found")


# Serve the built React app (from `npm run build`) for every non-API path.
# Mounted last so the /api routes above take priority.
dist = ROOT / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
