# Personal Dashboard — Plan 1: Vault Engine Extensions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the vault Python engine with streaming mbox ingestion, LLM email classification, entity extraction, source extraction, async job queue, and new API endpoints so Plan 2 (Marble Dashboard) can query structured Shopping/Entertainment/Travel data.

**Architecture:** New tables (`personal_items`, `personal_deals`, `personal_gaps`, `ingestion_jobs`) are added to DuckDB. An async job queue (asyncio) processes mbox files in the background via a streaming parser that never buffers the full file. New FastAPI routes expose the extracted data and job status.

**Tech Stack:** Python 3.11+, FastAPI, DuckDB, asyncio, httpx (async HTTP), pytest. All new code lives in `/srv/projects/vivo-user-profile-vault/`.

**Depends on:** Nothing — this plan is self-contained and testable standalone.
**Required by:** Plan 2 (Marble Dashboard) consumes the API endpoints defined here.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `engine/py/user_profile_engine/storage/duckdb_store.py` | Modify | Add 4 new tables + CRUD methods |
| `engine/py/user_profile_engine/ingest/streaming_mbox_parser.py` | Create | Streaming `From `-boundary mbox parser |
| `engine/py/user_profile_engine/ingest/email_classifier.py` | Create | LLM batch classifier (shopping/entertainment/travel/promo/other) |
| `engine/py/user_profile_engine/ingest/entity_extractor.py` | Create | LLM entity extractor for classified emails |
| `engine/py/user_profile_engine/ingest/source_extractor.py` | Create | Deduplicate sender domains → source records |
| `engine/py/user_profile_engine/jobs/ingestion_job.py` | Create | Async job queue + orchestration |
| `engine/py/user_profile_engine/api/server.py` | Modify | Add personal endpoints + async upload |
| `tests/test_streaming_mbox_parser.py` | Create | Parser unit tests |
| `tests/test_email_classifier.py` | Create | Classifier tests (stub LLM) |
| `tests/test_entity_extractor.py` | Create | Extractor tests (stub LLM) |
| `tests/test_source_extractor.py` | Create | Source extractor unit tests |
| `tests/test_duckdb_personal_tables.py` | Create | DuckDB schema + CRUD tests |

---

## Task 1: Add personal tables to DuckDB

**Files:**
- Modify: `engine/py/user_profile_engine/storage/duckdb_store.py`
- Create: `tests/test_duckdb_personal_tables.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_duckdb_personal_tables.py
import tempfile
from pathlib import Path
from datetime import datetime, timezone
import pytest
from user_profile_engine.storage.duckdb_store import DuckDBStore

@pytest.fixture
def store(tmp_path):
    return DuckDBStore(tmp_path / "test.duckdb")

def test_personal_items_table_exists(store):
    rows = store.conn.execute("select count(*) from personal_items").fetchone()
    assert rows[0] == 0

def test_insert_and_query_personal_item(store):
    now = datetime.now(timezone.utc)
    store.insert_personal_items([{
        "item_id": "item-1",
        "message_id": "msg-1",
        "category": "shopping",
        "subcategory": "footwear",
        "merchant": "Nike",
        "item_name": "Air Max 270",
        "amount": 129.0,
        "currency": "EUR",
        "order_id": "ORD-001",
        "item_date": now,
        "media_url": None,
        "raw_json": "{}",
        "ingested_at": now,
    }])
    items = store.list_personal_items(category="shopping")
    assert len(items) == 1
    assert items[0]["merchant"] == "Nike"

def test_insert_personal_deal(store):
    now = datetime.now(timezone.utc)
    store.upsert_personal_deal({
        "deal_id": "deal-1",
        "source_type": "mbox_promo",
        "category": "shopping",
        "merchant": "Nike",
        "title": "Summer Sale 30%",
        "discount": "30%",
        "promo_code": "SUMMER30",
        "expires_at": None,
        "url": "https://nike.com/sale",
        "media_url": None,
        "marble_score": 0.0,
        "raw_json": "{}",
        "ingested_at": now,
        "archived_at": None,
    })
    deals = store.list_personal_deals(category="shopping")
    assert len(deals) == 1
    assert deals[0]["promo_code"] == "SUMMER30"

def test_insert_personal_gap(store):
    now = datetime.now(timezone.utc)
    import json
    store.upsert_personal_gap({
        "gap_id": "gap-1",
        "gap_type": "overdue",
        "category": "shopping",
        "title": "Running shoes overdue",
        "rationale": "Last bought 18 months ago",
        "confidence": 0.87,
        "suggested_action": "Replace before winter",
        "related_merchant": "Nike",
        "expires_at": None,
        "created_at": now,
    })
    gaps = store.list_personal_gaps(category="shopping")
    assert len(gaps) == 1
    assert gaps[0]["confidence"] == 0.87

def test_ingestion_job_lifecycle(store):
    now = datetime.now(timezone.utc)
    store.create_ingestion_job("job-1", "/tmp/test.mbox")
    store.update_ingestion_job("job-1", status="running", total_emails=100)
    store.update_ingestion_job("job-1", processed_emails=50)
    store.update_ingestion_job("job-1", status="completed", processed_emails=100, completed_at=now)
    job = store.get_ingestion_job("job-1")
    assert job["status"] == "completed"
    assert job["processed_emails"] == 100
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_duckdb_personal_tables.py -v 2>&1 | head -30
```

