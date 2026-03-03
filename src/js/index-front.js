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

        const response = await fetch('http://localhost:8080/ask-ai-with-vector', {
            method : 'POST',
            headers : {
                'Content-Type' : 'application/json',
                'x-auth-key' : 'SDP-AI-SERVER'
            },
            body : JSON.stringify({ message } )
        });

        const result = await response.json();
        const newAIReply = document.createElement('div');
        newAIReply.classList.add('w-full', 'h-auto', 'px-4', 'py-6', 'leading-10', 'text-wrap', 'break-all', 'ai-response');
        
        const convertedMarkDown = marked.parse(result.response)
        newAIReply.innerHTML = convertedMarkDown;
        frontEndElem.chatBoxMain.insertBefore(newAIReply, frontEndElem.chatLoadingAnimation);
        frontEndElem.chatLoadingAnimation.classList.replace('block', 'hidden');
        frontEndElem.chatBoxMain.scrollTop = frontEndElem.chatBoxMain.scrollHeight;
        return;
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


// frontEndElem.tagsChoices.forEach( (tag) => {
//     tag.addEventListener('click', (e) => {
//         e.preventDefault();
//         const tagText = tag.textContent.trim();
//         const existingTags = frontEndElem.questionTextarea.value.split(',').map(t => t.trim()).filter(t => t.length > 0);