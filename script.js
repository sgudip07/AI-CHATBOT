let prompt = document.querySelector("#prompt");
let submitbtn = document.querySelector("#submit");
let chatContainer = document.querySelector(".chat-container");
let imagebtn = document.querySelector("#image");
let image = document.querySelector("#image img");
let imageinput = document.querySelector("#image input");

// Personalize greeting if profile exists
try {
    const raw = localStorage.getItem('bwu_user_profile');
    if (raw) {
        const profile = JSON.parse(raw);
        const hero = document.querySelector('.ai-chat-box.hero .ai-chat-area');
        if (hero && profile?.name) {
            hero.innerHTML = `<strong>Hi ${profile.name.split(' ')[0]} — How can I help you today?</strong>`;
        }
    }
} catch (e) { /* ignore */ }

const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
function getApiKey() {
    try {
        const k = localStorage.getItem('GEMINI_API_KEY');
        return (k && k.trim()) ? k.trim() : null;
    } catch (_) {
        return null;
    }
}

let user = {
    message: null,
    file: {
        mime_type: null,
        data: null
    }
};

let localData = [];
let derivedKeywordSet = new Set();
let derivedPhraseSet = new Set();
let indexedData = [];
let universityDB = null;
let courseIndex = [];
let infoIndex = [];

function normalize(str) {
    return (str || "").toLowerCase().trim();
}

function deriveKeywordsFromDataset(data) {
    derivedKeywordSet = new Set();
    derivedPhraseSet = new Set();
    indexedData = [];
    try {
        for (let item of data || []) {
            const tokensSet = new Set();
            const phrases = [];
            for (let q of (item.questions || [])) {
                const phrase = normalize(q);
                if (!phrase) continue;
                phrases.push(phrase);
                derivedPhraseSet.add(phrase);
                const tokens = phrase.split(/[^\p{L}\p{N}\.+]+/u).filter(Boolean);
                for (let tok of tokens) {
                    if (tok.length >= 2) {
                        const t = tok.toLowerCase();
                        tokensSet.add(t);
                        derivedKeywordSet.add(t);
                    }
                }
            }
            if ((phrases.length > 0 || tokensSet.size > 0) && item.answer) {
                indexedData.push({ answer: item.answer, phrases, tokens: tokensSet });
            }
        }
    } catch (e) {
        console.error("Keyword derivation failed:", e);
    }
}

const FALLBACK_KEYWORDS = [
    "admission", "exam", "marks", "fees", "hostel", "location", "contact", "email", "phone",
    "b.tech", "cse", "ai", "ml", "cyber", "mca", "gnm", "nursing", "hello", "hi", "thanks"
];

function containsRequiredKeyword(message) {
    const text = normalize(message);
    if (derivedPhraseSet.size > 0 || derivedKeywordSet.size > 0) {
        for (let phrase of derivedPhraseSet) {
            if (text.includes(phrase)) return true;
        }
        for (let kw of derivedKeywordSet) {
            if (text.includes(kw)) return true;
        }
        return false;
    }
    return FALLBACK_KEYWORDS.some(kw => text.includes(kw));
}

function matchKeywordAnswer(userMessage) {
    const text = normalize(userMessage);
    if (!text) return null;
    const userTokens = new Set(text.split(/[^\p{L}\p{N}\.+]+/u).filter(Boolean).map(t => t.toLowerCase()));
    if (userTokens.size === 0) return null;

    let best = { score: 0, answer: null };
    for (let item of indexedData) {
        let score = 0;
        for (let tok of item.tokens) {
            if (userTokens.has(tok)) score++;
        }
        if (score > best.score) {
            best = { score, answer: item.answer };
        }
    }
    return best.score > 0 ? best.answer : null;
}