Expected: FAIL — `AttributeError: 'DuckDBStore' object has no attribute 'insert_personal_items'`

- [ ] **Step 3: Add tables and methods to DuckDBStore**

Append to `_init_schema` (inside the triple-quoted SQL, after the `alerts` table block):

```python
          create table if not exists personal_items (
              item_id varchar primary key,
              message_id varchar,
              category varchar,
              subcategory varchar,
              merchant varchar,
              item_name varchar,
              amount double,
              currency varchar,
              order_id varchar,
              item_date timestamp,
              media_url varchar,
              raw_json varchar,
              ingested_at timestamp
          );

          create table if not exists personal_deals (
              deal_id varchar primary key,
              source_type varchar,
              category varchar,
              merchant varchar,
              title varchar,
              discount varchar,
              promo_code varchar,
              expires_at timestamp,
              url varchar,
              media_url varchar,
              marble_score double,
              raw_json varchar,
              ingested_at timestamp,
              archived_at timestamp
          );

          create table if not exists personal_gaps (
              gap_id varchar primary key,
              gap_type varchar,
              category varchar,
              title varchar,
              rationale varchar,
              confidence double,
              suggested_action varchar,
              related_merchant varchar,
              expires_at timestamp,
              created_at timestamp
          );

          create table if not exists ingestion_jobs (
              job_id varchar primary key,
              status varchar,
              source_path varchar,
              total_emails integer,
              processed_emails integer,
              classified_emails integer,
              entities_extracted integer,
              started_at timestamp,
              completed_at timestamp,
              error_text varchar
          );
```

Then add these methods to the `DuckDBStore` class (after `ack_alert`):

```python
    def insert_personal_items(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        with self._lock:
            self.conn.executemany(
                """insert or replace into personal_items values
                   (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [(r["item_id"], r["message_id"], r["category"], r["subcategory"],
                  r["merchant"], r["item_name"], r["amount"], r["currency"],
                  r["order_id"], r["item_date"], r["media_url"], r["raw_json"],
                  r["ingested_at"]) for r in rows],
            )
        return len(rows)

    def list_personal_items(self, category: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        q = "select * from personal_items"
        params: list[Any] = []
        if category:
            q += " where category = ?"
            params.append(category)
        q += " order by item_date desc limit ?"
        params.append(limit)
        return self._records(q, params)

    def upsert_personal_deal(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.conn.execute(
                """insert or replace into personal_deals values
                   (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (row["deal_id"], row["source_type"], row["category"], row["merchant"],
                 row["title"], row["discount"], row["promo_code"], row["expires_at"],
                 row["url"], row["media_url"], row["marble_score"], row["raw_json"],
                 row["ingested_at"], row["archived_at"]),
            )

    def list_personal_deals(self, category: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        q = "select * from personal_deals where archived_at is null"
        params: list[Any] = []
        if category:
            q += " and category = ?"
            params.append(category)
        q += " order by marble_score desc, ingested_at desc limit ?"
        params.append(limit)
        return self._records(q, params)

    def upsert_personal_gap(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.conn.execute(
                """insert or replace into personal_gaps values
                   (?,?,?,?,?,?,?,?,?,?)""",
                (row["gap_id"], row["gap_type"], row["category"], row["title"],
                 row["rationale"], row["confidence"], row["suggested_action"],
                 row["related_merchant"], row["expires_at"], row["created_at"]),
            )

    def list_personal_gaps(self, category: str | None = None) -> list[dict[str, Any]]:
        q = "select * from personal_gaps where expires_at is null or expires_at > now()"
        params: list[Any] = []
        if category:
            q += " and category = ?"
            params.append(category)
        q += " order by confidence desc"
        return self._records(q, params)

    def create_ingestion_job(self, job_id: str, source_path: str) -> None:
        with self._lock:
            self.conn.execute(
                "insert into ingestion_jobs values (?,?,?,?,?,?,?,?,?,?)",
                [job_id, "queued", source_path, 0, 0, 0, 0,
                 datetime.now(timezone.utc), None, None],
            )

    def update_ingestion_job(self, job_id: str, **kwargs: Any) -> None:
        allowed = {"status", "total_emails", "processed_emails", "classified_emails",
                   "entities_extracted", "completed_at", "error_text"}
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        with self._lock:
            self.conn.execute(
                f"update ingestion_jobs set {set_clause} where job_id = ?",
                list(updates.values()) + [job_id],
            )

    def get_ingestion_job(self, job_id: str) -> dict[str, Any] | None:
        rows = self._records("select * from ingestion_jobs where job_id = ?", [job_id])
        return rows[0] if rows else None

    def update_personal_item_media(self, item_id: str, media_url: str) -> None:
        with self._lock:
            self.conn.execute(
                "update personal_items set media_url = ? where item_id = ?",
                [media_url, item_id],
            )

    def items_missing_media(self, category: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        q = "select item_id, merchant, item_name, category from personal_items where media_url is null"
        params: list[Any] = []
        if category:
            q += " and category = ?"
            params.append(category)
        q += " limit ?"
        params.append(limit)
        return self._records(q, params)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_duckdb_personal_tables.py -v
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/storage/duckdb_store.py tests/test_duckdb_personal_tables.py
git commit -m "feat: add personal_items, personal_deals, personal_gaps, ingestion_jobs tables"
```

