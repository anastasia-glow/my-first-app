from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, StringConstraints

import skin
from db import ROOT, pool


def create_schema(conn):
    """Create the tables, and upgrade a database from before lists existed."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lists (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS todos (
            id         SERIAL PRIMARY KEY,
            list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            title      TEXT NOT NULL,
            done       BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Older todos tables have no list_id: add it and move existing todos into "My list".
    conn.execute(
        "ALTER TABLE todos ADD COLUMN IF NOT EXISTS list_id INTEGER REFERENCES lists(id) ON DELETE CASCADE"
    )
    if conn.execute("SELECT 1 FROM todos WHERE list_id IS NULL LIMIT 1").fetchone():
        list_id = conn.execute("INSERT INTO lists (name) VALUES ('My list') RETURNING id").fetchone()["id"]
        conn.execute("UPDATE todos SET list_id = %s WHERE list_id IS NULL", (list_id,))
    conn.execute("ALTER TABLE todos ALTER COLUMN list_id SET NOT NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS todos_list_id_idx ON todos (list_id)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    with pool.connection() as conn:
        create_schema(conn)
        skin.create_schema(conn)
    yield
    pool.close()


app = FastAPI(title="Anastasiabeauty API", lifespan=lifespan)
app.include_router(skin.router)


class ListCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class TodoCreate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class TodoUpdate(BaseModel):
    done: bool


@app.get("/api/health")
def health():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"ok": True}


@app.get("/api/lists")
def list_lists():
    with pool.connection() as conn:
        return conn.execute(
            """
            SELECT lists.*,
                   count(todos.id)::int AS todo_count,
                   count(todos.id) FILTER (WHERE NOT todos.done)::int AS open_count
            FROM lists LEFT JOIN todos ON todos.list_id = lists.id
            GROUP BY lists.id
            ORDER BY lists.id
            """
        ).fetchall()


@app.post("/api/lists", status_code=201)
def create_list(new_list: ListCreate):
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO lists (name) VALUES (%s) RETURNING *", (new_list.name,)
        ).fetchone()
    return {**row, "todo_count": 0, "open_count": 0}


@app.patch("/api/lists/{list_id}")
def rename_list(list_id: int, new_list: ListCreate):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE lists SET name = %s WHERE id = %s RETURNING *", (new_list.name, list_id)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "List not found")
    return row


@app.delete("/api/lists/{list_id}", status_code=204)
def delete_list(list_id: int):
    with pool.connection() as conn:
        deleted = conn.execute("DELETE FROM lists WHERE id = %s", (list_id,)).rowcount
    if not deleted:
        raise HTTPException(404, "List not found")


@app.get("/api/lists/{list_id}/todos")
def list_todos(list_id: int):
    with pool.connection() as conn:
        if not conn.execute("SELECT 1 FROM lists WHERE id = %s", (list_id,)).fetchone():
            raise HTTPException(404, "List not found")
        return conn.execute(
            "SELECT * FROM todos WHERE list_id = %s ORDER BY id", (list_id,)
        ).fetchall()


@app.post("/api/lists/{list_id}/todos", status_code=201)
def create_todo(list_id: int, todo: TodoCreate):
    with pool.connection() as conn:
        if not conn.execute("SELECT 1 FROM lists WHERE id = %s", (list_id,)).fetchone():
            raise HTTPException(404, "List not found")
        return conn.execute(
            "INSERT INTO todos (list_id, title) VALUES (%s, %s) RETURNING *",
            (list_id, todo.title),
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
