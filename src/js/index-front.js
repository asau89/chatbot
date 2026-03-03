const frontEndElem = {
    burgerCloseBtn : document.querySelector('.burger-close-btn'),
    burgerSvg : document.querySelector('.burger-close-btn svg:nth-child(1)'),
    closeSvg : document.querySelector('.burger-close-btn svg:nth-child(2)'),
    chMenuModal : document.getElementById('ch-menu-modal'),
    sendQuestionBtn : document.querySelector('.send-question-btn'),
    questionTextarea : document.querySelector('.question-textarea'),
    tagsChoices : document.querySelectorAll('.tags-choices'),
    chatBoxMain : document.querySelector('.chat-box-main'),
    chatBubble : document.querySelectorAll('.chat'),
    chatLoadingAnimation : document.querySelector('.chat-loading-animation'),
    viewDbChunksBtn : document.getElementById('view-db-chunks-btn'),
    showDbSchemaBtn : document.getElementById('show-db-schema-btn'),
    clearKnowledgeBaseBtn : document.getElementById('clear-kb-btn'),
    uploadKnowledgeBaseBtn : document.querySelector('#upload-knowledge-btn'),
    uploadKnowledgeBaseFileInput : document.getElementById('dropzone-file'),
    uploadKnowledgeBaseFileNameDisplay : document.getElementById('file-name')
};



frontEndElem.burgerCloseBtn.addEventListener('click', (e) => {
    e.preventDefault();

    if(frontEndElem.burgerCloseBtn.classList.contains('ch-closed')) {
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


frontEndElem.questionTextarea.addEventListener('input', () => {
    const hasText = frontEndElem.questionTextarea.value.trim().length > 0;
    const hasChatStarted = !!frontEndElem.chatBubble; 
    if (hasText) {
        frontEndElem.sendQuestionBtn.classList.remove('cursor-not-allowed');
        frontEndElem.sendQuestionBtn.removeAttribute('disabled');
    } else {
        frontEndElem.sendQuestionBtn.classList.add('cursor-not-allowed');
        frontEndElem.sendQuestionBtn.setAttribute('disabled', 'true');
    }

    if (hasText || hasChatStarted) {
        frontEndElem.chatBoxMain.classList.add('grow');
    } else {
        frontEndElem.chatBoxMain.classList.remove('grow');
    }
});


frontEndElem.sendQuestionBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    frontEndElem.sendQuestionBtn.disabled = true;

    const message = frontEndElem.questionTextarea.value.trim();

    if(message.length > 0) {
        frontEndElem.chatLoadingAnimation.classList.replace('hidden', 'block')
        
        // Add time tracking element to loading animation
        let timerElement = frontEndElem.chatLoadingAnimation.querySelector('.processing-timer');
        if (!timerElement) {
            timerElement = document.createElement('span');
            timerElement.className = 'processing-timer text-xs text-gray-400 ml-2';
            frontEndElem.chatLoadingAnimation.appendChild(timerElement);
        }
        
        const divElem = document.createElement('div');
        divElem.classList.add('chat', 'chat-end');
        divElem.innerHTML = `
            <div class="chat-bubble chat-bubble-primary text-wrap h-auto break-all">
                ${message}
            </div>
        `;
        frontEndElem.chatBoxMain.insertBefore(divElem, frontEndElem.chatLoadingAnimation);
        frontEndElem.sendQuestionBtn.disabled = true;
        frontEndElem.questionTextarea.value ='';
        frontEndElem.chatBoxMain.scrollTop = frontEndElem.chatBoxMain.scrollHeight;

        // Start timer
        const startTime = Date.now();
        const timerInterval = setInterval(() => {
            const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
            timerElement.textContent = `⏱️ ${elapsedSeconds}s`;
        }, 100);

        const traceBox = document.createElement('div');
        traceBox.classList.add('w-full', 'h-auto', 'px-4', 'py-3', 'text-wrap', 'break-all', 'ai-response');
        traceBox.innerHTML = '<div class="font-semibold">RAG Processing Logs</div><div class="trace-lines text-sm leading-6 opacity-80"></div>';
        const traceLines = traceBox.querySelector('.trace-lines');
        frontEndElem.chatBoxMain.insertBefore(traceBox, frontEndElem.chatLoadingAnimation);

        const appendTrace = (line) => {
            const logLine = document.createElement('div');
            logLine.textContent = line;
            traceLines.appendChild(logLine);
            frontEndElem.chatBoxMain.scrollTop = frontEndElem.chatBoxMain.scrollHeight;
        };

        try {
            const response = await fetch('http://localhost:8080/ask-ai-with-vector-stream', {
                method : 'POST',
                headers : {
                    'Content-Type' : 'application/json',
                    'x-auth-key' : 'SDP-AI-SERVER'
                },
                body : JSON.stringify({ message } )
            });

            if (!response.ok || !response.body) {
                throw new Error('Server Error');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line) continue;

                    let event;
                    try {
                        event = JSON.parse(line);
                    } catch (_) {
                        continue;
                    }

                    if (event.type === 'log') {
                        const time = new Date(event.timestamp).toLocaleTimeString();
                        appendTrace(`[${time}] ${event.step} | +${event.durationMs}ms | total ${event.elapsedMs}ms`);
                    }

                    if (event.type === 'error') {
                        throw new Error(event.message || 'Server Error');
                    }

                    if (event.type === 'result') {
                        finalResult = event;
                    }
                }
            }

            if (!finalResult) {
                throw new Error('No final result received from server');
            }

            clearInterval(timerInterval);
            timerElement.textContent = `✅ Processing time: ${finalResult.processingTime}`;

            const newAIReply = document.createElement('div');
            newAIReply.classList.add('w-full', 'h-auto', 'px-4', 'py-6', 'leading-10', 'text-wrap', 'break-all', 'ai-response');

            const convertedMarkDown = marked.parse(finalResult.response)
            newAIReply.innerHTML = convertedMarkDown;
            frontEndElem.chatBoxMain.insertBefore(newAIReply, frontEndElem.chatLoadingAnimation);
            frontEndElem.chatLoadingAnimation.classList.replace('block', 'hidden');
            frontEndElem.chatBoxMain.scrollTop = frontEndElem.chatBoxMain.scrollHeight;
            return;
        } catch (error) {
            clearInterval(timerInterval);
            timerElement.textContent = '❌ Failed';
            appendTrace(`Error: ${error.message}`);
            alert(error.message);
            frontEndElem.chatLoadingAnimation.classList.replace('block', 'hidden');
        }
    }

});