---

## Task 2: Streaming mbox parser

**Files:**
- Create: `engine/py/user_profile_engine/ingest/streaming_mbox_parser.py`
- Create: `tests/test_streaming_mbox_parser.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_streaming_mbox_parser.py
import tempfile
from pathlib import Path
import pytest
from user_profile_engine.ingest.streaming_mbox_parser import stream_mbox

MBOX_SAMPLE = b"""From sender@example.com Mon Jan  1 00:00:00 2024
From: sender@example.com
To: me@example.com
Subject: Order Confirmation
Message-ID: <msg-1@example.com>

Your order #1234 has been confirmed.

From other@example.com Tue Jan  2 00:00:00 2024
From: other@example.com
To: me@example.com
Subject: Hello
Message-ID: <msg-2@example.com>

Just a hello.

"""

def test_stream_mbox_yields_two_messages(tmp_path):
    mbox_file = tmp_path / "test.mbox"
    mbox_file.write_bytes(MBOX_SAMPLE)
    messages = list(stream_mbox(mbox_file))
    assert len(messages) == 2

def test_stream_mbox_extracts_subject(tmp_path):
    mbox_file = tmp_path / "test.mbox"
    mbox_file.write_bytes(MBOX_SAMPLE)
    messages = list(stream_mbox(mbox_file))
    assert messages[0]["subject"] == "Order Confirmation"
    assert messages[1]["subject"] == "Hello"

def test_stream_mbox_extracts_message_id(tmp_path):
    mbox_file = tmp_path / "test.mbox"
    mbox_file.write_bytes(MBOX_SAMPLE)
    messages = list(stream_mbox(mbox_file))
    assert messages[0]["message_id"] == "<msg-1@example.com>"

def test_stream_mbox_extracts_snippet(tmp_path):
    mbox_file = tmp_path / "test.mbox"
    mbox_file.write_bytes(MBOX_SAMPLE)
    messages = list(stream_mbox(mbox_file))
    assert "order #1234" in messages[0]["snippet"].lower()

def test_stream_mbox_empty_file(tmp_path):
    mbox_file = tmp_path / "empty.mbox"
    mbox_file.write_bytes(b"")
    messages = list(stream_mbox(mbox_file))
    assert messages == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_streaming_mbox_parser.py -v 2>&1 | head -15
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement streaming_mbox_parser.py**

```python
# engine/py/user_profile_engine/ingest/streaming_mbox_parser.py
from __future__ import annotations

from datetime import datetime, timezone
from email import message_from_bytes
from email.policy import compat32
from pathlib import Path
from typing import Any, Iterator


def _extract_body(msg: Any) -> str:
    try:
        payload = msg.get_payload(decode=True)
        if isinstance(payload, bytes):
            return payload.decode("utf-8", errors="replace")
    except Exception:
        pass
    raw = msg.get_payload()
    return raw if isinstance(raw, str) else ""


def stream_mbox(path: Path) -> Iterator[dict[str, Any]]:
    """Yield one dict per email without loading the full file into memory."""
    now = datetime.now(timezone.utc)
    with open(path, "rb") as f:
        buf: list[bytes] = []
        for line in f:
            if line.startswith(b"From ") and buf:
                yield _parse_message(buf, path, now)
                buf = [line]
            else:
                buf.append(line)
        if buf:
            raw = b"".join(buf)
            if raw.strip():
                yield _parse_message(buf, path, now)


def _parse_message(buf: list[bytes], source_path: Path, now: datetime) -> dict[str, Any]:
    raw = b"".join(buf)
    msg = message_from_bytes(raw, policy=compat32)
    body = _extract_body(msg)
    snippet = body[:200].replace("\n", " ").strip()
    return {
        "message_id": msg.get("Message-ID", ""),
        "thread_id": msg.get("Thread-Index", ""),
        "from_addr": msg.get("From", ""),
        "to_addrs": msg.get("To", ""),
        "subject": msg.get("Subject", ""),
        "snippet": snippet,
        "sent_at": now,
        "ingested_at": now,
        "source_path": str(source_path),
    }
```

- [ ] **Step 4: Run tests**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_streaming_mbox_parser.py -v
```

Expected: All 5 PASS

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/ingest/streaming_mbox_parser.py tests/test_streaming_mbox_parser.py
git commit -m "feat: streaming mbox parser — no full-file buffering"
```

---

## Task 3: Email pre-filter + LLM classifier

**Files:**
- Create: `engine/py/user_profile_engine/ingest/email_classifier.py`
- Create: `tests/test_email_classifier.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_email_classifier.py
import asyncio
import pytest
from user_profile_engine.ingest.email_classifier import (
    prefilter_email,
    classify_batch,
    CANDIDATE_PATTERNS,
)

def test_prefilter_passes_order_email():
    assert prefilter_email("Your order has been confirmed", "snippet", "amazon.com") is True

def test_prefilter_passes_receipt():
    assert prefilter_email("Receipt for your purchase", "snippet", "nike.com") is True

def test_prefilter_rejects_social():
    assert prefilter_email("John liked your photo", "snippet", "facebook.com") is False

