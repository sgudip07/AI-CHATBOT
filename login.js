const form = document.getElementById('loginForm');
const nameInput = document.getElementById('name');
const emailInput = document.getElementById('email');
const codeInput = document.getElementById('studentCode');

const nameError = document.getElementById('nameError');
const emailError = document.getElementById('emailError');
const codeError = document.getElementById('codeError');

function showError(el, msg) {
    el.textContent = msg || '';
}

function validateName(name) {
    return name.trim().length >= 2;
}

function validateEmail(email) {
    // Allow typical emails; prioritize @brainwareuniversity.ac.in if present
    const basic = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email);
    return basic;
}

function validateCode(code) {
    // Required format: BWU/XXX/YY/NNN (e.g., BWU/BTA/24/251)
    const formatted = code.trim().toUpperCase();
    return /^BWU\/[A-Z]{3}\/\d{2}\/\d{3}$/.test(formatted);
}

form.addEventListener('submit', function(e) {
    e.preventDefault();

    const name = nameInput.value || '';
    const email = emailInput.value || '';
    const code = (codeInput.value || '').toUpperCase();

    let ok = true;
    if (!validateName(name)) { showError(nameError, 'Please enter your full name.'); ok = false; } else { showError(nameError, ''); }
    if (!validateEmail(email)) { showError(emailError, 'Enter a valid email address.'); ok = false; } else { showError(emailError, ''); }
    if (!validateCode(code)) { showError(codeError, 'Format: BWU/XXX/YY/NNN (e.g., BWU/BTA/24/251)'); ok = false; } else { showError(codeError, ''); }

    if (!ok) return;

    // Store locally on this device only
    const profile = { name: name.trim(), email: email.trim().toLowerCase(), studentCode: code.trim().toUpperCase(), ts: Date.now() };
    try {
        localStorage.setItem('bwu_user_profile', JSON.stringify(profile));
    } catch (err) {
        console.warn('Storage failed', err);
    }

    // Redirect to chat
    window.location.href = 'index.html';
});


