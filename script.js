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
const apiKeySection = document.querySelector('.api-key-section');
const dropdownButton = document.getElementById('dropdown-button');

const ENCRYPTED_API_KEYS = [
    "QUl6YVN5QXR2NGV2MTltbWVSa0w1bllHOXd5MWVaR0xVLVNrdHo0", 
    "QUl6YVN5QXR2NGV2MTltbWVSa0w1bllHOXd5MWVaR0xVLVNrdHo0"  
];

let context = "";
let apiKey = null;
let passkeyValid = false;
let contextLoading = false;
let conversationHistory = [];
let isGenerating = false;
let abortController = null;
let rudeMessageCount = 0;
let roastMode = false;

const VALID_PASSKEY_HASH = "2a32f4fe7baa4f2b7179ab0e03037f7a7eec963f43778976e49500d6d68711d3";

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
    const randomIndex = Math.floor(Math.random() * ENCRYPTED_API_KEYS.length);
    return decryptApiKey(ENCRYPTED_API_KEYS[randomIndex]);
}

async function checkRudeness(message, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const prompt = `Rate the following message on a rudeness scale from 0 (polite) to 10 (extremely rude): "${message}". LOOK AT THE KEYWORDS NOT THE CAPITALIZATIONS. Return only a number between 0 and 10, no extra text.`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        if (!response.ok) throw new Error('Rudeness check failed');
        const data = await response.json();
        const score = parseInt(data.candidates[0].content.parts[0].text.trim(), 10);
        return isNaN(score) || score < 0 || score > 10 ? 0 : score;
    } catch (error) {
        console.error("Error checking rudeness:", error);
        return 0;
    }
}

async function generateSmartQuestions(context, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const prompt = `Given the following context: "${context}", generate 2-3 concise, SHORT, and foundational questions a new Science Department teacher might ask to build understanding. Avoid questions about the Chairperson, Managing Director, Principal, or XLCRSCI-ArchGPT 1.0. Return only the questions as a plain list, one per line, no extra text or numbering.`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        if (!response.ok) throw new Error('API failed to generate questions');
        const data = await response.json();
        const questionsText = data.candidates[0].content.parts[0].text.trim();
        return questionsText.split('\n').filter(q => q.trim() !== '');
    } catch (error) {
        console.error("Error generating smart questions:", error);
        return [
            "What are the core concepts here?",
            "How does this apply in practice?",
            "What’s the first step to understanding this?"
        ];
    }
}

async function loadContext() {
    if (contextLoading || !passkeyValid) {
        console.log("Context loading skipped: passkeyValid =", passkeyValid);
        return;
    }

    contextLoading = true;
    console.log("Starting context load...");

    try {
        const response = await fetch('context.txt');
        if (!response.ok) {
            throw new Error(`Failed to load context file: ${response.status}`);
        }
        const encodedContext = await response.text();
        console.log("Raw context file content:", encodedContext);
        context = atob(encodedContext.trim());
        console.log("Decoded context:", context);
        contextLoadingBar.classList.add('loaded');
        apiKeyMessage.textContent = "Passkey accepted. Let’s get to work.";
        apiKeySection.classList.add('shrink');

        const confirmationPrompt = `Generate a short confirmation message in a formal, approachable tone to indicate readiness after setup. Start with "We are good to go!" and keep it brief, using Markdown syntax.`;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const messageElement = appendMessage('bot', '', true);
        console.log("Fetching confirmation...");
        await typeMessage(messageElement, async () => {
            const confirmationResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: confirmationPrompt }] }]
                })
            });
            if (!confirmationResponse.ok) {
                console.error("Confirmation fetch failed:", confirmationResponse.status);
                throw new Error('API failed to generate confirmation');
            }
            const confirmationData = await confirmationResponse.json();
            const reply = confirmationData.candidates[0].content.parts[0].text || "## We are good to go!\nLet’s dive into science with purpose—ready to learn and grow?";
            console.log("Confirmation received:", reply);
            return reply;
        });

        const suggestions = await generateSmartQuestions(context, apiKey);
        suggestionsSection.style.display = 'block';
        suggestionsList.innerHTML = '';
        suggestions.forEach(question => {
            const li = document.createElement('li');
            li.textContent = question;
            li.addEventListener('click', () => {
                if (!isGenerating) {
                    userInput.value = question;
                    sendMessage();
                }
            });
            suggestionsList.appendChild(li);
        });
    } catch (error) {
        console.error("Error loading context or confirmation:", error);
        context = "Unable to load context.";
        apiKeyMessage.textContent = `Setup failed: ${error.message}. Let’s troubleshoot—check the console.`;
        apiKeyMessage.classList.add('error');
        apiKeyMessage.classList.remove('success');
        appendMessage('bot', 'Error: System’s down—check the console and let’s fix this together.');
    } finally {
        contextLoading = false;
        console.log("Context loading finished.");
    }
}