def test_prefilter_rejects_empty():
    assert prefilter_email("", "", "") is False

def test_classify_batch_with_stub_llm():
    emails = [
        {"message_id": "1", "from_addr": "amazon@amazon.com",
         "subject": "Your order #123 confirmed", "snippet": "Nike shoes shipped"},
        {"message_id": "2", "from_addr": "netflix@netflix.com",
         "subject": "Your Netflix subscription", "snippet": "Monthly renewal"},
    ]

    async def stub_llm(prompt: str) -> str:
        import json
        return json.dumps({"results": [
            {"index": 0, "category": "shopping", "subcategory": "footwear", "confidence": 0.95},
            {"index": 1, "category": "entertainment", "subcategory": "streaming", "confidence": 0.92},
        ]})

    results = asyncio.get_event_loop().run_until_complete(
        classify_batch(emails, stub_llm)
    )
    assert results[0]["category"] == "shopping"
    assert results[1]["category"] == "entertainment"

def test_classify_batch_handles_llm_error():
    emails = [{"message_id": "1", "from_addr": "x@x.com", "subject": "test", "snippet": "test"}]

    async def bad_llm(prompt: str) -> str:
        raise ValueError("LLM unavailable")

    results = asyncio.get_event_loop().run_until_complete(
        classify_batch(emails, bad_llm)
    )
    assert results[0]["category"] == "other"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_email_classifier.py -v 2>&1 | head -15
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement email_classifier.py**

```python
# engine/py/user_profile_engine/ingest/email_classifier.py
from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable

CANDIDATE_PATTERNS = [
    re.compile(r"\b(order|receipt|invoice|booking|confirmation|ticket|subscription|"
               r"renewal|shipping|shipped|delivered|reservation|itinerary|"
               r"purchase|payment|refund|deal|discount|promo|offer|sale)\b", re.I),
]

LlmFn = Callable[[str], Awaitable[str]]


def prefilter_email(subject: str, snippet: str, from_addr: str) -> bool:
    """Return True if the email is worth sending to the LLM."""
    text = f"{subject} {snippet} {from_addr}"
    if not text.strip():
        return False
    return any(p.search(text) for p in CANDIDATE_PATTERNS)


async def classify_batch(emails: list[dict[str, Any]], llm: LlmFn) -> list[dict[str, Any]]:
    """Classify a batch of emails. Returns one result dict per input email."""
    if not emails:
        return []
    prompt = _build_prompt(emails)
    try:
        raw = await llm(prompt)
        parsed = json.loads(raw)
        results_map = {r["index"]: r for r in parsed.get("results", [])}
    except Exception:
        results_map = {}

    out = []
    for i, email in enumerate(emails):
        r = results_map.get(i, {})
        out.append({
            "message_id": email["message_id"],
            "category": r.get("category", "other"),
            "subcategory": r.get("subcategory", ""),
            "confidence": r.get("confidence", 0.0),
        })
    return out


def _build_prompt(emails: list[dict[str, Any]]) -> str:
    lines = "\n".join(
        f'{i}. from={e["from_addr"]} | subject={e["subject"][:80]} | '
        f'snippet={e["snippet"][:100]}'
        for i, e in enumerate(emails)
    )
    return (
        'Classify each email. Reply ONLY with JSON: '
        '{"results": [{"index": 0, "category": "shopping", '
        '"subcategory": "footwear", "confidence": 0.95}, ...]}\n\n'
        "Categories:\n"
        "  shopping      — orders, receipts, deliveries\n"
        "  entertainment — tickets, streaming, events, games\n"
        "  travel        — flights, hotels, car hire, tours\n"
        "  promo         — discount codes, newsletters, sales\n"
        "  other         — everything else\n\n"
        f"Emails:\n{lines}"
    )
```

- [ ] **Step 4: Run tests**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_email_classifier.py -v
```

Expected: All 5 PASS

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/ingest/email_classifier.py tests/test_email_classifier.py
git commit -m "feat: email pre-filter + async LLM batch classifier"
```

---

## Task 4: LLM entity extractor

