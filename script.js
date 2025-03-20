document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chat-window');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const passkeyInput = document.getElementById('passkey');
    const submitApiKeyButton = document.getElementById('submit-api-key');
    const apiKeyMessage = document.getElementById('api-key-message');
    const contextLoadingBar = document.getElementById('context-loading-bar');
    const suggestionsSection = document.getElementById('suggestions-section');
    const suggestionsList = document.getElementById('suggestions-list');
    const stopButton = document.getElementById('stop-button');
    const clearButton = document.getElementById('clear-button');
    const downloadLogButton = document.getElementById('download-log-button');
    const dropdownButton = document.getElementById('dropdown-button');

    const ENCRYPTED_API_KEYS = [
        "QUl6YVN5QXR2NGV2MTltbWVSa0w1bllHOXd5MWVaR0xVLVNrdHo0",
        "QUl6YVN5QXR2NGV2MTltbWVSa0w1bllHOXd5MWVaR0xVLVNrdHo0"
    ];

    let context = "Placeholder context—science rocks!"; // Hardcoded for speed
    let apiKey = null;
    let passkeyValid = false;
    let conversationLog = "";
    let conversationHistory = [];
    let isGenerating = false;
    let abortController = null;
    let rudeMessageCount = 0;
    let roastMode = false;

    const VALID_PASSKEY_HASH = "2a32f4fe7baa4f2b7179ab0e03037f7a7eec963f43778976e49500d6d68711d3";

    if (!chatWindow || !userInput || !sendButton || !passkeyInput || !submitApiKeyButton || !apiKeyMessage || !stopButton || !clearButton || !downloadLogButton) {
        console.error("Missing DOM elements:", { chatWindow, userInput, sendButton, passkeyInput, submitApiKeyButton, apiKeyMessage, stopButton, clearButton, downloadLogButton });
        return;
    }

    console.log("DOM loaded, script running—fast track engaged.");

    async function hashString(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function decryptApiKey(encryptedKey) {
        return atob(encryptedKey);
    }

    function selectRandomApiKey() {
        return decryptApiKey(ENCRYPTED_API_KEYS[Math.floor(Math.random() * ENCRYPTED_API_KEYS.length)]);
    }

    async function checkRudeness(message, apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const prompt = `Rate the following message on a rudeness scale from 0 (polite) to 10 (extremely rude): "${message}". Return only a number between 0 and 10, no extra text.`;
        try {
            const response = await Promise.race([
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ]);
            if (!response.ok) throw new Error('Rudeness check failed');
            const data = await response.json();
            const score = parseInt(data.candidates[0].content.parts[0].text.trim(), 10);
            return isNaN(score) || score < 0 || score > 10 ? 0 : score;
        } catch (error) {
            console.error("Rudeness check error:", error);
            return 0;
        }
    }

    submitApiKeyButton.addEventListener('click', async () => {
        console.log("Submit clicked");
        const passkey = passkeyInput.value.trim();
        if (!passkey) {
            apiKeyMessage.textContent = "Enter a passkey—no excuses.";
            apiKeyMessage.classList.add('error');
            apiKeyMessage.classList.remove('success');
            return;
        }
        const passkeyHash = await hashString(passkey);
        if (passkeyHash === VALID_PASSKEY_HASH) {
            passkeyValid = true;
            apiKey = selectRandomApiKey();
            apiKeyMessage.textContent = "Passkey verified—locked and loaded.";
            apiKeyMessage.classList.add('success');
            apiKeyMessage.classList.remove('error');
            passkeyInput.disabled = true;
            submitApiKeyButton.disabled = true;
            appendMessage('bot', "## We’re good to go!\nScience awaits—hit me with your best shot.");
            conversationLog += "Bot: We’re good to go! Science awaits—hit me with your best shot.\n\n";
            contextLoadingBar.classList.add('loaded');
        } else {
            apiKeyMessage.textContent = "Wrong passkey—try harder.";
            apiKeyMessage.classList.add('error');
            apiKeyMessage.classList.remove('success');
        }
    });

    sendButton.addEventListener('click', () => {
        console.log("Send clicked");
        sendMessage();
    });

    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !isGenerating) {
            console.log("Enter pressed");
            event.preventDefault();
            sendMessage();
        }
    });

    stopButton.addEventListener('click', () => {
        console.log("Stop clicked");
        if (isGenerating && abortController) {
            abortController.abort();
            isGenerating = false;
            userInput.disabled = false;
            sendButton.disabled = false;
            stopButton.style.display = 'none';
            appendMessage('bot', "Stopped—let’s regroup.");
            conversationLog += "Bot: Stopped—let’s regroup.\n\n";
        }
    });

    clearButton.addEventListener('click', () => {
        console.log("Clear clicked");
        if (!isGenerating) {
            chatWindow.innerHTML = '';
            conversationHistory = [];
            conversationLog = "";
            userInput.value = '';
            rudeMessageCount = 0;
            roastMode = false;
        }
    });

    downloadLogButton.addEventListener('click', () => {
        console.log("Download clicked");
        if (conversationLog.trim() === "") {
            alert("No convo yet—get to work!");
            return;
        }
        const blob = new Blob([conversationLog], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Talk.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    });

    dropdownButton.addEventListener('click', () => {
        console.log("Dropdown clicked");
        document.querySelector('.api-key-section').classList.toggle('show-content');
    });

    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message || isGenerating) return;

        if (!passkeyValid) {
            appendMessage('bot', "Passkey first—no skipping steps.");
            conversationLog += "Bot: Passkey first—no skipping steps.\n\n";
            return;
        }

        appendMessage('user', message);
        conversationLog += `User: ${message}\n`;
        conversationHistory.push({ role: 'user', content: message });

        const rudenessScore = await checkRudeness(message, apiKey);
        if (rudenessScore > 5) {
            rudeMessageCount++;
            console.log(`Rude count: ${rudeMessageCount}`);
        }

        const isApology = message.toLowerCase().includes('sorry') || message.toLowerCase().includes('apologize');
        if (isApology && roastMode) {
            rudeMessageCount = 0;
            roastMode = false;
            appendMessage('bot', "## Apology Noted\nResponsibility owned—back to science. What’s next?");
            conversationLog += "Bot: Apology Noted - Responsibility owned—back to science. What’s next?\n\n";
        } else if (rudeMessageCount > 3) {
            roastMode = true;
        }

        userInput.value = '';
        getBotResponse(message);
    }

    function appendMessage(sender, message, isHtml = false) {
        const div = document.createElement('div');
        div.classList.add('message', sender);
        if (isHtml) div.innerHTML = message;
        else div.textContent = message;
        chatWindow.appendChild(div);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return div;
    }

    async function typeMessage(element, textOrCallback) {
        element.classList.add('typing');
        element.innerHTML = '';
        await new Promise(resolve => setTimeout(resolve, 250)); // Faster diamond
        const text = typeof textOrCallback === 'function' ? await textOrCallback() : textOrCallback;
        const htmlText = markdownToHtml(text);
        await new Promise(resolve => setTimeout(resolve, 500)); // Shorter delay
        for (let i = 0; i < htmlText.length; i++) {
            element.innerHTML = htmlText.substring(0, i + 1);
            await new Promise(resolve => setTimeout(resolve, 10)); // Faster typing
        }
        element.classList.remove('typing');
    }

    async function getBotResponse(message) {
        isGenerating = true;
        userInput.disabled = true;
        sendButton.disabled = true;
        stopButton.style.display = 'inline-block';
        abortController = new AbortController();

        const messageElement = appendMessage('bot', '', true);
        let prompt = roastMode
            ? `The user said: "${message}". Roast them sharp and witty, no clichés, under 100 words, Markdown syntax. Demand an apology—fair but firm.`
            : `Context: ${context}\nHistory:\n${conversationHistory.map(e => `${e.role}: ${e.content}`).join('\n')}\nInput: ${message}\nRespond as a Science expert, formal yet approachable, kind but firm, Markdown syntax. Concise, structured, actionable—start basic if needed. Ask for elaboration only on context topics. Encourage reflection with a question. Slight humor, headings/lists as needed.`;

        try {
            await typeMessage(messageElement, async () => {
                const response = await Promise.race([
                    fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                        signal: abortController.signal
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout')), 5000))
                ]);
                if (!response.ok) throw new Error('API failed');
                const data = await response.json();
                const reply = data.candidates[0].content.parts[0].text || "No reply—focus up.";
                if (!roastMode) conversationHistory.push({ role: 'assistant', content: reply });
                conversationLog += `Bot: ${reply.replace(/[#\n]/g, ' ').trim()}\n\n`;
                return reply;
            });
        } catch (error) {
            console.error("Response error:", error);
            messageElement.innerHTML = "Error: Slow API or bad key—check console.";
            conversationLog += "Bot: Error: Slow API or bad key—check console.\n\n";
        } finally {
            isGenerating = false;
            userInput.disabled = false;
            sendButton.disabled = false;
            stopButton.style.display = 'none';
        }
    }

    function markdownToHtml(markdownText) {
        return marked.parse(markdownText);
    }
});