frontEndElem.questionTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {    
        e.preventDefault();
        frontEndElem.sendQuestionBtn.click();
    }
});


frontEndElem.uploadKnowledgeBaseFileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});


function handleFiles(files) {
    if (files.length > 0) {
        const file = files[0];
        console.log('File uploaded:', file.name);
        frontEndElem.uploadKnowledgeBaseFileNameDisplay.innerText = file.name;
        frontEndElem.uploadKnowledgeBaseFileNameDisplay.classList.remove('hidden');
    }
}

function validateFile(file) {
    if (file && file.type === "application/pdf") {
        return true;
    } else {
        return false;
    }
}


frontEndElem.uploadKnowledgeBaseFileInput.addEventListener('change', (e) => {
    const isPDF = validateFile(e.target.files[0]);
    const isFileInputNotEmpty = e.target.files.length > 0;
    if(isFileInputNotEmpty && isPDF) {
        frontEndElem.uploadKnowledgeBaseBtn.disabled = false;
        return
    }
    else {
        frontEndElem.uploadKnowledgeBaseBtn.disabled = true;
    }
});



frontEndElem.uploadKnowledgeBaseBtn.addEventListener('click', async(e) => {
    e.preventDefault();

    const pdfFile = frontEndElem.uploadKnowledgeBaseFileInput;
    if (!pdfFile.files[0]) return alert("Select a PDF first");

    const file = pdfFile.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload-knowledge-base', {
            method : 'POST',
            body : formData
        });

        if(!response.ok) throw new Error('Server Error');

        const responseData = await response.json();
        alert(responseData.message)
    }
    catch(e) {
        alert(e.message);
    }

    
})