**Files:**
- Create: `engine/py/user_profile_engine/ingest/entity_extractor.py`
- Create: `tests/test_entity_extractor.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_entity_extractor.py
import asyncio
import json
import pytest
from user_profile_engine.ingest.entity_extractor import extract_entities_batch

def test_extract_shopping_entity():
    emails = [{
        "message_id": "msg-1",
        "category": "shopping",
        "from_addr": "orders@nike.com",
        "subject": "Order Confirmed: Nike Air Max 270 - €129",
        "snippet": "Your order #ORD-001 for Nike Air Max 270 (€129) has been confirmed.",
    }]

    async def stub_llm(prompt: str) -> str:
        return json.dumps({"results": [{
            "message_id": "msg-1",
            "merchant": "Nike",
            "item_name": "Air Max 270",
            "amount": 129.0,
            "currency": "EUR",
            "order_id": "ORD-001",
            "date": "2024-03-01",
        }]})

    results = asyncio.get_event_loop().run_until_complete(
        extract_entities_batch(emails, stub_llm)
    )
    assert len(results) == 1
    assert results[0]["merchant"] == "Nike"
    assert results[0]["amount"] == 129.0

def test_extract_travel_entity():
    emails = [{
        "message_id": "msg-2",
        "category": "travel",
        "from_addr": "bookings@airbnb.com",
        "subject": "Booking Confirmed: Mallorca 4 nights",
        "snippet": "Your stay in Mallorca from Jul 10-14 is confirmed. Total: €340.",
    }]

    async def stub_llm(prompt: str) -> str:
        return json.dumps({"results": [{
            "message_id": "msg-2",
            "destination": "Mallorca",
            "type": "accommodation",
            "provider": "Airbnb",
            "amount": 340.0,
            "currency": "EUR",
            "date": "2024-07-10",
        }]})

    results = asyncio.get_event_loop().run_until_complete(
        extract_entities_batch(emails, stub_llm)
    )
    assert results[0]["destination"] == "Mallorca"

def test_extract_handles_llm_error():
    emails = [{"message_id": "msg-3", "category": "shopping",
               "from_addr": "x@x.com", "subject": "test", "snippet": "test"}]

    async def bad_llm(prompt: str) -> str:
        raise RuntimeError("LLM down")

    results = asyncio.get_event_loop().run_until_complete(
        extract_entities_batch(emails, bad_llm)
    )
    assert results == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_entity_extractor.py -v 2>&1 | head -15
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement entity_extractor.py**

```python
# engine/py/user_profile_engine/ingest/entity_extractor.py
from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

LlmFn = Callable[[str], Awaitable[str]]

_SHOPPING_SCHEMA = (
    '{"message_id": "...", "merchant": "...", "item_name": "...", '
    '"amount": 0.0, "currency": "EUR", "order_id": "...", "date": "YYYY-MM-DD"}'
)
_ENTERTAINMENT_SCHEMA = (
    '{"message_id": "...", "service": "...", "title": "...", '
    '"type": "streaming|ticket|event|game", "amount": 0.0, "currency": "EUR", "date": "YYYY-MM-DD"}'
)
_TRAVEL_SCHEMA = (
    '{"message_id": "...", "destination": "...", "type": "flight|hotel|car|tour", '
    '"provider": "...", "amount": 0.0, "currency": "EUR", "date": "YYYY-MM-DD"}'
)

_SCHEMA_MAP = {
    "shopping": _SHOPPING_SCHEMA,
    "entertainment": _ENTERTAINMENT_SCHEMA,
    "travel": _TRAVEL_SCHEMA,
}


async def extract_entities_batch(
    emails: list[dict[str, Any]], llm: LlmFn
) -> list[dict[str, Any]]:
    """Extract structured entities from classified emails. Returns list of entity dicts."""
    if not emails:
        return []
    category = emails[0]["category"]
    schema = _SCHEMA_MAP.get(category)
    if not schema:
        return []
    prompt = _build_prompt(emails, category, schema)
    try:
        raw = await llm(prompt)
        parsed = json.loads(raw)
        return parsed.get("results", [])
    except Exception:
        return []


def _build_prompt(emails: list[dict[str, Any]], category: str, schema: str) -> str:
    lines = "\n".join(
        f'message_id={e["message_id"]} | from={e["from_addr"]} | '
        f'subject={e["subject"][:100]} | snippet={e["snippet"][:150]}'
        for e in emails
    )
    return (
        f'Extract {category} entities from these emails. '
        f'Reply ONLY with JSON: {{"results": [{schema}, ...]}}\n'
        'Use null for unknown fields. One result per email that has extractable data.\n\n'
        f'Emails:\n{lines}'
    )
```

- [ ] **Step 4: Run tests**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_entity_extractor.py -v
```

Expected: All 3 PASS

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/ingest/entity_extractor.py tests/test_entity_extractor.py
git commit -m "feat: LLM entity extractor for shopping/entertainment/travel emails"
```

---

## Task 5: Source extractor

**Files:**
- Create: `engine/py/user_profile_engine/ingest/source_extractor.py`
- Create: `tests/test_source_extractor.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_source_extractor.py
from user_profile_engine.ingest.source_extractor import extract_sources

def test_extracts_unique_domains():
    emails = [
        {"from_addr": "orders@amazon.com", "category": "shopping"},
        {"from_addr": "receipts@amazon.com", "category": "shopping"},
        {"from_addr": "noreply@netflix.com", "category": "entertainment"},
        {"from_addr": "hello@friend.com", "category": "other"},
    ]
    sources = extract_sources(emails)
    domains = [s["domain"] for s in sources]
    assert "amazon.com" in domains
    assert "netflix.com" in domains
    assert "friend.com" not in domains  # category=other excluded

def test_categories_are_preserved():
    emails = [{"from_addr": "notify@airbnb.com", "category": "travel"}]
    sources = extract_sources(emails)
    assert sources[0]["category"] == "travel"

def test_deduplicates_same_domain():
    emails = [
        {"from_addr": "a@nike.com", "category": "shopping"},
        {"from_addr": "b@nike.com", "category": "shopping"},
        {"from_addr": "c@nike.com", "category": "promo"},
    ]
    sources = extract_sources(emails)
    nike = [s for s in sources if s["domain"] == "nike.com"]
    assert len(nike) == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_source_extractor.py -v 2>&1 | head -15
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement source_extractor.py**