// 🔍 New keyword search function: returns multiple matches
function keywordSearch(userMessage) {
    const text = normalize(userMessage);
    if (!text) return [];

    const userTokens = new Set(
        text.split(/[^\p{L}\p{N}\.+]+/u).filter(Boolean).map(t => t.toLowerCase())
    );
    if (userTokens.size === 0) return [];

    const GREETING_TOKENS = new Set(["hi","hello","hey","হ্যালো","হাই"]);
    let matches = [];

    for (let item of indexedData) {
        let score = 0;
        for (let tok of item.tokens) {
            if (userTokens.has(tok)) score++;
        }
        if (score > 0) {
            const isGreetingAnswer = /hello/i.test(item.answer || "");
            const userIsGreeting = Array.from(GREETING_TOKENS).some(t => userTokens.has(t));
            if (isGreetingAnswer && !userIsGreeting) {
                score -= 2;
            }
            if (score > 0) {
                matches.push({ answer: item.answer, score });
            }
        }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches;
}

function matchUniversityAnswer(userMessage) {
    if (!universityDB) return null;
    const text = normalize(userMessage);
    const userTokens = new Set(text.split(/[^\p{L}\p{N}\.+]+/u).filter(Boolean).map(t => t.toLowerCase()));
    if (userTokens.size === 0) return null;

    let bestInfo = null, bestInfoScore = 0;
    for (let info of infoIndex) {
        let s = 0; for (let t of info.tokens) if (userTokens.has(t)) s++;
        if (s > bestInfoScore) { bestInfoScore = s; bestInfo = info; }
    }
    if (bestInfo && bestInfoScore > 0) {
        return bestInfo.responder();
    }

    let bestCourse = null, bestCourseScore = 0;
    for (let c of courseIndex) {
        let s = 0; for (let t of c.tokens) if (userTokens.has(t)) s++;
        if (s > bestCourseScore) { bestCourseScore = s; bestCourse = c; }
    }
    if (bestCourse && bestCourseScore > 0) {
        const y = bestCourse.duration_years;
        const fees = bestCourse.total_fees_inr ? `₹${bestCourse.total_fees_inr.toLocaleString('en-IN')}` : "N/A";
        const elig = bestCourse.eligibility || "See link";
        const link = bestCourse.url ? `<a href="${bestCourse.url}" target="_blank">More</a>` : "";
        return `${bestCourse.name}: ${y} yrs • Fees: ${fees} • Eligibility: ${elig}. ${link}`;
    }
    return null;
}

// 🧮 Special handler: course count queries
function detectCourseCount(userMessage) {
    const text = normalize(userMessage);
    const patterns = [
        /how\s+many\s+course(s)?/i,
        /number\s+of\s+course(s)?/i,
        /total\s+course(s)?/i,
        /কত(?:গুলো|গুলি)?\s+কোর্স/i
    ];
    return patterns.some(r => r.test(text));
}

function getCourseCountAnswer() {
    const count = Array.isArray(courseIndex) ? courseIndex.length : 0;
    if (count > 0) {
        // Sum visible total fees if provided
        const totalFees = courseIndex.reduce((sum, c) => {
            const v = Number(c.total_fees_inr || 0);
            return sum + (isNaN(v) ? 0 : v);
        }, 0);
        const totalFeesStr = totalFees > 0 ? `Total listed fees: ₹${totalFees.toLocaleString('en-IN')}` : "";
        // Short note within ~10 words + link
        const link = `<a href="https://www.brainwareuniversity.ac.in/" target="_blank">here</a>`;
        return `Courses: ${count} — See details ${link}. ${totalFeesStr}`;
    }
    return "Course information is loading. Please try again in a moment.";
}

// 📚 Detect generic course details/list queries
function detectCourseDetailsQuery(userMessage) {
    const text = normalize(userMessage);
    const patterns = [
        /course\s+details?/i,
        /course\s+info/i,
        /details?\s+of\s+course/i,
        /course\s+list/i,
        /all\s+courses?/i,
        /programs?\s+list/i
    ];
    return patterns.some(r => r.test(text));
}

function listCoursesSummary() {
    if (!Array.isArray(courseIndex) || courseIndex.length === 0) {
        return "Course information is loading. Please try again in a moment.";
    }
    const items = courseIndex.map(c => {
        const y = c.duration_years ? `${c.duration_years} yrs` : "";
        const fees = c.total_fees_inr ? `₹${c.total_fees_inr.toLocaleString('en-IN')}` : "";
        const extras = [y, fees].filter(Boolean).join(" • ");
        const link = c.url ? `<a href="${c.url}" target="_blank">Details</a>` : "";
        return `<li>${c.name}${extras ? ` — ${extras}` : ""} ${link}</li>`;
    }).join("");
    return `<strong>Courses available:</strong><ul>${items}</ul>`;
}

fetch("brainware_dataset.json")
    .then(res => res.json())
    .then(data => {
        localData = data;
        deriveKeywordsFromDataset(localData);
    })
    .catch(err => console.error("Failed to load JSON:", err));

fetch("university_db.json")
    .then(res => res.json())
    .then(db => {
        universityDB = db;
        courseIndex = (db.courses || []).map(c => {
            const tokens = new Set([...(c.keywords || [])].map(k => normalize(k)));
            for (let t of normalize(c.name).split(/[^\p{L}\p{N}\.+]+/u).filter(Boolean)) tokens.add(t);
            return {
                code: c.code,
                name: c.name,
                url: c.url,
                duration_years: c.duration_years,
                eligibility: c.eligibility,
                annual_fees_inr: c.annual_fees_inr,
                total_fees_inr: c.total_fees_inr,
                tokens
            };
        });
        infoIndex = [];
        if (db.hostel) {
            infoIndex.push({ key: "hostel", tokens: new Set((db.hostel.keywords || []).map(normalize)), responder: () => `Hostel: ${db.hostel.notes}.` });
        }
        if (db.contact) {
            infoIndex.push({ key: "contact", tokens: new Set((db.contact.keywords || []).map(normalize)), responder: () => `Contact: ${db.contact.phone}, ${db.contact.email}` });
        }
        if (db.location) {
            infoIndex.push({ key: "location", tokens: new Set((db.location.keywords || []).map(normalize)), responder: () => `Location: ${db.location.address}. <a href="${db.location.maps_url}" target="_blank">Map</a>` });
        }
    })
    .catch(err => console.error("Failed to load university DB:", err));

function matchLocalAnswer(userMessage) {
    userMessage = userMessage.toLowerCase().trim();
    for (let item of localData) {
        for (let q of item.questions) {
            if (userMessage.includes(q.toLowerCase())) {
                return item.answer;
            }
        }
    }
    return null;
}

async function generateResponse(aiChatBox) {
    let text = aiChatBox.querySelector(".ai-chat-area");
    const apiKey = getApiKey();

    if (!apiKey) {
        text.innerHTML = "API key not set. Please set your Gemini API key. Example:<br><code>localStorage.setItem('GEMINI_API_KEY','YOUR_KEY_HERE')</code> and try again.";
        chatContainer.scroll({ top: chatContainer.scrollHeight, behavior: "smooth" });
        image.src = "image.svg";
        image.classList.remove("choose");
        user.file = {};
        return;
    }

    let RequestOption = {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            "contents": [
                {
                    "parts": [
                        { "text": user.message },
                        ...(user.file.data ? [{ "inline_data": user.file }] : [])
                    ]
                }
            ]
        })
    };

    try {
        let response = await fetch(`${API_BASE_URL}?key=${encodeURIComponent(apiKey)}`, RequestOption);
        if (response.status === 401 || response.status === 403) {
            text.innerHTML = "Invalid or unauthorized API key. Update your key and try again.";
            return;
        }
        let data = await response.json();

        if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
            let apiResponse = data.candidates[0].content.parts[0].text.replace(/\\(.?)\\*/g, "$1").trim();
            text.innerHTML = apiResponse;
        } else {
            text.innerHTML = "⚠️ Sorry, I couldn't get a valid response from the AI server.";
        }
    } catch (error) {
        console.error("API Error:", error);
        text.innerHTML = "⚠️ Gemini API is currently unavailable. Please try again later.";
    } finally {
        chatContainer.scroll({ top: chatContainer.scrollHeight, behavior: "smooth" });
        image.src = "image.svg";
        image.classList.remove("choose");
        user.file = {};
    }
}

