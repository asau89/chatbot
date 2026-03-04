"""LanceDB vector store — manages ingestion and retrieval.

Uses ``langchain_community.vectorstores.LanceDB`` under the hood while
exposing simple helpers for:
- adding chunked documents (with metadata)
- similarity search (returns raw results for the retriever to re-rank)
- admin operations (list rows, truncate)
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import lancedb
from langchain_core.documents import Document

from rag.config import VECTOR_DB_PATH, VECTOR_TABLE_NAME, VECTOR_TOP_K
from rag.embeddings import get_embeddings
from rag.text_splitter import extract_keywords


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def _connect_db(db_path: str = VECTOR_DB_PATH) -> lancedb.DBConnection:
    return lancedb.connect(db_path)


def _table_exists(db: lancedb.DBConnection, table: str = VECTOR_TABLE_NAME) -> bool:
    return table in db.table_names()


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------

def ingest_documents(
    chunks: list[Document],
    *,
    db_path: str = VECTOR_DB_PATH,
    table_name: str = VECTOR_TABLE_NAME,
    label: str = "",
    embedding_model: str | None = None,
) -> int:
    """Embed and store chunked documents in LanceDB.

    Returns the number of rows added.
    """
    if not chunks:
        return 0

    embeddings = get_embeddings(model=embedding_model) if embedding_model else get_embeddings()
    db = _connect_db(db_path)

    uploaded_at = datetime.now().isoformat()

    # Build texts for batch embedding — use only the content text so
    # the embedding space matches the search-query embedding (no metadata noise).
    texts = [c.page_content for c in chunks]

    vectors = embeddings.embed_documents(texts)

    rows: list[dict[str, Any]] = []
    for uid, (chunk, vector) in enumerate(zip(chunks, vectors), start=1):
        if not vector:
            continue
        meta = chunk.metadata
        kw = meta.get("keywords", extract_keywords(chunk.page_content))
        source = meta.get("source", "")
        final_label = label.strip() if label.strip() else meta.get("label", source)

        rows.append({
            "id": uid,
            "vector": vector,
            "text": chunk.page_content,
            "keywords": kw,
            "source": source,
            "label": final_label,
            "metadata": {
                "source": source,
                "page": meta.get("page"),
                "chunk_index": meta.get("chunk_index"),
                "chunk_count": meta.get("chunk_count"),
                "keywords": kw,
                "extractor": meta.get("extractor", ""),
                "uploadedAt": uploaded_at,
            },
        })

    if not rows:
        return 0

    # Dedup — remove existing rows for the same source before inserting
    if _table_exists(db, table_name):
        table = db.open_table(table_name)
        source_names = {r["source"] for r in rows if r.get("source")}
        for src in source_names:
            try:
                table.delete(f"source = '{src}'")
            except Exception:
                pass
        table.add(rows)
    else:
        db.create_table(table_name, data=rows)

    # Build / rebuild IVF-PQ index when table is large enough
    _maybe_create_index(db, table_name)

    # Update manifest
    _update_manifest(db_path, rows, chunks)

    return len(rows)


# ---------------------------------------------------------------------------
# IVF-PQ index — speeds up similarity search on larger tables
# ---------------------------------------------------------------------------
_IVF_PQ_THRESHOLD = 256  # minimum rows before index creation is useful

def _maybe_create_index(
    db: lancedb.DBConnection,
    table_name: str = VECTOR_TABLE_NAME,
) -> None:
    """Create an IVF-PQ index if the table is large enough.

    Below ``_IVF_PQ_THRESHOLD`` rows the brute-force scan is faster than
    an approximate index, so we skip it for small tables.
    """
    if not _table_exists(db, table_name):
        return
    try:
        table = db.open_table(table_name)
        n = table.count_rows()
        if n < _IVF_PQ_THRESHOLD:
            return
        # num_partitions ~ sqrt(N), num_sub_vectors depends on embedding dim
        import math
        num_partitions = max(2, int(math.sqrt(n)))
        table.create_index(
            metric="cosine",
            num_partitions=num_partitions,
            num_sub_vectors=16,
            replace=True,
        )
    except Exception:
        pass  # non-fatal — brute-force still works


def _update_manifest(
    db_path: str,
    rows: list[dict],
    chunks: list[Document],
) -> None:
    manifest_path = Path(db_path) / "ingestion_manifest.json"
    existing: list[dict] = []
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = []

    sources_seen: dict[str, dict] = {e["file"]: e for e in existing}
    uploaded_at = datetime.now().isoformat()
    source_names = {r["source"] for r in rows}

    for src in source_names:
        src_chunks = [r for r in rows if r.get("source") == src]
        sources_seen[src] = {
            "file": src,
            "chunks": len(src_chunks),
            "ingested_at": uploaded_at,
            "label": rows[0].get("label", "auto") if rows else "auto",
        }

    manifest_path.write_text(
        json.dumps(list(sources_seen.values()), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Similarity search (raw — retriever will re-rank)
# ---------------------------------------------------------------------------

def similarity_search(
    query: str,
    *,
    top_k: int = VECTOR_TOP_K,
    db_path: str = VECTOR_DB_PATH,
    table_name: str = VECTOR_TABLE_NAME,
) -> list[dict[str, Any]]:
    """Embed *query* and return the top-k nearest rows from LanceDB.

    Returns raw dicts (including ``_distance``) so the retriever module
    can apply hybrid re-ranking.
    """
    db = _connect_db(db_path)
    if not _table_exists(db, table_name):
        return []

    embeddings = get_embeddings()
    query_vector = embeddings.embed_query(query)

    table = db.open_table(table_name)
    results = (
        table.search(query_vector)
        .limit(top_k)
        .select(["text", "keywords", "label"])
        .to_list()
    )
    return results


# ---------------------------------------------------------------------------
# Admin helpers
# ---------------------------------------------------------------------------

def get_rows(
    limit: int = 20,
    db_path: str = VECTOR_DB_PATH,
    table_name: str = VECTOR_TABLE_NAME,
) -> dict[str, Any]:
    """Return a preview of stored rows."""
    db = _connect_db(db_path)
    if not _table_exists(db, table_name):
        return {"total": 0, "rows": []}

    table = db.open_table(table_name)
    rows = (
        table.search()
        .select(["id", "label", "keywords", "text"])
        .limit(limit)
        .to_list()
    )

    total = len(rows)
    try:
        total = table.count_rows()
    except Exception:
        pass

    safe_rows = [
        {
            "id": r.get("id"),
            "label": r.get("label", "N/A"),
            "keywords": r.get("keywords", "N/A"),
            "text": r.get("text", ""),
        }
        for r in rows
    ]
    return {"total": total, "rows": safe_rows}


def load_all_documents(
    db_path: str = VECTOR_DB_PATH,
    table_name: str = VECTOR_TABLE_NAME,
) -> list[Document]:
    """Load every row from the vector table as LangChain Documents.

    Used by the BM25 retriever which needs the full corpus in memory.
    """
    db = _connect_db(db_path)
    if not _table_exists(db, table_name):
        return []

    table = db.open_table(table_name)
    rows = (
        table.search()
        .select(["text", "keywords", "label"])
        .limit(100_000)
        .to_list()
    )

    docs: list[Document] = []
    for r in rows:
        text = r.get("text", "")
        if not text.strip():
            continue
        docs.append(
            Document(
                page_content=text,
                metadata={
                    "keywords": r.get("keywords", ""),
                    "label": r.get("label", "N/A"),
                },
            )
        )
    return docs


def truncate_table(
    db_path: str = VECTOR_DB_PATH,
    table_name: str = VECTOR_TABLE_NAME,
) -> bool:
    """Drop the vector table. Returns ``True`` if it existed."""
    db = _connect_db(db_path)
    if _table_exists(db, table_name):
        db.drop_table(table_name)
        return True
    return False
