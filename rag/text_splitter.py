"""Text cleaning and chunking using LangChain text splitters.

Three-stage strategy:
1. ``MarkdownHeaderTextSplitter`` breaks on ``##`` headings so content from
   different document sections never bleeds into one chunk.
2. **Semantic boundary detection** — within each section, detect topic shifts
   by comparing sentence-pair similarity using the embedding model.  When
   similarity drops below a threshold a new chunk is started.
3. ``RecursiveCharacterTextSplitter`` acts as a safety net: any section that
   exceeds the target size after semantic splitting is sub-chunked respecting
   sentence → word boundaries with configurable overlap.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import List

from langchain_core.documents import Document
from langchain_text_splitters import (
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
)

from rag.config import CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS

# Approx 4 chars per token
_TARGET_LEN = CHUNK_TARGET_TOKENS * 4
_OVERLAP_LEN = CHUNK_OVERLAP_TOKENS * 4

_STOP_WORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "is", "are", "was",
    "this", "that", "for", "to", "of", "in", "on", "at", "by",
})

# ---------------------------------------------------------------------------
# Sentence splitter regex — matches sentence-ending punctuation
# ---------------------------------------------------------------------------
_SENTENCE_RE = re.compile(
    r"(?<=[.!?])\s+(?=[A-Z\u00C0-\u024F\d\-\[])"
    r"|(?<=\n)(?=\n)"                       # blank-line boundary
    r"|(?<=\n)(?=- )"                        # list-item start
    r"|(?<=\n)(?=\d+\.\s)"                   # numbered-list start
)

# ---------------------------------------------------------------------------
# LangChain splitters (initialised once)
# ---------------------------------------------------------------------------
_md_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[("##", "section")],
    strip_headers=False,
)

_text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=_TARGET_LEN,
    chunk_overlap=_OVERLAP_LEN,
    # Sentence-aware separators: prefer splitting after sentence-ending
    # punctuation before falling back to commas / spaces.
    separators=["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " ", ""],
    keep_separator=True,
    length_function=len,
)


# ---------------------------------------------------------------------------
# Semantic boundary detection helpers
# ---------------------------------------------------------------------------

def _split_sentences(text: str) -> list[str]:
    """Split *text* into sentence-like units."""
    parts = _SENTENCE_RE.split(text)
    return [p.strip() for p in parts if p.strip()]


def _semantic_chunk(sentences: list[str], target_len: int) -> list[str]:
    """Group sentences into chunks using lightweight topic-shift detection.

    Uses a simple cosine-similarity heuristic between consecutive sentence
    embeddings.  When the similarity drops below a threshold *and* the
    current buffer has reached at least half the target length, a new
    chunk is started.

    Falls back to greedy grouping if the embedding model is unavailable.
    """
    if not sentences:
        return []

    # Fast path: everything fits in one chunk
    total = sum(len(s) for s in sentences)
    if total <= target_len:
        return [" ".join(sentences)]

    try:
        from rag.embeddings import get_embeddings

        emb = get_embeddings()
        vectors = emb.embed_documents(sentences)
    except Exception:
        # Embedding unavailable — fall back to greedy size-based grouping
        return _greedy_chunk(sentences, target_len)

    # Cosine similarity between consecutive sentences
    import math

    def _cosine(a: List[float], b: List[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(x * x for x in b))
        return dot / (na * nb) if na and nb else 0.0

    threshold = 0.5  # below this = topic shift
    min_chunk_len = target_len * 0.35

    chunks: list[str] = []
    buf: list[str] = [sentences[0]]
    buf_len = len(sentences[0])

    for i in range(1, len(sentences)):
        sim = _cosine(vectors[i - 1], vectors[i])
        sent_len = len(sentences[i])

        # Start new chunk on topic shift when buffer is big enough
        if sim < threshold and buf_len >= min_chunk_len:
            chunks.append(" ".join(buf))
            buf = [sentences[i]]
            buf_len = sent_len
        # Or if buffer would exceed target
        elif buf_len + sent_len > target_len:
            chunks.append(" ".join(buf))
            buf = [sentences[i]]
            buf_len = sent_len
        else:
            buf.append(sentences[i])
            buf_len += sent_len

    if buf:
        chunks.append(" ".join(buf))

    return chunks


def _greedy_chunk(sentences: list[str], target_len: int) -> list[str]:
    """Simple size-based grouping fallback."""
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for s in sentences:
        if buf_len + len(s) > target_len and buf:
            chunks.append(" ".join(buf))
            buf = [s]
            buf_len = len(s)
        else:
            buf.append(s)
            buf_len += len(s)
    if buf:
        chunks.append(" ".join(buf))
    return chunks


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

# Unicode bullet / list-marker characters to normalise into "- "
_BULLET_RE = re.compile(
    r"(?m)^[ \t]*[\u2022\u2023\u2043\u2219\u25A0\u25A1\u25AA\u25AB"
    r"\u25B6\u25B8\u25BA\u25C6\u25C7\u25C9\u25CB\u25CF\u25E6"
    r"\u25CF\u27A2\u27A4\u2756\u25AA\u25AB]\s*"
)


def clean_text(text: str) -> str:
    """Normalise extracted text while preserving structural markers."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch.isprintable() or ch in "\n\t")
    # Normalise bullet characters to standard markdown list items
    text = _BULLET_RE.sub("- ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Join continuation lines but preserve headings, tables, list items
    text = re.sub(
        r"(?<!\n)\n(?!\n)(?!## )(?!\[TABLE\])(?!\[/TABLE\])(?![*\-] )(?!- )(?!\d+\.\s)",
        " ",
        text,
    )
    return text.strip()


def extract_keywords(text: str, top_n: int = 5) -> str:
    """Return comma-separated significant terms for hybrid search."""
    clean = re.sub(r"##\s+", "", text)
    clean = re.sub(r"\[/?TABLE\]", "", clean)
    words = re.findall(r"\b[a-z]{4,}\b", clean.lower())
    meaningful = [w for w in words if w not in _STOP_WORDS]
    return ", ".join(w for w, _ in Counter(meaningful).most_common(top_n))


def split_documents(documents: list[Document]) -> list[Document]:
    """Clean, then chunk a list of page-level documents.

    Returns a flat list of chunk-level ``Document`` objects with original
    metadata plus ``chunk_index`` and ``keywords``.
    """
    chunks: list[Document] = []

    for doc in documents:
        text = clean_text(doc.page_content)
        if not text:
            continue

        if len(text) <= _TARGET_LEN:
            raw_chunks = [text]
        else:
            # Stage 1: split on headings
            md_docs = _md_splitter.split_text(text)
            raw_chunks: list[str] = []
            for md_doc in md_docs:
                section = md_doc.page_content.strip()
                if not section:
                    continue
                if len(section) <= _TARGET_LEN:
                    raw_chunks.append(section)
                else:
                    # Stage 2: semantic chunking within each section
                    sents = _split_sentences(section)
                    sem_chunks = _semantic_chunk(sents, _TARGET_LEN)
                    for sc in sem_chunks:
                        if len(sc) <= _TARGET_LEN:
                            raw_chunks.append(sc)
                        else:
                            # Stage 3: safety-net recursive split
                            raw_chunks.extend(_text_splitter.split_text(sc))

        raw_chunks = [c.strip() for c in raw_chunks if c.strip()]
        if not raw_chunks:
            raw_chunks = [text]

        for idx, chunk_text in enumerate(raw_chunks, start=1):
            chunks.append(
                Document(
                    page_content=chunk_text,
                    metadata={
                        **doc.metadata,
                        "chunk_index": idx,
                        "chunk_count": len(raw_chunks),
                        "keywords": extract_keywords(chunk_text),
                    },
                )
            )

    return chunks