function createChatBox(html, classes) {
    let div = document.createElement("div");
    div.innerHTML = html;
    div.classList.add(classes);
    return div;
}

// 💬 MAIN HANDLER
function handlechatResponse(userMessage) {
    user.message = userMessage;

    let html = `<img src="user-image.jpg" alt="" id="USER-IMAGE" width="8%"> <div class="user-chat-area"> ${user.message} ${user.file.data ? `<img src="data:${user.file.mime_type};base64,${user.file.data}" class="chooseimg" />` : ""} </div>`;
    prompt.value = "";
    let userChatBox = createChatBox(html, "user-chat-box");
    chatContainer.appendChild(userChatBox);

    chatContainer.scroll({ top: chatContainer.scrollHeight, behavior: "smooth" });

    setTimeout(() => {
        let html = `<img src="imageai.jpg" alt="" id="AI-IMAGE" width="10%"> <div class="ai-chat-area"> <video class="load" width="50px" autoplay muted loop>   <source src="loading.mp4" type="video/mp4">   Your browser does not support the video tag. </video> </div>`;
        let aiChatBox = createChatBox(html, "ai-chat-box");
        chatContainer.appendChild(aiChatBox);

        let localAnswer = matchLocalAnswer(userMessage);
        if (localAnswer) {
            aiChatBox.querySelector(".ai-chat-area").innerHTML = localAnswer;
            aiChatBox.querySelector(".ai-chat-area").style.animation = "messageIn .35s ease both";
            chatContainer.scroll({ top: chatContainer.scrollHeight, behavior: "smooth" });
            return;
        }

        // 📚 Generic course details/list request
        if (detectCourseDetailsQuery(userMessage)) {
            const htmlList = listCoursesSummary();
            aiChatBox.querySelector(".ai-chat-area").innerHTML = htmlList;
            aiChatBox.querySelector(".ai-chat-area").style.animation = "messageIn .35s ease both";
            chatContainer.scroll({ top: chatContainer.scrollHeight, behavior: "smooth" });
            return;
        }

        // 🧮 Course count query
        if (detectCourseCount(userMessage)) {
            const countAnswer = getCourseCountAnswer();
            aiChatBox.querySelector(".ai-chat-area").innerHTML = countAnswer;
            aiChatBox.querySelector(".ai-chat-area").style.animation = "messageIn .35s ease both";
            chatContainer.scroll({ top: chatContainer.scrollHeight, behavior: "smooth" });
            return;
        }

        const uniAnswer = matchUniversityAnswer(userMessage);
        if (uniAnswer) {
            aiChatBox.querySelector(".ai-chat-area").innerHTML = uniAnswer;
            aiChatBox.querySelector(".ai-chat-area").style.animation = "messageIn .35s ease both";
            chatContainer.scroll({ top: chatContainer.scrollHeight, behavior: "smooth" });
            return;
        }

        // Keyword search: pick the best single match (by highest score)
        const keywordMatches = keywordSearch(userMessage);
        if (keywordMatches.length > 0) {
            const best = keywordMatches[0];
            aiChatBox.querySelector(".ai-chat-area").innerHTML = best.answer;
            aiChatBox.querySelector(".ai-chat-area").style.animation = "messageIn .35s ease both";
            chatContainer.scroll({ top: chatContainer.scrollHeight, behavior: "smooth" });
            return;
        }

        // No local match → fall back to API
        generateResponse(aiChatBox);
    }, 600);
}

// 🔁 Event Listeners
prompt.addEventListener("keydown", (e) => {
    if (e.key == "Enter") {
        handlechatResponse(prompt.value);
    }
});

submitbtn.addEventListener("click", () => {
    handlechatResponse(prompt.value);
});

imageinput.addEventListener("change", () => {
    const file = imageinput.files[0];
    if (!file) return;
    let read = new FileReader();
    read.onload = (e) => {
        let base64string = e.target.result.split(",")[1];
        user.file = {
            mime_type: file.type,
            data: base64string
        };
        image.src = `data:${user.file.mime_type};base64,${user.file.data}`;
        image.classList.add("choose");
    };
    read.readAsDataURL(file);
});

imagebtn.addEventListener("click", () => {
    imagebtn.querySelector("input").click();
});
