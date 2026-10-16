"""Skin diary: one entry per day, plus Claude-powered pattern analysis."""

import json
import os
import random
from datetime import date, timedelta
from typing import Annotated, Literal

import anthropic
from fastapi import APIRouter, HTTPException
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, StringConstraints, field_validator

from db import pool

router = APIRouter(prefix="/api")

MODEL = "claude-opus-5-5"
MIN_ENTRIES = 14

ProductName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


def create_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS skin_entries (
            entry_date       DATE PRIMARY KEY,
            rating           SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 10),
            morning_products TEXT[] NOT NULL DEFAULT '{}',
            evening_products TEXT[] NOT NULL DEFAULT '{}',
            food             TEXT NOT NULL DEFAULT '',
            sleep_hours      REAL NOT NULL CHECK (sleep_hours BETWEEN 0 AND 24),
            notes            TEXT NOT NULL DEFAULT '',
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS skin_analyses (
            id          SERIAL PRIMARY KEY,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            date_from   DATE NOT NULL,
            date_to     DATE NOT NULL,
            entry_count INTEGER NOT NULL,
            model       TEXT NOT NULL,
            result      JSONB NOT NULL
        )
        """
    )


# --- Entries -----------------------------------------------------------------


class EntryIn(BaseModel):
    rating: int = Field(ge=1, le=10)
    morning_products: list[ProductName] = Field(default_factory=list, max_length=30)
    evening_products: list[ProductName] = Field(default_factory=list, max_length=30)
    food: LongText = ""
    sleep_hours: float = Field(ge=0, le=24)
    notes: LongText = ""

    @field_validator("morning_products", "evening_products")
    @classmethod
    def clean_products(cls, products: list[str]) -> list[str]:
        # Drop blanks and case-insensitive duplicates, keeping the first spelling
        seen, cleaned = set(), []
        for p in products:
            if p and p.lower() not in seen:
                seen.add(p.lower())
                cleaned.append(p)
        return cleaned


@router.get("/entries")
def list_entries():
    with pool.connection() as conn:
        return conn.execute("SELECT * FROM skin_entries ORDER BY entry_date DESC").fetchall()


@router.put("/entries/{entry_date}")
def save_entry(entry_date: date, entry: EntryIn):
    # Allow one day ahead: the server's clock (UTC) can be behind the user's
    if entry_date > date.today() + timedelta(days=1):
        raise HTTPException(422, "Entries can't be in the future")
    with pool.connection() as conn:
        return conn.execute(
            """
            INSERT INTO skin_entries
                (entry_date, rating, morning_products, evening_products, food, sleep_hours, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (entry_date) DO UPDATE SET
                rating = EXCLUDED.rating,
                morning_products = EXCLUDED.morning_products,
                evening_products = EXCLUDED.evening_products,
                food = EXCLUDED.food,
                sleep_hours = EXCLUDED.sleep_hours,
                notes = EXCLUDED.notes,
                updated_at = now()
            RETURNING *
            """,
            (
                entry_date,
                entry.rating,
                entry.morning_products,
                entry.evening_products,
                entry.food,
                entry.sleep_hours,
                entry.notes,
            ),
        ).fetchone()


@router.delete("/entries/{entry_date}", status_code=204)
def delete_entry(entry_date: date):
    with pool.connection() as conn:
        deleted = conn.execute("DELETE FROM skin_entries WHERE entry_date = %s", (entry_date,)).rowcount
    if not deleted:
        raise HTTPException(404, "Entry not found")


# --- Analysis ----------------------------------------------------------------


class Pattern(BaseModel):
    factor: str = Field(description="The product, food, sleep habit or other factor, named as in the diary")
    kind: Literal["product", "food", "sleep", "other"]
    effect: Literal["better", "worse"] = Field(description="Whether it lines up with better or worse skin")
    evidence: str = Field(description="What in the entries shows this, with dates or average ratings")
    confidence: Literal["low", "medium", "high"]


class SkinAnalysis(BaseModel):
    summary: str = Field(description="Two or three sentences on the overall picture")
    patterns: list[Pattern]
    suggestions: list[str] = Field(description="Small, concrete things to try or keep tracking")
    caveats: str = Field(description="Limits of this analysis, and anything worth seeing a dermatologist about")


SYSTEM_PROMPT = """\
You analyze a personal skin diary to find patterns between daily habits and skin condition. \
Each entry has a date, a skin rating from 1 (worst) to 10 (best), the products used in the \
morning and evening, what the person ate, hours slept, and optional notes.

Look for factors - specific products, foods or kinds of food, amount of sleep, and anything \
in the notes - that line up with better or worse ratings. Consider delayed effects: food, \
sleep and new products often show in the skin one to three days later rather than the same \
day. Compare ratings on days with and without a factor, and ground every pattern in the \
actual entries, citing dates or average ratings as evidence. Rate confidence by how many days \
support a pattern; with a few weeks of data most patterns are tentative, and it is fine to \
report few or no patterns if the data doesn't show any.

These are correlations in a small personal dataset, not proof of cause, and not medical \
advice. If the entries suggest something worth a dermatologist's attention, such as \
persistently low ratings or notes about reactions, say so in the caveats.

Write in plain, friendly language addressed to the person as "you"."""

_client = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        # Reads ANTHROPIC_API_KEY from the environment (.env.local locally, Render's env vars in production)
        _client = anthropic.Anthropic(timeout=300.0)
    return _client


def analyze_with_claude(entries) -> tuple[str, SkinAnalysis]:
    diary = [
        {
            "date": e["entry_date"].isoformat(),
            "rating": e["rating"],
            "morning_products": e["morning_products"],
            "evening_products": e["evening_products"],
            "food": e["food"],
            "sleep_hours": e["sleep_hours"],
            "notes": e["notes"],
        }
        for e in entries
    ]
    prompt = (
        f"Here are my skin diary entries for {diary[0]['date']} to {diary[-1]['date']} "
        f"({len(diary)} days, oldest first), as JSON:\n\n"
        + "\n".join(json.dumps(d, ensure_ascii=False) for d in diary)
        + "\n\nWhat patterns do you see?"
    )

    try:
        response = get_client().beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            output_config={"effort": "high"},
            # If a safety classifier declines, retry on Anthropic's recommended fallback model
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            output_format=SkinAnalysis,
        )
    except anthropic.AuthenticationError:
        raise HTTPException(503, "Analysis isn't set up: the Claude API key is missing or invalid.")
    except anthropic.RateLimitError:
        raise HTTPException(503, "Claude is busy right now - try again in a minute.")
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"Claude API error ({e.status_code}). Try again later.")
    except anthropic.APIConnectionError:
        raise HTTPException(502, "Couldn't reach the Claude API. Try again later.")

    if response.stop_reason == "refusal":
        raise HTTPException(502, "Claude declined to analyze these entries.")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise HTTPException(502, "Claude's analysis came back incomplete. Try again.")

    return response.model, response.parsed_output


# Used while no ANTHROPIC_API_KEY is configured: random patterns built from the
# diary's own product and food names, clearly labelled so nobody mistakes them
# for a real analysis. Adding the key switches Analyze over to Claude.
PLACEHOLDER_MODEL = "placeholder"


def placeholder_analysis(entries) -> SkinAnalysis:
    products = sorted({p for e in entries for p in e["morning_products"] + e["evening_products"]})
    foods = sorted({f.strip() for e in entries for f in e["food"].split(",") if f.strip()})
    factors = (
        [(p, "product") for p in random.sample(products, min(2, len(products)))]
        + [(f, "food") for f in random.sample(foods, min(2, len(foods)))]
        + [(random.choice(["Under 6 hours of sleep", "8+ hours of sleep"]), "sleep")]
    )
    random.shuffle(factors)
    ratings = [e["rating"] for e in entries]
    return SkinAnalysis(
        summary=(
            "Placeholder results - not a real analysis. These patterns were picked at random "
            f"from the {len(entries)} entries in your diary to preview how results will look. "
            "Connect a Claude API key to get a real analysis."
        ),
        patterns=[
            Pattern(
                factor=factor,
                kind=kind,
                effect=random.choice(["better", "worse"]),
                evidence=(
                    f"Random placeholder text. Average rating {random.uniform(3, 8):.1f} on "
                    f"{random.randint(2, max(2, len(entries) // 2))} days with this, vs "
                    f"{sum(ratings) / len(ratings):.1f} overall (made-up comparison)."
                ),
                confidence=random.choice(["low", "medium", "high"]),
            )
            for factor, kind in factors
        ],
        suggestions=random.sample(
            [
                "Placeholder: keep logging every day so patterns have more data.",
                "Placeholder: note new products on the day you start them.",
                "Placeholder: try logging what you ate in a bit more detail.",
                "Placeholder: record stress, weather or your cycle in the notes.",
            ],
            k=2,
        ),
        caveats="These are randomly generated placeholder results and say nothing about your skin.",
    )


class AnalyzeRequest(BaseModel):
    days: int = Field(default=90, ge=MIN_ENTRIES, le=365)


@router.get("/analyses/latest")
def latest_analysis():
    with pool.connection() as conn:
        return conn.execute("SELECT * FROM skin_analyses ORDER BY id DESC LIMIT 1").fetchone()


@router.post("/analyze", status_code=201)
def analyze(req: AnalyzeRequest | None = None):
    days = (req or AnalyzeRequest()).days
    with pool.connection() as conn:
        # Count back from the most recent entry, not the server's clock
        entries = conn.execute(
            """
            SELECT * FROM skin_entries
            WHERE entry_date > (SELECT max(entry_date) FROM skin_entries) - %s::int
            ORDER BY entry_date
            """,
            (days,),
        ).fetchall()
    if len(entries) < MIN_ENTRIES:
        raise HTTPException(
            400,
            f"Log at least {MIN_ENTRIES} days to analyze - you have {len(entries)} "
            f"in the last {days} days.",
        )

    if os.environ.get("ANTHROPIC_API_KEY"):
        model, analysis = analyze_with_claude(entries)
    else:
        model, analysis = PLACEHOLDER_MODEL, placeholder_analysis(entries)

    with pool.connection() as conn:
        return conn.execute(
            """
            INSERT INTO skin_analyses (date_from, date_to, entry_count, model, result)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                entries[0]["entry_date"],
                entries[-1]["entry_date"],
                len(entries),
                model,
                Jsonb(analysis.model_dump()),
            ),
        ).fetchone()
