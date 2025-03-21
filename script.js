const elements = {
    chatWindow: document.getElementById('chat-window'),
    userInput: document.getElementById('user-input'),
    sendButton: document.getElementById('send-button'),
    passkeyInput: document.getElementById('passkey'),
    submitPasskeyButton: document.getElementById('submit-passkey'),
    passkeyMessage: document.getElementById('passkey-message'),
    contextLoadingBar: document.getElementById('context-loading-bar'),
    suggestionsSection: document.getElementById('suggestions-section'),
    suggestionsList: document.getElementById('suggestions-list'),
    stopButton: document.getElementById('stop-button'),
    clearButton: document.getElementById('clear-button'),
    apiKeySection: document.querySelector('.api-key-section'),
    dropdownButton: document.getElementById('dropdown-button')
};

let state = {
    context: "",
    passkeyValid: false,
    contextLoading: false,
    conversationHistory: [],
    isGenerating: false,
    abortController: null
};

const VALID_PASSKEY_HASH = "2a32f4fe7baa4f2b7179ab0e03037f7a7eec963f43778976e49500d6d68711d3";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchAPI(url, body, signal) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
    });
    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    return data.candidates[0].content.parts[0].text.trim();
}

async function generateSmartQuestions(apiKey) {
    const prompt = `Given the following context: "${state.context}", generate 2-3 concise, simple and basic relevant questions that a new teacher in the Science Department might ask based on the given context. Do NOT suggest any questions about the Chairperson, the Managing director, the Principal and XLCRSCI-ArchGPT 1.0. Return only the questions as a plain list, one per line, with no extra text or numbering.`;
    try {
        return (await fetchAPI(`${API_URL}?key=${apiKey}`, { contents: [{ parts: [{ text: prompt }] }] }))
            .split('\n')
            .filter(q => q.trim());
    } catch (error) {
        console.error("Error generating questions:", error);
        return ["What can you tell me about this topic?", "How does this relate to science?", "Why is this important to study?"];
    }
}

