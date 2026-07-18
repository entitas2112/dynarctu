/**
 * quiz-api.js
 * Thin client for the DYNARCTU backend API. All quiz logic that used to
 * live in the browser (question selection, option shuffling, and — most
 * importantly — answer grading) now happens server-side. The browser
 * never receives correct answers; it only finds out whether a submitted
 * answer was right, one question at a time, after submitting it.
 */

async function apiRequest(path, options = {}) {
    const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    let body = null;
    try {
        body = await response.json();
    } catch (e) {
        // no JSON body
    }
    if (!response.ok) {
        const message = (body && body.error) || `Request failed (${response.status})`;
        throw new Error(message);
    }
    return body;
}

/**
 * Starts a new quiz session on the server.
 * @returns {Promise<{sessionToken: string, durationSeconds: number, historyWasReset: boolean, questions: Array}>}
 */
export async function startQuiz(jenjang, mapel, jumlah, durasi) {
    return apiRequest('/api/quiz/start', {
        method: 'POST',
        body: JSON.stringify({ jenjang, mapel, jumlah, durasi }),
    });
}

/**
 * Submits an answer for grading. `answerPayload` shape depends on question type:
 *  - Pilihan Ganda:          { selected_index: number }
 *  - Pilihan Ganda Kompleks: { selected_indices: number[] }
 *  - Benar/Salah:            { answers: { "0": "Benar"|"Salah", ... } }
 */
export async function submitAnswer(sessionToken, questionIndex, answerPayload) {
    return apiRequest('/api/quiz/answer', {
        method: 'POST',
        body: JSON.stringify({ session_token: sessionToken, question_index: questionIndex, ...answerPayload }),
    });
}

export async function finishQuiz(sessionToken) {
    return apiRequest('/api/quiz/finish', {
        method: 'POST',
        body: JSON.stringify({ session_token: sessionToken }),
    });
}

export async function resetHistory() {
    return apiRequest('/api/quiz/history', { method: 'DELETE' });
}
