import { isChoiceType, isMcmaType, isTrueFalseType } from './question-types.js';

export class QuizView {
    constructor() {
        this.el = {
            landingPage: document.getElementById('landing-page'),
            quizWrapper: document.getElementById('quiz-wrapper'),
            quizScreen: document.getElementById('quiz-screen'),
            resultScreen: document.getElementById('result-screen'),
            progressText: document.getElementById('progress-text'),
            timer: document.getElementById('timer'),
            soalContainer: document.getElementById('soal-container'),
            explanation: document.getElementById('explanation'),
            btnCek: document.getElementById('btn-cek'),
            btnNext: document.getElementById('btn-next'),
            skorAkhir: document.getElementById('skor-akhir'),
            detailSkor: document.getElementById('detail-skor'),
        };
    }

    showQuiz() {
        this.el.landingPage.style.display = 'none';
        this.el.quizWrapper.style.display = 'flex';
        this.el.quizScreen.classList.remove('hidden');
        this.el.resultScreen.classList.add('hidden');
        window.scrollTo(0, 0);
    }

    updateTimer(text) {
        this.el.timer.innerText = text;
    }

    renderQuestion(question, index, total) {
        this.el.progressText.innerText = `Soal ${index + 1} / ${total}`;
        let html = `<div class="soal-teks">${question.question}</div>`;
        const options = question.options || [];

        if (isChoiceType(question.type)) {
            options.forEach((opt, j) => {
                html += `<label class="option-label" id="label-opt-${j}">
                            <input type="radio" name="answer" value="${j}">
                            <span>${opt.text}</span>
                         </label>`;
            });
        } else if (isMcmaType(question.type)) {
            html += `<div style="font-size: 0.9em; color: var(--secondary); margin-bottom: 12px; font-weight: 600;">*Jawaban benar lebih dari satu</div>`;
            options.forEach((opt, j) => {
                html += `<label class="option-label" id="label-opt-${j}">
                            <input type="checkbox" name="answer" value="${j}">
                            <span>${opt.text}</span>
                         </label>`;
            });
        } else if (isTrueFalseType(question.type)) {
            html += `<div style="font-size: 0.9em; color: var(--secondary); margin-bottom: 12px; font-weight: 600;">*Tentukan Benar atau Salah pada setiap pernyataan berikut!</div>`;
            html += `<table class="bs-table">
                        <thead>
                            <tr>
                                <th>Pernyataan</th>
                                <th style="width: 80px;">Benar</th>
                                <th style="width: 80px;">Salah</th>
                            </tr>
                        </thead>
                        <tbody>`;
            options.forEach((opt, j) => {
                html += `<tr id="row-opt-${j}">
                            <td>${opt.text}</td>
                            <td style="text-align:center;"><input type="radio" name="bs-${j}" value="Benar"></td>
                            <td style="text-align:center;"><input type="radio" name="bs-${j}" value="Salah"></td>
                         </tr>`;
            });
            html += `</tbody></table>`;
        }

        this.el.soalContainer.innerHTML = html;
        this.el.btnCek.classList.remove('hidden');
        this.el.btnNext.classList.add('hidden');
        this.el.explanation.style.display = 'none';

        this._typesetMath();
    }