```python
# engine/py/user_profile_engine/ingest/source_extractor.py
from __future__ import annotations

import re
from typing import Any

_RELEVANT_CATEGORIES = {"shopping", "entertainment", "travel", "promo"}
_DOMAIN_RE = re.compile(r"@([\w.-]+)$")


def extract_sources(emails: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return one record per unique sender domain for relevant email categories."""
    seen: dict[str, dict[str, Any]] = {}
    for email in emails:
        if email.get("category") not in _RELEVANT_CATEGORIES:
            continue
        m = _DOMAIN_RE.search(email.get("from_addr", ""))
        if not m:
            continue
        domain = m.group(1).lower()
        if domain not in seen:
            seen[domain] = {
                "domain": domain,
                "category": email["category"],
                "from_addr": email["from_addr"],
            }
    return list(seen.values())
```

- [ ] **Step 4: Run tests**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_source_extractor.py -v
```

Expected: All 3 PASS

- [ ] **Step 5: Commit**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/ingest/source_extractor.py tests/test_source_extractor.py
git commit -m "feat: source extractor deduplicates sender domains for Marble source seeding"
```

---

## Task 6: Async ingestion job

**Files:**
- Create: `engine/py/user_profile_engine/jobs/ingestion_job.py`
- Create: `engine/py/user_profile_engine/jobs/__init__.py`
- Create: `tests/test_ingestion_job.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ingestion_job.py
import asyncio
import tempfile
from pathlib import Path
import pytest
from user_profile_engine.jobs.ingestion_job import run_ingestion_job
from user_profile_engine.storage.duckdb_store import DuckDBStore

MBOX_SAMPLE = b"""From sender@amazon.com Mon Jan  1 00:00:00 2024
From: orders@amazon.com
To: me@example.com
Subject: Order Confirmed: Nike Air Max - EUR 129
Message-ID: <order-1@amazon.com>

Your order #ORD-001 for Nike Air Max (EUR 129) is confirmed.

From other@facebook.com Tue Jan  2 00:00:00 2024
From: other@facebook.com
To: me@example.com
Subject: John liked your photo
Message-ID: <social-1@facebook.com>

Social notification.

"""

def make_stub_llm(classify_result, extract_result):
    import json
    call_count = [0]
    async def llm(prompt: str) -> str:
        call_count[0] += 1
        if "Classify each email" in prompt:
            return json.dumps({"results": classify_result})
        return json.dumps({"results": extract_result})
    return llm

def test_run_ingestion_job_completes(tmp_path):
    mbox_file = tmp_path / "test.mbox"
    mbox_file.write_bytes(MBOX_SAMPLE)
    store = DuckDBStore(tmp_path / "test.duckdb")

    stub_llm = make_stub_llm(
        classify_result=[
            {"index": 0, "category": "shopping", "subcategory": "footwear", "confidence": 0.9},
        ],
        extract_result=[{
            "message_id": "<order-1@amazon.com>",
            "merchant": "Nike", "item_name": "Air Max",
            "amount": 129.0, "currency": "EUR",
            "order_id": "ORD-001", "date": "2024-01-01",
        }],
    )

    asyncio.get_event_loop().run_until_complete(
        run_ingestion_job("job-1", mbox_file, store, stub_llm, batch_size=10)
    )

    job = store.get_ingestion_job("job-1")
    assert job["status"] == "completed"
    assert job["processed_emails"] >= 1

    items = store.list_personal_items(category="shopping")
    assert len(items) >= 1
    assert items[0]["merchant"] == "Nike"

def test_run_ingestion_job_skips_social_emails(tmp_path):
    mbox_file = tmp_path / "test.mbox"
    mbox_file.write_bytes(MBOX_SAMPLE)
    store = DuckDBStore(tmp_path / "test.duckdb")

    stub_llm = make_stub_llm(classify_result=[], extract_result=[])

    asyncio.get_event_loop().run_until_complete(
        run_ingestion_job("job-2", mbox_file, store, stub_llm, batch_size=10)
    )

    job = store.get_ingestion_job("job-2")
    assert job["status"] == "completed"
    # Social email pre-filtered, 0 items extracted
    items = store.list_personal_items()
    assert len(items) == 0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_ingestion_job.py -v 2>&1 | head -15
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Create `__init__.py`**

```python
# engine/py/user_profile_engine/jobs/__init__.py
```

(empty file)

- [ ] **Step 4: Implement ingestion_job.py**

```python
# engine/py/user_profile_engine/jobs/ingestion_job.py
from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from user_profile_engine.ingest.email_classifier import classify_batch, prefilter_email
from user_profile_engine.ingest.entity_extractor import extract_entities_batch
from user_profile_engine.ingest.source_extractor import extract_sources
from user_profile_engine.ingest.streaming_mbox_parser import stream_mbox
from user_profile_engine.storage.duckdb_store import DuckDBStore

LlmFn = Callable[[str], Awaitable[str]]
_ENTITY_CATEGORIES = {"shopping", "entertainment", "travel"}


def _item_id(message_id: str, category: str) -> str:
    key = f"{message_id}:{category}"
    return hashlib.sha1(key.encode()).hexdigest()


