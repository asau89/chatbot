// ─── DOM references ─────────────────────────────────────────────────────
const frontEndElem = {
    burgerCloseBtn: document.querySelector('.burger-close-btn'),
    burgerSvg: document.querySelector('.burger-close-btn svg:nth-child(1)'),
    closeSvg: document.querySelector('.burger-close-btn svg:nth-child(2)'),
    chMenuModal: document.getElementById('ch-menu-modal'),
    sendQuestionBtn: document.querySelector('.send-question-btn'),
    questionTextarea: document.querySelector('.question-textarea'),
    tagsChoices: document.querySelectorAll('.tags-choices'),
    chatBoxMain: document.querySelector('.chat-box-main'),
    chatBubble: document.querySelectorAll('.chat'),
    chatLoadingAnimation: document.querySelector('.chat-loading-animation'),
    uploadKnowledgeBaseBtn: document.querySelector('#upload-knowledge-btn'),
    uploadKnowledgeBaseFileInput: document.getElementById('dropzone-file'),
    uploadKnowledgeBaseFileNameDisplay: document.getElementById('file-name'),
    viewDbRowsBtn: document.getElementById('view-db-rows-btn'),
    truncateDbBtn: document.getElementById('truncate-db-btn'),
    welcomeHero: document.getElementById('welcome-hero'),
    toastContainer: document.getElementById('toast-container'),
    sendLabel: document.querySelector('.send-label'),
    sendIcon: document.querySelector('.send-icon'),
    dropArea: document.getElementById('drop-area'),
};

// ─── Conversation history tracker ───────────────────────────────────────
const conversationHistory = [];   // [{role:'user'|'assistant', text:string}]