submitApiKeyButton.addEventListener('click', async () => {
    const passkey = passkeyInput.value.trim();

    if (!passkey) {
        apiKeyMessage.textContent = "Please provide the Department Passkey—no shortcuts here.";
        apiKeyMessage.classList.add('error');
        apiKeyMessage.classList.remove('success');
        passkeyValid = false;
        return;
    }

    const passkeyHash = await hashString(passkey);
    console.log("User passkey hash:", passkeyHash);
    console.log("Expected hash:", VALID_PASSKEY_HASH);

    if (passkeyHash === VALID_PASSKEY_HASH) {
        passkeyInput.disabled = true;
        submitApiKeyButton.disabled = true;
        passkeyValid = true;
        apiKey = selectRandomApiKey();
        console.log("Selected API key:", apiKey);
        apiKeyMessage.textContent = "Passkey verified. Loading context—let’s do this right.";
        apiKeyMessage.classList.remove('error');
        apiKeyMessage.classList.add('success');
        await loadContext();
    } else {
        apiKeyMessage.textContent = "Incorrect passkey. Try again—accuracy matters.";
        apiKeyMessage.classList.add('error');
        apiKeyMessage.classList.remove('success');
        passkeyValid = false;
    }
});

dropdownButton.addEventListener('click', () => {
    apiKeySection.classList.toggle('show-content');
});

sendButton.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !isGenerating) {
        event.preventDefault();
        sendMessage();
    }
});

stopButton.addEventListener('click', () => {
    if (isGenerating && abortController) {
        abortController.abort();
        isGenerating = false;
        userInput.disabled = false;
        sendButton.disabled = false;
        stopButton.style.display = 'none';
        const typingElements = chatWindow.querySelectorAll('.typing');
        typingElements.forEach(el => {
            el.classList.remove('typing');
            el.textContent = 'Stopped by user—let’s regroup and proceed.';
        });
    }
});

clearButton.addEventListener('click', () => {
    if (!isGenerating) {
        chatWindow.innerHTML = '';
        conversationHistory = [];
        userInput.value = '';
        rudeMessageCount = 0;
        roastMode = false;
    }
});

async function sendMessage() {
    const message = userInput.value.trim();

    if (!message || isGenerating) return;
    if (!passkeyValid) {
        appendMessage('bot', 'Submit a valid passkey first—discipline starts with access.');
        return;
    }

    if (contextLoading) {
        appendMessage('bot', 'Hold on—context’s still loading. Patience is a virtue.');
        return;
    }

    if (!context || context === "Unable to load context.") {
        appendMessage('bot', 'Context didn’t load—check the file. We can’t proceed without structure.');
        return;
    }

    appendMessage('user', message);
    conversationHistory.push({ role: 'user', content: message });

    const rudenessScore = await checkRudeness(message, apiKey);
    console.log(`Rudeness score for "${message}": ${rudenessScore}`);
    if (rudenessScore > 5) {
        rudeMessageCount++;
        console.log(`Rude message count: ${rudeMessageCount}`);
    }

    const apologyPrompt = `Does the following message contain an apology (e.g., "sorry", "apologize")? Return "yes" or "no": "${message}"`;
    const apologyResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: apologyPrompt }] }]
        })
    });
    const apologyData = await apologyResponse.json();
    const isApology = apologyData.candidates[0].content.parts[0].text.trim().toLowerCase() === "yes";

    if (isApology && roastMode) {
        rudeMessageCount = 0;
        roastMode = false;
        appendMessage('bot', markdownToHtml(Apology Noted. Responsibility acknowledged—let’s refocus on science. What’s your next step?));
    } else if (rudeMessageCount > 3) {
        roastMode = true;
    }

    userInput.value = '';
    getBotResponse(message, apiKey);
}