frontEndElem.viewDbChunksBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    frontEndElem.chatLoadingAnimation.classList.replace('hidden', 'block');

    try {
        const response = await fetch('/db-chunks', {
            method: 'GET',
            headers: {
                'x-auth-key': 'SDP-AI-SERVER'
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Failed to fetch chunks');
        }

        const chunksView = document.createElement('div');
        chunksView.classList.add('w-full', 'h-auto', 'px-4', 'py-6', 'leading-7', 'text-wrap', 'break-all', 'ai-response');

        const header = `## DB Chunks (${result.count})\n\n`;
        const chunksMarkdown = result.chunks.map((chunk) => {
            const fullText = chunk.text || '';

            return `### Chunk ${chunk.chunkIndex}\n\n- **Label:** ${chunk.label}\n- **Keywords:** ${chunk.keywords}\n- **Text:** ${fullText}`;
        }).join('\n\n---\n\n');

        chunksView.innerHTML = marked.parse(header + chunksMarkdown);
        frontEndElem.chatBoxMain.insertBefore(chunksView, frontEndElem.chatLoadingAnimation);
        frontEndElem.chatBoxMain.scrollTop = frontEndElem.chatBoxMain.scrollHeight;
    } catch (error) {
        alert(error.message);
    } finally {
        frontEndElem.chatLoadingAnimation.classList.replace('block', 'hidden');
    }
})

frontEndElem.showDbSchemaBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    frontEndElem.chatLoadingAnimation.classList.replace('hidden', 'block');

    try {
        const response = await fetch('/db-schema', {
            method: 'GET',
            headers: {
                'x-auth-key': 'SDP-AI-SERVER'
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Failed to fetch schema');
        }

        const schemaView = document.createElement('div');
        schemaView.classList.add('w-full', 'h-auto', 'px-4', 'py-6', 'leading-7', 'text-wrap', 'break-all', 'ai-response');

        const header = `## DB Schema (${result.fieldCount} fields)\n\n`;
        const fieldsMarkdown = result.fields
            .map((field, index) => `${index + 1}. **${field.name}** — ${field.type} (nullable: ${field.nullable})`)
            .join('\n');

        schemaView.innerHTML = marked.parse(header + fieldsMarkdown);
        frontEndElem.chatBoxMain.insertBefore(schemaView, frontEndElem.chatLoadingAnimation);
        frontEndElem.chatBoxMain.scrollTop = frontEndElem.chatBoxMain.scrollHeight;
    } catch (error) {
        alert(error.message);
    } finally {
        frontEndElem.chatLoadingAnimation.classList.replace('block', 'hidden');
    }
});

frontEndElem.clearKnowledgeBaseBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const isConfirmed = confirm('Clear all rows in knowledge base? This cannot be undone.');
    if (!isConfirmed) {
        return;
    }

    frontEndElem.chatLoadingAnimation.classList.replace('hidden', 'block');

    try {
        const response = await fetch('/clear-knowledge-base', {
            method: 'POST',
            headers: {
                'x-auth-key': 'SDP-AI-SERVER'
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Failed to clear knowledge base');
        }

        const clearResultView = document.createElement('div');
        clearResultView.classList.add('w-full', 'h-auto', 'px-4', 'py-6', 'leading-7', 'text-wrap', 'break-all', 'ai-response');

        const clearMarkdown = [
            '## Knowledge Base Cleared',
            '',
            `- **Before:** ${result.beforeCount} rows`,
            `- **After:** ${result.afterCount} rows`,
            `- **Status:** ${result.message}`,
        ].join('\n');

        clearResultView.innerHTML = marked.parse(clearMarkdown);
        frontEndElem.chatBoxMain.insertBefore(clearResultView, frontEndElem.chatLoadingAnimation);
        frontEndElem.chatBoxMain.scrollTop = frontEndElem.chatBoxMain.scrollHeight;
    } catch (error) {
        alert(error.message);
    } finally {
        frontEndElem.chatLoadingAnimation.classList.replace('block', 'hidden');
    }
});


// frontEndElem.tagsChoices.forEach( (tag) => {
//     tag.addEventListener('click', (e) => {
//         e.preventDefault();
//         const tagText = tag.textContent.trim();
//         const existingTags = frontEndElem.questionTextarea.value.split(',').map(t => t.trim()).filter(t => t.length > 0);