async def run_ingestion_job(
    job_id: str,
    mbox_path: Path,
    store: DuckDBStore,
    llm: LlmFn,
    batch_size: int = 50,
) -> None:
    store.create_ingestion_job(job_id, str(mbox_path))
    store.update_ingestion_job(job_id, status="running")
    now = datetime.now(timezone.utc)
    processed = 0
    classified = 0
    extracted = 0
    all_emails: list[dict[str, Any]] = []

    try:
        candidate_batch: list[dict[str, Any]] = []

        for msg in stream_mbox(mbox_path):
            processed += 1
            all_emails.append(msg)
            store.update_ingestion_job(job_id, processed_emails=processed)

            # Insert raw email row (deduplication via message_id)
            try:
                store.insert_email_rows([{
                    "message_id": msg["message_id"],
                    "thread_id": msg["thread_id"],
                    "mailbox_id": mbox_path.stem,
                    "folder": "mbox",
                    "sent_at": msg["sent_at"],
                    "from_addr": msg["from_addr"],
                    "to_addrs": msg["to_addrs"],
                    "cc_addrs": "",
                    "subject": msg["subject"],
                    "body_text_path": "",
                    "snippet": msg["snippet"],
                    "labels": "",
                    "source_type": "mbox",
                    "source_path": msg["source_path"],
                    "ingested_at": msg["ingested_at"],
                }])
            except Exception:
                pass  # duplicate message_id — skip

            if prefilter_email(msg["subject"], msg["snippet"], msg["from_addr"]):
                candidate_batch.append(msg)

            if len(candidate_batch) >= batch_size:
                c, e = await _process_batch(candidate_batch, store, llm, now)
                classified += c
                extracted += e
                store.update_ingestion_job(job_id, classified_emails=classified,
                                           entities_extracted=extracted)
                candidate_batch = []

        if candidate_batch:
            c, e = await _process_batch(candidate_batch, store, llm, now)
            classified += c
            extracted += e

        # Source extraction from all emails
        sources = extract_sources(all_emails)
        store.update_ingestion_job(
            job_id,
            status="completed",
            processed_emails=processed,
            classified_emails=classified,
            entities_extracted=extracted,
            completed_at=datetime.now(timezone.utc),
        )

    except Exception as exc:
        store.update_ingestion_job(job_id, status="failed", error_text=str(exc))
        raise


async def _process_batch(
    batch: list[dict[str, Any]],
    store: DuckDBStore,
    llm: LlmFn,
    now: datetime,
) -> tuple[int, int]:
    classifications = await classify_batch(batch, llm)
    classified = len(classifications)
    extracted = 0

    by_category: dict[str, list[dict[str, Any]]] = {}
    for email, cls in zip(batch, classifications):
        cat = cls["category"]
        if cat in _ENTITY_CATEGORIES:
            merged = {**email, **cls}
            by_category.setdefault(cat, []).append(merged)
        elif cat == "promo":
            _insert_deal(store, email, now)

    for cat, emails in by_category.items():
        entities = await extract_entities_batch(emails, llm)
        items = [_to_personal_item(e, cat, now) for e in entities if e]
        if items:
            store.insert_personal_items(items)
            extracted += len(items)

    return classified, extracted


def _to_personal_item(entity: dict[str, Any], category: str, now: datetime) -> dict[str, Any]:
    message_id = entity.get("message_id", "")
    return {
        "item_id": _item_id(message_id, category),
        "message_id": message_id,
        "category": category,
        "subcategory": entity.get("subcategory", ""),
        "merchant": entity.get("merchant") or entity.get("service") or entity.get("provider", ""),
        "item_name": entity.get("item_name") or entity.get("title") or entity.get("destination", ""),
        "amount": entity.get("amount"),
        "currency": entity.get("currency"),
        "order_id": entity.get("order_id"),
        "item_date": now,
        "media_url": None,
        "raw_json": json.dumps(entity),
        "ingested_at": now,
    }


def _insert_deal(store: DuckDBStore, email: dict[str, Any], now: datetime) -> None:
    deal_id = hashlib.sha1(email["message_id"].encode()).hexdigest()
    store.upsert_personal_deal({
        "deal_id": deal_id,
        "source_type": "mbox_promo",
        "category": "shopping",
        "merchant": email["from_addr"].split("@")[-1].split(".")[0].title(),
        "title": email["subject"][:200],
        "discount": None,
        "promo_code": None,
        "expires_at": None,
        "url": None,
        "media_url": None,
        "marble_score": 0.0,
        "raw_json": json.dumps({"subject": email["subject"], "snippet": email["snippet"]}),
        "ingested_at": now,
        "archived_at": None,
    })
```

- [ ] **Step 5: Run tests**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/test_ingestion_job.py -v
```

Expected: All 2 PASS