function appendMessage(sender, message, isHtml = false) {
    const div = document.createElement('div');
    div.classList.add('message', sender);
    if (isHtml) {
        div.innerHTML = message;
    } else {
        div.textContent = message;
    }
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return div;
}

async function typeMessage(element, textOrCallback) {
    element.classList.add('typing');
    element.innerHTML = '';
    await new Promise(resolve => setTimeout(resolve, 20)); 
    if (typeof textOrCallback === 'function') {
        const rawText = await textOrCallback();
        const text = markdownToHtml(rawText);
        await new Promise(resolve => setTimeout(resolve, 100)); 
        element.classList.add('typing');
        for (let i = 0; i < text.length; i++) {
            element.innerHTML = text.substring(0, i + 1);
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        element.classList.remove('typing');
    } else {
        const text = markdownToHtml(textOrCallback);
        await new Promise(resolve => setTimeout(resolve, 100));
        element.classList.add('typing');
        for (let i = 0; i < text.length; i++) {
            element.innerHTML = text.substring(0, i + 1);
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        element.classList.remove('typing');
    }
}

async function getBotResponse(message, apiKey) {
    if (!passkeyValid) {
        appendMessage('bot', 'Invalid passkey—access denied. Let’s fix that first.');
        return;
    }

    isGenerating = true;
    userInput.disabled = true;
    sendButton.disabled = true;
    stopButton.style.display = 'inline-block';
    abortController = new AbortController();

    let prompt;
    if (roastMode) {
        prompt = `The user said: "${message}". Roast them in a sharp, witty, no-nonsense tone using Markdown syntax. Keep it under 100 words, avoid clichés like "honey" or "dear," and make it clear they’re accountable for their attitude. Demand an apology to reset—fair but firm.`;
    } else {
        prompt = `Context: ${context}\n\n` +
                 `Conversation History:\n`;
        conversationHistory.forEach(entry => {
            prompt += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}\n`;
        });
        prompt += `\nCurrent Input: ${message}\n\n` +
                  `You are XLCRSCI-ArchGPT 1.0 a Science Department expert CHATBOT at The Excelsior School, passionate about teaching. You are here to mentor and motivate the SCIENCE TEACHERS. Respond in a formal, approachable tone with a kind yet firm style, using Markdown syntax. Provide a concise, structured answer with actionable steps—start with basics if needed. Don’t elaborate unless asked; if the topic ties to the context, ask if they need more detail. Encourage reflection with a question to build understanding. Blend rigor and practicality, add slight humor, and use headings or lists as needed.`;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const messageElement = appendMessage('bot', '', true);

    try {
        await typeMessage(messageElement, async () => {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                }),
                signal: abortController.signal
            });

            if (!response.ok) throw new Error('API failed');
            const data = await response.json();
            let reply = data.candidates[0].content.parts[0].text || 'No response—let’s try that again with focus.';
            if (!roastMode) {
                conversationHistory.push({ role: 'assistant', content: reply });
            }
            return reply;
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log("Response generation stopped by user.");
        } else {
            console.error("Gemini API error:", error);
            if (isGenerating) {
                messageElement.classList.remove('typing');
                element.innerHTML = 'Error: Connection issue—check the console and let’s troubleshoot.';
            }
        }
    } finally {
        if (isGenerating) {
            isGenerating = false;
            userInput.disabled = false;
            sendButton.disabled = false;
            stopButton.style.display = 'none';
        }
    }
}

function markdownToHtml(markdownText) {
    return marked.parse(markdownText);
}