// ─── Helpers ────────────────────────────────────────────────────────────

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Toast notification — replaces all alert() calls */
function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast-msg ${type}`;
    el.textContent = message;
    frontEndElem.toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3200);
}

/** Scroll chat to bottom smoothly */
function scrollToBottom() {
    const box = frontEndElem.chatBoxMain;
    const last = box.querySelector('.chat-loading-animation') || box.lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/** Hide welcome hero on first interaction */
function hideWelcome() {
    if (frontEndElem.welcomeHero) {
        frontEndElem.welcomeHero.style.display = 'none';
    }
}

/** Auto-resize textarea to its content */
function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

/** Set send button to loading / normal state */
function setSendLoading(loading) {
    const btn = frontEndElem.sendQuestionBtn;
    if (loading) {
        btn.disabled = true;
        btn.classList.add('cursor-not-allowed');
        frontEndElem.sendLabel.textContent = 'Sending';
        frontEndElem.sendIcon.classList.add('hidden');
        // add spinner
        if (!btn.querySelector('.btn-spinner')) {
            const sp = document.createElement('span');
            sp.className = 'btn-spinner';
            btn.prepend(sp);
        }
    } else {
        btn.querySelector('.btn-spinner')?.remove();
        frontEndElem.sendLabel.textContent = 'Send';
        frontEndElem.sendIcon.classList.remove('hidden');
        btn.disabled = false;
        btn.classList.remove('cursor-not-allowed');
    }
}

/** Build context array from recent conversation for API */
function buildContextPayload() {
    // Send last 3 pairs (6 messages) as alternating user/assistant strings
    const recent = conversationHistory.slice(-6);
    return recent.map(m => `${m.role}: ${m.text}`);
}

// ─── Debug details renderer ─────────────────────────────────────────────

function renderDebugDetails(result) {
    const timeLogs = result?.timeLogs || {};
    const selectedChunks = Array.isArray(result?.selectedChunks) ? result.selectedChunks : [];

    const timeLabels = {
        retrievalMs: 'Total retrieval',
        corpusLoadMs: '  Corpus load',
        bm25Ms: '  BM25 search',
        vectorMs: '  Vector search',
        rrfMs: '  RRF fusion',
        generationMs: 'LLM generation',
        totalMs: 'Total request',
    };
    const countKeys = new Set(['corpusSize', 'bm25Hits', 'vectorHits', 'finalChunks', 'contextChars']);

    const timeLogItems = Object.entries(timeLogs)
        .map(([key, value]) => {
            const label = timeLabels[key] || key;
            if (countKeys.has(key)) {
                return `<li><strong>${escapeHtml(label)}</strong>: ${escapeHtml(value)}</li>`;
            }
            return `<li><strong>${escapeHtml(label)}</strong>: ${escapeHtml(value)} ms</li>`;
        })
        .join('');

    const chunkItems = selectedChunks
        .map(chunk => {
            const previewText = (chunk.text || '').slice(0, 220);
            const rrfScore = chunk.rrfScore != null ? chunk.rrfScore : '\u2014';
            const bm25Rrf = chunk.bm25Rrf != null ? chunk.bm25Rrf : '\u2014';
            const vectorRrf = chunk.vectorRrf != null ? chunk.vectorRrf : '\u2014';
            const vecDist = chunk.vectorDistance != null ? chunk.vectorDistance : '\u2014';
            return `
                <li>
                    <strong>#${escapeHtml(chunk.rank)}</strong>
                    | label: <strong>${escapeHtml(chunk.label)}</strong>
                    | rrf: ${escapeHtml(rrfScore)}
                    | bm25: ${escapeHtml(bm25Rrf)}
                    | vec: ${escapeHtml(vectorRrf)}
                    | distance: ${escapeHtml(vecDist)}
                    <br />
                    <em>keywords:</em> ${escapeHtml(chunk.keywords)}
                    <br />
                    <em>text:</em> ${escapeHtml(previewText)}${(chunk.text || '').length > 220 ? '...' : ''}
                </li>
            `;
        })
        .join('');

    return `
        <details class="mt-4">
            <summary><strong>Debug: Time Logs & Selected Chunks</strong></summary>
            <div class="mt-2">
                <h4><strong>Time Logs</strong></h4>
                ${timeLogItems ? `<ul>${timeLogItems}</ul>` : '<p>No timing logs available.</p>'}
                <h4><strong>Selected Chunks (${selectedChunks.length})</strong></h4>
                ${chunkItems ? `<ol>${chunkItems}</ol>` : '<p>No selected chunks available.</p>'}
            </div>
        </details>
    `;
}


// ─── Sidebar toggle ─────────────────────────────────────────────────────

frontEndElem.burgerCloseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (frontEndElem.burgerCloseBtn.classList.contains('ch-closed')) {
        frontEndElem.burgerCloseBtn.classList.replace('ch-closed', 'ch-opened');
        frontEndElem.burgerSvg.classList.replace('block', 'hidden');
        frontEndElem.closeSvg.classList.replace('hidden', 'block');
        frontEndElem.chMenuModal.showPopover();
        return;
    }
    frontEndElem.burgerCloseBtn.classList.replace('ch-opened', 'ch-closed');
    frontEndElem.burgerSvg.classList.replace('hidden', 'block');
    frontEndElem.closeSvg.classList.replace('block', 'hidden');
    frontEndElem.chMenuModal.hidePopover();
});


// ─── Textarea input handling + auto-resize ──────────────────────────────

frontEndElem.questionTextarea.addEventListener('input', () => {
    autoResize(frontEndElem.questionTextarea);

    const hasText = frontEndElem.questionTextarea.value.trim().length > 0;
    if (hasText) {
        frontEndElem.sendQuestionBtn.classList.remove('cursor-not-allowed');
        frontEndElem.sendQuestionBtn.removeAttribute('disabled');
    } else {
        frontEndElem.sendQuestionBtn.classList.add('cursor-not-allowed');
        frontEndElem.sendQuestionBtn.setAttribute('disabled', 'true');
    }

    // Always expand chat area once user starts typing
    frontEndElem.chatBoxMain.classList.add('grow');
});


// ─── Send message ───────────────────────────────────────────────────────

frontEndElem.sendQuestionBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const message = frontEndElem.questionTextarea.value.trim();
    if (!message) return;

    hideWelcome();
    setSendLoading(true);
    frontEndElem.questionTextarea.value = '';
    autoResize(frontEndElem.questionTextarea);
    frontEndElem.chatBoxMain.classList.add('grow');

    // ── User bubble (escaped!) ──
    const userBubble = document.createElement('div');
    userBubble.classList.add('chat', 'chat-end', 'msg-enter');
    userBubble.innerHTML = `<div class="chat-bubble chat-bubble-primary text-wrap h-auto">${escapeHtml(message)}</div>`;
    frontEndElem.chatBoxMain.insertBefore(userBubble, frontEndElem.chatLoadingAnimation);

    // Show loading
    frontEndElem.chatLoadingAnimation.classList.replace('hidden', 'block');
    scrollToBottom();

    // ── Thinking timer ──
    const thinkingStart = performance.now();
    const thinkingTimerElem = frontEndElem.chatLoadingAnimation.querySelector('.thinking-timer');
    if (thinkingTimerElem) thinkingTimerElem.textContent = '0.0 s';
    const thinkingInterval = setInterval(() => {
        if (thinkingTimerElem) {
            const elapsed = ((performance.now() - thinkingStart) / 1000).toFixed(1);
            thinkingTimerElem.textContent = `${elapsed} s`;
        }
    }, 100);

    // Track user message
    conversationHistory.push({ role: 'user', text: message });

    try {
        const response = await fetch('http://localhost:8080/ask-ai-with-vector', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-key': 'SDP-AI-SERVER'
            },
            body: JSON.stringify({ message, context: buildContextPayload() })
        });

        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const result = isJson ? await response.json() : { message: await response.text() };

        if (!response.ok) {
            throw new Error(result?.message || result?.error || result?.detail || 'Request failed');
        }

        // Track assistant response
        conversationHistory.push({ role: 'assistant', text: result.response || '' });

        // ── AI response bubble ──
        const aiReply = document.createElement('div');
        aiReply.classList.add('w-full', 'h-auto', 'px-4', 'py-6', 'leading-relaxed', 'text-wrap', 'ai-response', 'msg-enter');

        const convertedMarkDown = marked.parse(result.response || '');
        const debugDetails = renderDebugDetails(result);

        aiReply.innerHTML = `${convertedMarkDown}${debugDetails}`;

        frontEndElem.chatBoxMain.insertBefore(aiReply, frontEndElem.chatLoadingAnimation);
        scrollToBottom();

    } catch (error) {
        const errorBubble = document.createElement('div');
        errorBubble.classList.add('chat', 'chat-start', 'msg-enter');
        errorBubble.innerHTML = `
            <div class="chat-bubble chat-bubble-error text-wrap h-auto">
                ${escapeHtml(error?.message || 'Something went wrong. Please try again.')}
                <button class="btn btn-xs btn-ghost ml-2 retry-btn">Retry</button>
            </div>
        `;
        frontEndElem.chatBoxMain.insertBefore(errorBubble, frontEndElem.chatLoadingAnimation);

        // Retry button — re-submit the same message
        errorBubble.querySelector('.retry-btn')?.addEventListener('click', () => {
            errorBubble.remove();
            // Pop the user message we already tracked, it will be re-added
            if (conversationHistory.length && conversationHistory[conversationHistory.length - 1].role === 'user') {
                conversationHistory.pop();
            }
            frontEndElem.questionTextarea.value = message;
            frontEndElem.sendQuestionBtn.click();
        });

        scrollToBottom();
    } finally {
        clearInterval(thinkingInterval);
        if (thinkingTimerElem) thinkingTimerElem.textContent = '';
        frontEndElem.chatLoadingAnimation.classList.replace('block', 'hidden');
        setSendLoading(false);
        frontEndElem.questionTextarea.focus();
    }
});


// ─── Keyboard shortcut: Enter to send ───────────────────────────────────

frontEndElem.questionTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        frontEndElem.sendQuestionBtn.click();
    }
});


// ─── Copy response button delegation ────────────────────────────────────

frontEndElem.chatBoxMain.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-response-btn')) {
        const aiBlock = e.target.closest('.ai-response');
        if (!aiBlock) return;
        // Get text excluding debug details
        const clone = aiBlock.cloneNode(true);
        clone.querySelector('details')?.remove();
        clone.querySelector('.copy-response-btn')?.remove();
        const text = clone.innerText.trim();
        navigator.clipboard.writeText(text).then(() => {
            e.target.textContent = 'Copied!';
            setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
        });
    }
});


// ─── Suggestion chips ───────────────────────────────────────────────────

document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        frontEndElem.questionTextarea.value = chip.textContent.trim();
        autoResize(frontEndElem.questionTextarea);
        frontEndElem.questionTextarea.dispatchEvent(new Event('input'));
        frontEndElem.sendQuestionBtn.click();
    });
});


// ─── File upload: validation + drag-and-drop ────────────────────────────

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.md', '.csv'];

function validateFile(file) {
    if (!file) return false;
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    return ALLOWED_EXTENSIONS.includes(ext);
}

frontEndElem.uploadKnowledgeBaseFileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
        const file = files[0];
        frontEndElem.uploadKnowledgeBaseFileNameDisplay.innerText = file.name;
        frontEndElem.uploadKnowledgeBaseFileNameDisplay.classList.remove('hidden');
    }
    const isValid = validateFile(files[0]);
    frontEndElem.uploadKnowledgeBaseBtn.disabled = !(files.length > 0 && isValid);
});

// Drag-and-drop highlight
if (frontEndElem.dropArea) {
    ['dragenter', 'dragover'].forEach(evt => {
        frontEndElem.dropArea.addEventListener(evt, (e) => {
            e.preventDefault();
            frontEndElem.dropArea.classList.add('drop-area-active');
        });
    });
    ['dragleave', 'drop'].forEach(evt => {
        frontEndElem.dropArea.addEventListener(evt, () => {
            frontEndElem.dropArea.classList.remove('drop-area-active');
        });
    });
}


// ─── Upload button with loading state ───────────────────────────────────

frontEndElem.uploadKnowledgeBaseBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const fileInput = frontEndElem.uploadKnowledgeBaseFileInput;
    if (!fileInput.files[0]) return showToast('Select a file first', 'error');

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    // Loading state
    const btnText = frontEndElem.uploadKnowledgeBaseBtn.textContent;
    frontEndElem.uploadKnowledgeBaseBtn.disabled = true;
    frontEndElem.uploadKnowledgeBaseBtn.innerHTML = '<span class="btn-spinner"></span>Uploading\u2026';

    try {
        const response = await fetch('/upload-knowledge-base', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            let errorMessage = 'Server Error';
            try {
                const errorData = await response.json();
                errorMessage = errorData.details || errorData.detail || errorData.error || errorMessage;
            } catch {
                const fallbackText = await response.text();
                if (fallbackText) errorMessage = fallbackText;
            }
            throw new Error(errorMessage);
        }

        const responseData = await response.json();
        showToast(responseData.message || 'File uploaded successfully!', 'success');

        // Reset
        fileInput.value = '';
        frontEndElem.uploadKnowledgeBaseFileNameDisplay.classList.add('hidden');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        frontEndElem.uploadKnowledgeBaseBtn.innerHTML = btnText;
        frontEndElem.uploadKnowledgeBaseBtn.disabled = true;  // back to disabled until new file selected
    }
});


// ─── Admin: View DB rows ────────────────────────────────────────────────

frontEndElem.viewDbRowsBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    try {
        const response = await fetch('/admin/db-rows?limit=20', {
            method: 'GET',
            headers: { 'x-auth-key': 'SDP-AI-SERVER' }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to fetch rows');

        const formattedRows = data.rows.map((row) => ({
            id: row.id,
            label: row.label,
            keywords: row.keywords,
            text: (row.text || '').slice(0, 240)
        }));

        hideWelcome();
        frontEndElem.chatBoxMain.classList.add('grow');

        const dbViewElem = document.createElement('div');
        dbViewElem.classList.add('w-full', 'h-auto', 'px-4', 'py-6', 'text-wrap', 'ai-response', 'msg-enter');
        dbViewElem.innerHTML = `
            <h3><strong>DB Rows Preview</strong></h3>
            <p>Total rows: <strong>${data.total}</strong></p>
            <pre>${JSON.stringify(formattedRows, null, 2)}</pre>
        `;

        frontEndElem.chatBoxMain.insertBefore(dbViewElem, frontEndElem.chatLoadingAnimation);
        scrollToBottom();
    } catch (error) {
        showToast(error.message || 'Failed to fetch database rows.', 'error');
    }
});


// ─── Admin: Truncate DB ─────────────────────────────────────────────────

frontEndElem.truncateDbBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const proceed = window.confirm('This will delete all rows in knowledge_base. Continue?');
    if (!proceed) return;

    try {
        const response = await fetch('/admin/db-truncate', {
            method: 'POST',
            headers: { 'x-auth-key': 'SDP-AI-SERVER' }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to truncate table');

        showToast(data.message || 'Database truncated.', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to truncate database.', 'error');
    }
});