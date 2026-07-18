/**
 * app.js
 * Application entry point. Wires together the API client, timer, and
 * quiz view, and hooks up all UI event listeners. Question selection and
 * answer grading both happen server-side (see quiz-api.js) — this file
 * only drives the UI.
 */
import { startQuiz as apiStartQuiz, submitAnswer, finishQuiz as apiFinishQuiz, resetHistory as apiResetHistory } from './quiz-api.js';
import { CountdownTimer } from './timer.js';
import { QuizView } from './quiz-view.js';

const view = new QuizView();

/** Current quiz session state. Note: no answers are ever stored here. */
const session = {
    sessionToken: null,
    questions: [],
    currentIndex: 0,
    timer: null,
    answeredCurrent: false,
};

let startInFlight = false;

async function startQuiz(jenjang) {
    if (startInFlight) return;
    startInFlight = true;

    const startButton = document.querySelector(`[data-start-jenjang="${jenjang}"]`);
    if (startButton) startButton.disabled = true;

    const mapel = document.getElementById(`mapel-${jenjang}`).value;
    const jumlah = parseInt(document.getElementById(`jumlah-${jenjang}`).value, 10);
    const durasiMenit = parseInt(document.getElementById(`durasi-${jenjang}`).value, 10);

    try {
        const data = await apiStartQuiz(jenjang, mapel, jumlah, durasiMenit);

        if (data.historyWasReset) {
            alert('Stok soal baru telah habis! Riwayat direset otomatis untuk mengulang soal yang pernah dikerjakan.');
        }

        if (!data.questions || data.questions.length === 0) {
            alert('Bank soal untuk pilihan ini masih kosong. Coba mata pelajaran lain.');
            return;
        }

        session.sessionToken = data.sessionToken;
        session.questions = data.questions;
        session.currentIndex = 0;
        session.answeredCurrent = false;

        view.showQuiz();
        renderCurrentQuestion();

        session.timer = new CountdownTimer(
            data.durationSeconds,
            (secondsLeft) => view.updateTimer(CountdownTimer.formatMMSS(secondsLeft)),
            () => {
                alert('Batas waktu telah habis!');
                finishQuiz();
            }
        );
        session.timer.start();
    } catch (e) {
        alert('Gagal memuat sistem! Silakan coba lagi sebentar lagi.');
        console.error(e);
    } finally {
        startInFlight = false;
        if (startButton) startButton.disabled = false;
    }
}

function renderCurrentQuestion() {
    session.answeredCurrent = false;
    const question = session.questions[session.currentIndex];
    view.renderQuestion(question, session.currentIndex, session.questions.length);
}

async function checkCurrentAnswer() {
    if (session.answeredCurrent) return;
    const question = session.questions[session.currentIndex];
    const payload = view.collectAnswerPayload(question);
    if (!payload) return; // view already alerted the user

    try {
        const result = await submitAnswer(session.sessionToken, session.currentIndex, payload);
        session.answeredCurrent = true;
        view.renderResult(question, result);

        const isLastQuestion = session.currentIndex === session.questions.length - 1;
        view.setNextButtonAsFinish(isLastQuestion);
    } catch (e) {
        alert('Gagal mengirim jawaban. Periksa koneksi Anda dan coba lagi.');
        console.error(e);
    }
}

function goToNextQuestion() {
    session.currentIndex++;
    if (session.currentIndex >= session.questions.length) {
        finishQuiz();
    } else {
        renderCurrentQuestion();
    }
}

async function finishQuiz() {
    if (session.timer) session.timer.stop();
    try {
        const result = await apiFinishQuiz(session.sessionToken);
        view.showResult(result.correctCount, result.total, result.score);
    } catch (e) {
        console.error(e);
        alert('Gagal menyelesaikan evaluasi. Silakan kembali ke beranda dan coba lagi.');
    }
}

async function resetHistory() {
    if (confirm('Apakah Anda yakin ingin mereset basis data riwayat? Soal yang sudah pernah dikerjakan akan bisa muncul kembali.')) {
        try {
            await apiResetHistory();
            alert('Basis data riwayat berhasil direset!');
        } catch (e) {
            console.error(e);
            alert('Gagal mereset riwayat. Silakan coba lagi.');
        }
    }
}

function wireUpEventListeners() {
    document.querySelectorAll('[data-start-jenjang]').forEach(btn => {
        btn.addEventListener('click', () => startQuiz(btn.dataset.startJenjang));
        // Only enable once its click handler is actually attached, so a tap
        // on a slow connection can never land on a button with no listener.
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        btn.textContent = 'Mulai Evaluasi';
    });

    document.getElementById('btn-cek').addEventListener('click', checkCurrentAnswer);
    document.getElementById('btn-next').addEventListener('click', goToNextQuestion);
    document.getElementById('btn-reset-riwayat').addEventListener('click', resetHistory);
    document.getElementById('btn-kembali-beranda').addEventListener('click', () => location.reload());
}

document.addEventListener('DOMContentLoaded', wireUpEventListeners);


document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('dark-mode-toggle');
    const navLogo = document.getElementById('nav-logo');
    const footerLogo = document.getElementById('footer-logo');

    // Konfigurasi File Logo
    const logoLightNav = 'logo6.png';
    const logoLightFooter = 'logo6.png';
    const logoDark = 'logo7.png'; // File logo putih polos

    // Fungsi mengubah logo saat tema berganti
    const updateLogo = (isDark) => {
        if (navLogo) navLogo.src = isDark ? logoDark : logoLightNav;
        if (footerLogo) footerLogo.src = isDark ? logoDark : logoLightFooter;
    };

    // 1. Cek riwayat tema di localStorage (UI preference only — no quiz data).
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
        toggleBtn.textContent = '☀️';
        updateLogo(true);
    }

    // 2. Aksi saat tombol diklik
    toggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');

        if (isDark) {
            localStorage.setItem('theme', 'dark');
            toggleBtn.textContent = '☀️';
            updateLogo(true);
        } else {
            localStorage.setItem('theme', 'light');
            toggleBtn.textContent = '🌙';
            updateLogo(false);
        }
    });
});
