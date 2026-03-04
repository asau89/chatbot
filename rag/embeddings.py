"""Embedding model — wraps OllamaEmbeddings with nomic-embed-text prefixes.

``nomic-embed-text`` uses *task prefixes* to distinguish queries from
documents.  The official prefixes are:

- ``search_query: <text>``  — for queries at retrieval time
- ``search_document: <text>`` — for passages at ingestion time

This module transparently adds the correct prefix so every other module
just calls ``embed_documents`` / ``embed_query`` without worrying about it.
"""

from __future__ import annotations

from functools import lru_cache
from typing import List

from langchain_ollama import OllamaEmbeddings

from rag.config import EMBEDDING_MODEL, OLLAMA_BASE_URL


class _PrefixedOllamaEmbeddings(OllamaEmbeddings):
    """OllamaEmbeddings subclass that prepends task prefixes for
    nomic-embed-text (and similar models that expect them)."""

    doc_prefix: str = "search_document: "
    query_prefix: str = "search_query: "

    def embed_documents(self, texts: List[str]) -> List[List[float]]:  # noqa: UP006
        prefixed = [f"{self.doc_prefix}{t}" for t in texts]
        return super().embed_documents(prefixed)

    def embed_query(self, text: str) -> List[float]:  # noqa: UP006
        return super().embed_query(f"{self.query_prefix}{text}")


@lru_cache(maxsize=1)
def get_embeddings(
    model: str = EMBEDDING_MODEL,
    base_url: str = OLLAMA_BASE_URL,
) -> _PrefixedOllamaEmbeddings:
    """Return a cached embedding instance with task-prefix support."""
    return _PrefixedOllamaEmbeddings(model=model, base_url=base_url)
