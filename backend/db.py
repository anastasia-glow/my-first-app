import os
from pathlib import Path

from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

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
