// Chat widget for the home page. Questions go to the Cloudflare Worker in
// chat-worker/, which holds the Gemini key and the context the bot answers from.
(() => {
    const WORKER_URL = "https://mateo-site-chat.esume--ebsite.workers.dev";
    const MAX_TURNS = 12; // the Worker ignores anything older
    const SUGGESTIONS = [
        "Is this chatbot really necessary for a random portfolio site?",
        "What is Mateo working on right now?",
        "What are examples of Mateo's work in machine learning?",
    ];
    const URL_PATTERN = /https?:\/\/[^\s<>()]+/g;

    const root = document.createElement("div");
    root.innerHTML = `
        <div class="chat-panel" id="chat-panel" role="dialog" aria-label="Questions?" hidden>
            <div class="chat-head">
                <div>
                    <p class="chat-title">Ask about Mateo</p>
                    <p class="chat-sub">I made an AI assistant because I thought it'd be funny</p>
                </div>
                <button class="chat-close" type="button" aria-label="Close chat">&times;</button>
            </div>
            <div class="chat-log" aria-live="polite"></div>
            <form class="chat-form">
                <input class="chat-input" type="text" maxlength="500" placeholder="Ask a question..." aria-label="Your question" autocomplete="off">
                <button class="chat-send" type="submit" aria-label="Send">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                </button>
            </form>
            <p class="chat-note">Powered by Google Gemini. Answers can be wrong, and messages are sent through Google, so please don't share personal info :)</p>
        </div>
        <button class="chat-launcher" type="button" aria-expanded="false" aria-controls="chat-panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Questions?
        </button>`;
    document.body.append(root);

    const panel = root.querySelector(".chat-panel");
    const log = root.querySelector(".chat-log");
    const form = root.querySelector(".chat-form");
    const input = root.querySelector(".chat-input");
    const sendButton = root.querySelector(".chat-send");
    const launcher = root.querySelector(".chat-launcher");

    const history = []; // [{role: "user" | "assistant", text}], the shape the Worker expects
    let busy = false;

    addMessage("bot", "Heya! Ask me anything about Mateo's experience, projects, or competitions.");
    const suggestions = document.createElement("div");
    suggestions.className = "chat-suggestions";
    for (const question of SUGGESTIONS) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = question;
        button.addEventListener("click", () => send(question));
        suggestions.append(button);
    }
    log.append(suggestions);

    function setOpen(open) {
        panel.hidden = !open;
        launcher.setAttribute("aria-expanded", String(open));
        // Skip autofocus on touch screens so the keyboard doesn't cover the panel.
        if (open && matchMedia("(pointer: fine)").matches) input.focus();
    }

    function close() {
        setOpen(false);
        launcher.focus();
    }

    launcher.addEventListener("click", () => setOpen(panel.hidden));
    root.querySelector(".chat-close").addEventListener("click", close);
    panel.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        send(input.value);
    });

    async function send(rawText) {
        const text = rawText.trim();
        if (!text || busy) return;

        suggestions.remove();
        input.value = "";
        addMessage("user", text);
        history.push({ role: "user", text });
        setBusy(true);
        const typing = addTyping();

        try {
            const response = await fetch(WORKER_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: history.slice(-MAX_TURNS) }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.reply) {
                history.push({ role: "assistant", text: data.reply });
                addMessage("bot", data.reply);
            } else {
                history.pop(); // keep unanswered questions out of later requests
                addMessage("error", data.error || "Something went wrong. Please try again.");
            }
        } catch {
            history.pop();
            addMessage("error", "Couldn't reach the chatbot. Please try again.");
        } finally {
            typing.remove();
            setBusy(false);
        }
    }

    function setBusy(value) {
        busy = value;
        sendButton.disabled = value;
    }

    // Builds the bubble from text nodes rather than innerHTML, so replies can't
    // inject markup, and turns any URLs into links.
    function addMessage(kind, text) {
        const bubble = document.createElement("div");
        bubble.className = `chat-msg chat-msg-${kind}`;
        let last = 0;
        for (const match of text.matchAll(URL_PATTERN)) {
            const url = match[0].replace(/[.,!?;:'"]+$/, "");
            bubble.append(text.slice(last, match.index));
            const link = document.createElement("a");
            link.href = url;
            link.textContent = url;
            link.target = "_blank";
            link.rel = "noopener";
            bubble.append(link);
            last = match.index + url.length;
        }
        bubble.append(text.slice(last));
        log.append(bubble);
        log.scrollTop = log.scrollHeight;
    }

    function addTyping() {
        const typing = document.createElement("div");
        typing.className = "chat-msg chat-msg-bot chat-typing";
        typing.innerHTML = "<span></span><span></span><span></span>";
        log.append(typing);
        log.scrollTop = log.scrollHeight;
        return typing;
    }
})();
