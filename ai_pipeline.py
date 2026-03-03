import argparse
import json
import sys
import time
from datetime import datetime

import lancedb
import ollama


def safe_json_print(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def run_plain(message):
    response = ollama.chat(
        model='ministral-3:3b',
        messages=[{'role': 'user', 'content': message}],
        stream=False,
    )

    safe_json_print({
        'success': True,
        'model': 'ministral-3:3b',
        'message': response['message']['content'],
        'timestamp': datetime.now().isoformat(),
    })


def run_rag(message):
    db = lancedb.connect('data/vector-db')
    table = db.open_table('knowledge_base')

    embed_res = ollama.embeddings(model='nomic-embed-text', prompt=message)
    search_results = table.search(embed_res['embedding']).limit(5).select(['text', 'keywords']).to_list()

    context_text = "\n---\n".join(
        [f"[Text: {row.get('text', '')}] [Keywords: {row.get('keywords', 'N/A')}]" for row in search_results]
    )

    prompt = f"""
You are a helpful assistant. Answer the question using ONLY the context provided below.

CONTEXT:
{context_text}

QUESTION:
{message}

FORMATTING INSTRUCTIONS:
- Your response must be written entirely in Markdown format.
- **Extreme Breathability**: Ensure there is a full empty line (double line break) between EVERY single sentence or bullet point.
- Use headers (##) to separate different topics.
- Use bold text for key terms to make them stand out.
- Keep paragraphs extremely short (1-2 sentences max).
- Provide ONLY the Markdown content; no introductory or closing filler.
""".strip()

    response = ollama.chat(
        model='ministral-3:3b',
        messages=[{'role': 'user', 'content': prompt}],
        stream=False,
    )

    safe_json_print({
        'success': True,
        'model': 'ministral-3:3b',
        'response': response['message']['content'],
        'timestamp': datetime.now().isoformat(),
    })


def run_rag_stream(message):
    request_start = time.time()
    last_step = request_start
    trace = []

    def log_step(step, details=None):
        nonlocal last_step
        if details is None:
            details = {}
        now = time.time()
        entry = {
            'type': 'log',
            'timestamp': datetime.now().isoformat(),
            'step': step,
            'durationMs': int((now - last_step) * 1000),
            'elapsedMs': int((now - request_start) * 1000),
            **details,
        }
        last_step = now
        trace.append(entry)
        safe_json_print(entry)

    log_step('request_received')

    db = lancedb.connect('data/vector-db')
    table = db.open_table('knowledge_base')
    log_step('knowledge_base_opened')

    log_step('embedding_query_started')
    embed_res = ollama.embeddings(model='nomic-embed-text', prompt=message)
    log_step('embedding_query_completed', {
        'embeddingDimension': len(embed_res.get('embedding', [])),
    })

    log_step('rag_search_started')
    search_results = table.search(embed_res['embedding']).limit(5).select(['text', 'keywords']).to_list()
    log_step('rag_search_completed', {
        'hits': len(search_results),
    })

    context_text = "\n---\n".join(
        [f"[Text: {row.get('text', '')}] [Keywords: {row.get('keywords', 'N/A')}]" for row in search_results]
    )

    log_step('prompt_build_started')
    prompt = f"""
You are a helpful assistant. Answer the question using ONLY the context provided below.

CONTEXT:
{context_text}

QUESTION:
{message}

FORMATTING INSTRUCTIONS:
- Your response must be written entirely in Markdown format.
- **Extreme Breathability**: Ensure there is a full empty line (double line break) between EVERY single sentence or bullet point.
- Use headers (##) to separate different topics.
- Use bold text for key terms to make them stand out.
- Keep paragraphs extremely short (1-2 sentences max).
- Provide ONLY the Markdown content; no introductory or closing filler.
""".strip()
    log_step('prompt_build_completed', {
        'promptChars': len(prompt),
        'contextChars': len(context_text),
    })

    log_step('llm_generation_started')
    response = ollama.chat(
        model='ministral-3:3b',
        messages=[{'role': 'user', 'content': prompt}],
        stream=False,
    )
    log_step('llm_generation_completed')

    total_duration_ms = int((time.time() - request_start) * 1000)
    safe_json_print({
        'type': 'result',
        'success': True,
        'model': 'ministral-3:3b',
        'response': response['message']['content'],
        'processingTime': f"{total_duration_ms / 1000:.2f}s",
        'totalDurationMs': total_duration_ms,
        'trace': trace,
        'timestamp': datetime.now().isoformat(),
    })


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(description='Python AI pipeline runner')
    parser.add_argument('--mode', choices=['plain', 'rag', 'rag_stream'], required=True)
    parser.add_argument('--message', required=True)
    args = parser.parse_args()

    try:
        if args.mode == 'plain':
            run_plain(args.message)
        elif args.mode == 'rag':
            run_rag(args.message)
        else:
            run_rag_stream(args.message)
    except Exception as exc:
        safe_json_print({
            'type': 'error',
            'success': False,
            'message': str(exc),
            'timestamp': datetime.now().isoformat(),
        })
        sys.exit(1)


if __name__ == '__main__':
    main()