    _typesetMath() {
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
            window.MathJax.typesetPromise();
        }
    }

    /**
     * Reads the user's selection from the DOM and builds the payload the
     * server expects for this question type. Returns null (and shows an
     * alert) if the question hasn't been fully answered yet.
     */
    collectAnswerPayload(question) {
        if (isChoiceType(question.type)) {
            const selected = document.querySelector('input[name="answer"]:checked');
            if (!selected) {
                alert('Mohon pilih jawaban terlebih dahulu!');
                return null;
            }
            return { selected_index: parseInt(selected.value, 10) };
        }

        if (isMcmaType(question.type)) {
            const checkboxes = document.querySelectorAll('input[type="checkbox"][name="answer"]');
            const selectedIndices = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.value, 10));
            if (selectedIndices.length === 0) {
                alert('Mohon pilih minimal satu jawaban!');
                return null;
            }
            return { selected_indices: selectedIndices };
        }

        if (isTrueFalseType(question.type)) {
            const options = question.options || [];
            const answers = {};
            for (let j = 0; j < options.length; j++) {
                const selected = document.querySelector(`input[name="bs-${j}"]:checked`);
                if (!selected) {
                    alert('Mohon tentukan Benar/Salah untuk semua pernyataan!');
                    return null;
                }
                answers[String(j)] = selected.value;
            }
            return { answers };
        }

        return null;
    }

    /** Locks the inputs for the current question once it's been submitted. */
    disableInputs(question) {
        if (isChoiceType(question.type)) {
            document.querySelectorAll('input[type="radio"][name="answer"]').forEach(el => el.disabled = true);
        } else if (isMcmaType(question.type)) {
            document.querySelectorAll('input[type="checkbox"][name="answer"]').forEach(el => el.disabled = true);
        } else if (isTrueFalseType(question.type)) {
            document.querySelectorAll('input[name^="bs-"]').forEach(el => el.disabled = true);
        }
    }

    /**
     * Renders the server's grading result. `result` is exactly what
     * POST /api/quiz/answer returned — the browser never computed this.
     */
    renderResult(question, result) {
        this.disableInputs(question);
        let userAnswerText = '';

        if (isChoiceType(question.type)) {
            const selected = document.querySelector('input[name="answer"][value]:checked, input[name="answer"][disabled]:checked');
            const ansIndex = selected ? parseInt(selected.value, 10) : -1;
            const options = question.options || [];
            if (result.isCorrect) {
                if (ansIndex >= 0) document.getElementById(`label-opt-${ansIndex}`).classList.add('correct');
            } else {
                if (ansIndex >= 0) document.getElementById(`label-opt-${ansIndex}`).classList.add('wrong');
                if (result.correctIndex >= 0) document.getElementById(`label-opt-${result.correctIndex}`).classList.add('correct');
            }
            const correctText = result.correctIndex >= 0 && options[result.correctIndex]
                ? options[result.correctIndex].text
                : result.correctText;
            userAnswerText = `<div style="margin-bottom:12px;">Kunci Jawaban: <b style="color:var(--primary);">${correctText}</b></div>`;
        } else if (isMcmaType(question.type)) {
            const options = question.options || [];
            const correctSet = new Set(result.correctIndices || []);
            let userKeysHtml = 'Kunci Jawaban: <ul style="margin-top:5px; margin-bottom:0; padding-left:20px;">';
            options.forEach((opt, j) => {
                const cb = document.querySelector(`input[name="answer"][value="${j}"]`);
                const isOptCorrect = correctSet.has(j);
                if (isOptCorrect) userKeysHtml += `<li style="color:var(--primary);"><b>${opt.text}</b></li>`;
                const checked = cb ? cb.checked : false;
                if (checked === isOptCorrect) {
                    if (checked) document.getElementById(`label-opt-${j}`).classList.add('correct');
                } else {
                    if (checked) document.getElementById(`label-opt-${j}`).classList.add('wrong');
                    if (isOptCorrect && !checked) document.getElementById(`label-opt-${j}`).classList.add('correct');
                }
            });
            userKeysHtml += '</ul>';
            userAnswerText = `<div style="margin-bottom:12px;">${userKeysHtml}</div>`;
        } else if (isTrueFalseType(question.type)) {
            const options = question.options || [];
            const correctAnswers = result.correctAnswers || {};
            let userKeysHtml = 'Kunci Jawaban: <ul style="margin-top:5px; margin-bottom:0; padding-left:20px; line-height:1.6;">';
            options.forEach((opt, j) => {
                const expected = correctAnswers[String(j)];
                const selected = document.querySelector(`input[name="bs-${j}"]:checked`);
                const selectedVal = selected ? selected.value : null;
                userKeysHtml += `<li style="color:var(--primary);">${opt.text}: <b>${expected}</b></li>`;
                const row = document.getElementById(`row-opt-${j}`);
                if (selectedVal === expected) {
                    row.classList.add('correct-row');
                } else {
                    row.classList.add('wrong-row');
                }
            });
            userKeysHtml += '</ul>';
            userAnswerText = `<div style="margin-bottom:12px;">${userKeysHtml}</div>`;
        }

        this._renderExplanation(result.isCorrect, userAnswerText, result.explanation);
    }

    _renderExplanation(isCorrect, userAnswerText, explanation) {
        const expBox = this.el.explanation;
        expBox.className = 'explanation-box ' + (isCorrect ? '' : 'salah');

        const statusTeks = isCorrect
            ? "<div style='color:var(--hijau); font-weight:700; font-size:1.15em; margin-bottom:10px;'>✓ Jawaban Kamu Tepat</div>"
            : "<div style='color:var(--merah-salah); font-weight:700; font-size:1.15em; margin-bottom:10px;'>✗ Jawaban Kamu Kurang Tepat</div>";

        expBox.innerHTML = `${statusTeks} ${userAnswerText} <div style="color:var(--text-muted); font-weight:600; margin-bottom:6px; margin-top:15px; font-size:0.9em; text-transform:uppercase; letter-spacing:1px;">Pembahasan</div> <div style="line-height:1.6; color:var(--primary);">${explanation}</div>`;
        expBox.style.display = 'block';

        this.el.btnCek.classList.add('hidden');
        this.el.btnNext.classList.remove('hidden');

        this._typesetMath();
    }

    setNextButtonAsFinish(isLastQuestion) {
        this.el.btnNext.innerText = isLastQuestion
            ? 'Selesaikan & Lihat Skor Akhir ➔'
            : 'Lanjutkan ➔';
    }

    showResult(correctCount, total, score) {
        this.el.quizScreen.classList.add('hidden');
        this.el.resultScreen.classList.remove('hidden');

        this.el.skorAkhir.innerText = `${score}`;
        this.el.detailSkor.innerText = `Anda berhasil menjawab benar ${correctCount} dari total ${total} pertanyaan.`;
    }
}