- [ ] **Step 6: Commit**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/jobs/ tests/test_ingestion_job.py
git commit -m "feat: async ingestion job orchestrator — stream, pre-filter, classify, extract"
```

---

## Task 7: New API endpoints

**Files:**
- Modify: `engine/py/user_profile_engine/api/server.py`

These endpoints are added to the existing `create_app()` function. Add them after the `/onboarding/disconnect` route.

- [ ] **Step 1: Add imports at the top of server.py**

After the existing imports block, add:

```python
import asyncio
import uuid
from fastapi import BackgroundTasks, UploadFile, File
from fastapi.responses import StreamingResponse
from user_profile_engine.jobs.ingestion_job import run_ingestion_job
from user_profile_engine.ingest.source_extractor import extract_sources
```

- [ ] **Step 2: Add OPENAI_LLM helper inside `create_app()`**

Add this inside `create_app()`, after `runtime = EngineRuntime(...)`:

```python
    import os, httpx

    async def _openai_llm(prompt: str) -> str:
        api_key = os.environ.get("OPENAI_API_KEY", "")
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                },
                timeout=60,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    _active_jobs: dict[str, asyncio.Task] = {}
```

- [ ] **Step 3: Add the 6 new routes inside `create_app()` before `return app`**

```python
    @app.post("/personal/upload-mbox")
    async def upload_mbox(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> dict[str, object]:
        upload_dir = runtime.config.storage_path / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        job_id = str(uuid.uuid4())
        dest = upload_dir / f"{job_id}.mbox"
        content = await file.read()
        dest.write_bytes(content)

        task = asyncio.create_task(
            run_ingestion_job(job_id, dest, runtime.store, _openai_llm)
        )
        _active_jobs[job_id] = task
        return runtime._ok({"job_id": job_id, "status": "queued"})

    @app.get("/personal/job/{job_id}")
    def get_job_status(job_id: str) -> dict[str, object]:
        job = runtime.store.get_ingestion_job(job_id)
        if not job:
            return runtime._ok(None, warnings=[f"Job {job_id} not found"])
        return runtime._ok(job)

    @app.get("/personal/job/{job_id}/stream")
    def stream_job_status(job_id: str):
        import time

        def event_stream():
            while True:
                job = runtime.store.get_ingestion_job(job_id)
                if not job:
                    yield f"data: {json.dumps({'error': 'not found'})}\n\n"
                    break
                yield f"data: {json.dumps(job)}\n\n"
                if job["status"] in ("completed", "failed"):
                    break
                time.sleep(2)

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @app.get("/personal/items")
    def list_personal_items(category: str | None = None) -> dict[str, object]:
        items = runtime.store.list_personal_items(category=category)
        return runtime._ok({"items": items, "count": len(items)})

    @app.get("/personal/deals")
    def list_personal_deals(category: str | None = None) -> dict[str, object]:
        deals = runtime.store.list_personal_deals(category=category)
        return runtime._ok({"deals": deals, "count": len(deals)})

    @app.get("/personal/gaps")
    def list_personal_gaps(category: str | None = None) -> dict[str, object]:
        gaps = runtime.store.list_personal_gaps(category=category)
        return runtime._ok({"gaps": gaps, "count": len(gaps)})

    @app.post("/personal/gaps/upsert")
    def upsert_gap(gap: dict[str, object]) -> dict[str, object]:
        runtime.store.upsert_personal_gap(gap)
        return runtime._ok({"gap_id": gap.get("gap_id")})

    @app.post("/personal/media/update")
    def update_media(payload: dict[str, object]) -> dict[str, object]:
        item_id = str(payload.get("item_id", ""))
        media_url = str(payload.get("media_url", ""))
        runtime.store.update_personal_item_media(item_id, media_url)
        return runtime._ok({"item_id": item_id, "media_url": media_url})

    @app.get("/personal/media/missing")
    def items_missing_media() -> dict[str, object]:
        items = runtime.store.items_missing_media(limit=100)
        return runtime._ok({"items": items})
```

- [ ] **Step 4: Also add `storage_path` property to EngineConfig if not present**

Check `engine/py/user_profile_engine/config.py`:
```bash
grep -n "storage_path\|duckdb_path\|sqlite_path" /srv/projects/vivo-user-profile-vault/engine/py/user_profile_engine/config.py
```

If `storage_path` is missing, add it as `Path(self.duckdb_path).parent`.

- [ ] **Step 5: Smoke-test the API**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m user_profile_engine.main &
sleep 3
curl -s http://localhost:4876/personal/items | python3 -m json.tool | head -10
curl -s http://localhost:4876/personal/deals | python3 -m json.tool | head -10
curl -s http://localhost:4876/personal/gaps  | python3 -m json.tool | head -10
kill %1
```

Expected: Each endpoint returns `{"ok": true, "data": {"items": [], "count": 0}, ...}`

- [ ] **Step 6: Commit**

```bash
cd /srv/projects/vivo-user-profile-vault
git add engine/py/user_profile_engine/api/server.py
git commit -m "feat: personal dashboard API endpoints — upload-mbox, items, deals, gaps, SSE job status"
```

---

## Task 8: Run full test suite

- [ ] **Step 1: Run all vault tests**

```bash
cd /srv/projects/vivo-user-profile-vault
python -m pytest tests/ -v --tb=short 2>&1 | tail -20
```

Expected: All tests PASS (no regressions)

- [ ] **Step 2: Commit if any fixes needed**

```bash
cd /srv/projects/vivo-user-profile-vault
git add -A
git commit -m "fix: vault test suite green after personal dashboard additions"
```

---

**Plan 1 complete.** The vault engine now exposes `/personal/items`, `/personal/deals`, `/personal/gaps`, `/personal/upload-mbox`, and `/personal/job/:id/stream` — everything Plan 2 needs.
