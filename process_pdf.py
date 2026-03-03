import sys
import json
import uuid
import lancedb
import ollama
import tiktoken
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_experimental.text_splitter import SemanticChunker
from langchain_community.embeddings import OllamaEmbeddings
from pypdf import PdfReader
from datetime import datetime

def safe_print(message):
    try:
        print(message)
    except UnicodeEncodeError:
        fallback = str(message).encode("utf-8", errors="replace").decode("utf-8")
        print(fallback)

ENCODER = tiktoken.get_encoding("cl100k_base")

def token_len(text):
    if not text:
        return 0
    return len(ENCODER.encode(text))

def process_pdf(pdf_path, original_file_name=None, db_path="data/vector-db", table_name="knowledge_base"):
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")

        # Extract filename
        file_name = original_file_name or pdf_path.split("/")[-1].split("\\")[-1]
        document_id = str(uuid.uuid4())
        safe_print(f"Document group ID: {document_id}")
        
        # 1. Read PDF
        reader = PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"

        safe_print(f"Extracted characters: {len(text)}")
        safe_print(f"Extracted tokens: {token_len(text)}")
        
        # 2. Chunk text semantically and enforce token limit
        safe_print("\n⚙️ Generating semantic chunks. This may take a moment depending on the PDF size...")
        embeddings = OllamaEmbeddings(model="nomic-embed-text")
        semantic_splitter = SemanticChunker(embeddings, breakpoint_threshold_type="percentile")
        semantic_chunks = semantic_splitter.split_text(text)
        
        # Enforce strict token limit per chunk
        token_splitter = RecursiveCharacterTextSplitter(
            chunk_size=100,
            chunk_overlap=20,
            length_function=token_len,
        )
        
        chunks = []
        for chunk in semantic_chunks:
            if token_len(chunk) > 100:
                chunks.extend(token_splitter.split_text(chunk))
            else:
                chunks.append(chunk)

        total_chunks = len(chunks)
        
        safe_print(f"Total chunks created: {total_chunks}")
        
        # 3. Connect to LanceDB
        db = lancedb.connect(db_path)
        table = db.open_table(table_name)
        schema_fields = {field.name for field in table.schema}
        safe_print(f"Detected table fields: {', '.join(sorted(schema_fields))}")
        before_count = table.count_rows()
        safe_print(f"Rows before insert: {before_count}")
        
        # 4. Generate embeddings and upload
        data_to_insert = []
        for i, chunk in enumerate(chunks):
            safe_print(f"\n--- Uploading Chunk {i + 1}/{total_chunks} ({token_len(chunk)} tokens) ---")
            safe_print(chunk[:200] + "..." if len(chunk) > 200 else chunk)
            
            # Generate embedding using nomic-embed-text
            response = ollama.embeddings(model="nomic-embed-text", prompt=chunk)
            embedding = response["embedding"]

            chunk_keywords = f"pdf, upload, doc_id:{document_id}, file:{file_name}, chunk:{i + 1}/{total_chunks}"
            
            candidate_row = {
                "vector": embedding,
                "content": chunk,
                "chunkType": "pdf_chunk",
                "text": chunk,
                "contextualText": chunk,
                "contextBefore": chunks[i-1] if i > 0 else "",
                "contextAfter": chunks[i+1] if i < total_chunks - 1 else "",
                "sectionTitle": str(file_name),
                "keywords": chunk_keywords,
                "label": "document",
                "documentId": document_id,
                "chunkIndex": float(i),
                "totalChunks": float(total_chunks),
                "fileName": str(file_name),
                "uploadedAt": str(datetime.now().isoformat())
            }

            filtered_row = {key: value for key, value in candidate_row.items() if key in schema_fields}

            if "text" in schema_fields and "text" not in filtered_row:
                filtered_row["text"] = chunk
            if "keywords" in schema_fields and "keywords" not in filtered_row:
                filtered_row["keywords"] = chunk_keywords
            if "documentId" in schema_fields and "documentId" not in filtered_row:
                filtered_row["documentId"] = document_id

            data_to_insert.append(filtered_row)
            
        if data_to_insert:
            table.add(data_to_insert)
            after_count = table.count_rows()
            inserted_count = after_count - before_count
            safe_print(f"Rows inserted this upload: {inserted_count}")
            safe_print(f"Rows after insert: {after_count}")
            safe_print("\nSuccessfully added chunks to LanceDB!")
            
    except Exception as e:
        print(f"Error processing PDF: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python process_pdf.py <pdf_path> [original_file_name]")
        sys.exit(1)
        
    pdf_file_path = sys.argv[1]
    original_file_name = sys.argv[2] if len(sys.argv) >= 3 else None
    process_pdf(pdf_file_path, original_file_name)
