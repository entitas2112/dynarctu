/**
 * question-types.js
 * Pure rendering helpers — classifies a question's `type` string so the
 * view knows whether to render radio buttons, checkboxes, or a
 * Benar/Salah table. Carries no answer data whatsoever; grading is done
 * entirely server-side (see quiz-api.js).
 */
export function isChoiceType(type) {
    if (!type) return false;
    const normalized = String(type).replace(/\s+/g, '').toLowerCase();
    return normalized === 'pilihanganda' || normalized === 'multiplechoice';
}

export function isMcmaType(type) {
    if (!type) return false;
    const normalized = String(type).replace(/\s+/g, '').toLowerCase();
    return normalized === 'pilihangandakompleks' || normalized === 'mcma';
}

export function isTrueFalseType(type) {
    if (!type) return false;
    const normalized = String(type).replace(/\s+/g, '').toLowerCase();
    return normalized === 'benarsalah' || normalized === 'truefalse';
}