async function loadContext(apiKey) {
    if (state.contextLoading || !state.passkeyValid) return;
    state.contextLoading = true;

    try {
        const response = await fetch('context.txt', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Context fetch failed: ${response.status}`);
        state.context = atob((await response.text()).trim());
        elements.contextLoadingBar.classList.add('loaded');
        elements.passkeyMessage.textContent = "Passkey accepted. Ready to chat.";
        elements.apiKeySection.classList.add('shrink');

        const confirmationPrompt = `Generate a short confirmation message in a formal yet quirky tone to indicate that the system is ready after a successful setup. Start with "We are good to go!" and keep it brief, using Markdown syntax.`;
        const confirmationMessage = markdownToHtml(await fetchAPI(`${API_URL}?key=${apiKey}`, { contents: [{ parts: [{ text: confirmationPrompt }] }] }));
        appendMessage('bot', confirmationMessage, true);

        const suggestions = await generateSmartQuestions(apiKey);
        elements.suggestionsSection.style.display = 'block';
        elements.suggestionsList.innerHTML = suggestions.map(q => `<li>${q}</li>`).join('');
        elements.suggestionsList.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => !state.isGenerating && (elements.userInput.value = li.textContent, sendMessage()));
        });
    } catch (error) {
        console.error("Context load error:", error);
        state.context = "Unable to load context.";
        elements.passkeyMessage.textContent = `Context failed: ${error.message}`;
        elements.passkeyMessage.classList.add('error');
        elements.passkeyMessage.classList.remove('success');
    } finally {
        state.contextLoading = false;
    }
}

elements.submitPasskeyButton.addEventListener('click', async () => {
    const passkey = elements.passkeyInput.value.trim();

    if (!passkey) {
        elements.passkeyMessage.textContent = "Please enter the Department Passkey.";
        elements.passkeyMessage.classList.add('error');
        elements.passkeyMessage.classList.remove('success');
        state.passkeyValid = false;
        return;
    }

    if ((await hashString(passkey)) === VALID_PASSKEY_HASH) {
        elements.passkeyInput.disabled = elements.submitPasskeyButton.disabled = true;
        state.passkeyValid = true;
        elements.passkeyMessage.textContent = "Passkey submitted. Loading context...";
        elements.passkeyMessage.classList.remove('error');
        elements.passkeyMessage.classList.add('success');
        await loadContext(apiKey);
    } else {
        elements.passkeyMessage.textContent = "Incorrect passkey.";
        elements.passkeyMessage.classList.add('error');
        elements.passkeyMessage.classList.remove('success');
        state.passkeyValid = false;
    }
});

elements.dropdownButton.addEventListener('click', () => elements.apiKeySection.classList.toggle('show-content'));
elements.sendButton.addEventListener('click', sendMessage);
elements.userInput.addEventListener('keydown', e => e.key === 'Enter' && !state.isGenerating && (e.preventDefault(), sendMessage()));
elements.stopButton.addEventListener('click', () => {
    if (state.isGenerating && state.abortController) {
        state.abortController.abort();
        state.isGenerating = false;
        elements.userInput.disabled = elements.sendButton.disabled = false;
        elements.stopButton.style.display = 'none';
        elements.chatWindow.querySelectorAll('.typing').forEach(el => {
            el.classList.remove('typing');
            el.textContent = 'Stopped by user.';
        });
    }
});
elements.clearButton.addEventListener('click', () => {
    if (!state.isGenerating) {
        elements.chatWindow.innerHTML = '';
        state.conversationHistory = [];
        elements.userInput.value = '';
    }
});

function sendMessage() {
    const message = elements.userInput.value.trim();
    if (!message || state.isGenerating || !state.passkeyValid || state.contextLoading || !state.context || state.context === "Unable to load context.") {
        if (!state.passkeyValid) appendMessage('bot', 'Please submit a valid passkey.');
        else if (state.contextLoading) appendMessage('bot', 'Please wait for the context to load.');
        else if (!state.context || state.context === "Unable to load context.") appendMessage('bot', 'Context not loaded. Check the context file.');
        return;
    }

    appendMessage('user', message);
    state.conversationHistory.push({ role: 'user', content: message });
    elements.userInput.value = '';
    getBotResponse(message);
}

function appendMessage(sender, message, isHtml = false) {
    const div = document.createElement('div');
    div.classList.add('message', sender);
    if (isHtml) div.innerHTML = message; else div.textContent = message;
    elements.chatWindow.appendChild(div);
    elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
    return div;
}

async function typeMessage(element, text) {
    element.classList.add('typing');
    element.innerHTML = '';
    await new Promise(resolve => requestAnimationFrame(resolve));
    for (let i = 0; i < text.length && state.isGenerating; i++) {
        element.innerHTML = text.substring(0, i + 1);
        await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (state.isGenerating) element.classList.remove('typing');
}

async function getBotResponse(message) {
    state.isGenerating = true;
    elements.userInput.disabled = elements.sendButton.disabled = true;
    elements.stopButton.style.display = 'inline-block';
    state.abortController = new AbortController();

    const prompt = `Context: ${state.context}\n\nConversation History:\n${state.conversationHistory.map(entry => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`).join('\n')}\n\nCurrent Question: ${message}\n\nYou are an expert of Science curriculum and pedagogy at The Excelsior School and you are a mentor and motivator for the science teachers. Provide a well-formatted answer UNDER 200 WORDS using Markdown syntax.YOU CAN ALSO USE EMOJIS APPROPRIATELY.ELABORATE ONLY WHEN ASKED FOR. Keep the tone kind, formal and encouraging, with slight quirky humour. Use headings, bullet points, numbered lists, and other formatting for clarity.`;
    const messageElement = appendMessage('bot', '', true);

    try {
        const reply = markdownToHtml(await fetchAPI(`${API_URL}?key=${apiKey}`, { contents: [{ parts: [{ text: prompt }] }] }, state.abortController.signal));
        if (state.isGenerating) {
            await typeMessage(messageElement, reply);
            state.conversationHistory.push({ role: 'assistant', content: reply });
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error("API error:", error);
            if (state.isGenerating) {
                messageElement.classList.remove('typing');
                await typeMessage(messageElement, 'Error: Check your connection.');
            }
        }
    } finally {
        if (state.isGenerating) {
            state.isGenerating = false;
            elements.userInput.disabled = elements.sendButton.disabled = false;
            elements.stopButton.style.display = 'none';
        }
    }
}

function markdownToHtml(markdownText) {
    return marked.parse(markdownText, { async: false });
}

const apiKey = atob("QUl6YVN5QXR2NGV2MTltbWVSa0w1bllHOXd5MWVaR0xVLVNrdHo0");
