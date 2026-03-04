"""Centralised configuration for the RAG pipeline.

All tunables live here so every module imports from one place.
Values are read from environment variables with sensible defaults.
"""

import os

# ---------------------------------------------------------------------------
# Ollama models
# ---------------------------------------------------------------------------
OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
CHAT_MODEL: str = os.getenv("OLLAMA_CHAT_MODEL", "llama3.2:1b")
EMBEDDING_MODEL: str = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# ---------------------------------------------------------------------------
# Retrieval tuning
# ---------------------------------------------------------------------------
# Tuned for llama3.2:1b (~2k–4k context window, limited reasoning).
# Strategy: cast a wide retrieval net, but send very few, focused chunks.
VECTOR_TOP_K: int = int(os.getenv("VECTOR_TOP_K", "10"))
BM25_TOP_K: int = int(os.getenv("BM25_TOP_K", "10"))
FINAL_CONTEXT_K: int = int(os.getenv("FINAL_CONTEXT_K", "2"))
MAX_CHUNKS_PER_LABEL: int = int(os.getenv("MAX_CHUNKS_PER_LABEL", "2"))

# Weights for EnsembleRetriever (BM25 vs Vector). Must sum to 1.0.
# Higher vector weight because semantic match matters more for small models.
BM25_WEIGHT: float = float(os.getenv("BM25_WEIGHT", "0.35"))
VECTOR_WEIGHT: float = float(os.getenv("VECTOR_WEIGHT", "0.65"))

# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------
# Smaller chunks = more precise retrieval and less wasted context for a 1b model.
CHUNK_TARGET_TOKENS: int = int(os.getenv("CHUNK_TARGET_TOKENS", "150"))
CHUNK_OVERLAP_TOKENS: int = int(os.getenv("CHUNK_OVERLAP_TOKENS", "25"))

# ---------------------------------------------------------------------------
# Vector DB
# ---------------------------------------------------------------------------
VECTOR_DB_PATH: str = os.getenv("VECTOR_DB_PATH", "data/vector-db")
VECTOR_TABLE_NAME: str = os.getenv("VECTOR_TABLE_NAME", "knowledge_base")

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
SERVER_PORT: int = int(os.getenv("PORT", "8080"))
AUTH_KEY: str = os.getenv("AUTH_KEY", "SDP-AI-SERVER")

# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------
TESSERACT_CMD: str = os.getenv("TESSERACT_CMD", "")
OCR_DPI: int = int(os.getenv("OCR_DPI", "300"))
OCR_LANG: str = os.getenv("OCR_LANG", "eng")
