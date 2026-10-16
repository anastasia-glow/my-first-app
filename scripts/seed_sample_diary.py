"""Fill the skin diary with 21 days of sample entries that contain known patterns.

For testing the Analyze feature on a Neon *dev branch* only - it refuses to run
against the production branch. Usage: backend/.venv/bin/python scripts/seed_sample_diary.py

Planted patterns: dairy or sweets -> worse skin the next day; under 6 hours of
sleep -> worse; niacinamide serum the evening before -> better.
"""

import json
import os
import random
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from dotenv import dotenv_values

env = dotenv_values(Path(__file__).resolve().parent.parent / ".env.local")
if env.get("NEON_BRANCH", "production") == "production":
    raise SystemExit("Refusing to seed the production branch - run `neon checkout <dev-branch> --create` first.")

API = os.environ.get("API", "http://localhost:8000/api")
random.seed(7)
foods = ["oats and berries", "chicken salad", "salmon and rice", "veggie stir fry", "lentil soup"]
treats = ["cheese pizza", "ice cream", "milk chocolate", "latte and croissant"]

start = date.today() - timedelta(days=21)
prev_treat = prev_serum = False
for i in range(21):
    day = start + timedelta(days=i)
    treat = random.random() < 0.3
    serum = random.random() < 0.5
    sleep = random.choice([5, 5.5, 6.5, 7, 7.5, 8, 8])
    rating = 6 - 2 * prev_treat + 2 * prev_serum - 2 * (sleep < 6) + random.choice([-1, 0, 0, 1])
    entry = {
        "rating": max(1, min(10, rating)),
        "morning_products": ["Gentle cleanser", "SPF 50"],
        "evening_products": ["Gentle cleanser", "Moisturizer"] + (["Niacinamide serum"] if serum else []),
        "food": ", ".join(random.sample(foods, 2) + ([random.choice(treats)] if treat else [])),
        "sleep_hours": sleep,
        "notes": "a couple of new spots on chin" if prev_treat else "",
    }
    req = urllib.request.Request(
        f"{API}/entries/{day.isoformat()}", data=json.dumps(entry).encode(), method="PUT",
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req).read()
    prev_treat, prev_serum = treat, serum
print(f"Seeded 21 entries from {start} on branch {env['NEON_BRANCH']}")
