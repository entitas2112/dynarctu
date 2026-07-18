/**
 * timer.js
 * A tiny countdown timer used for the quiz time limit.
 */
export class CountdownTimer {
    /**
     * @param {number} totalSeconds
     * @param {(secondsLeft: number) => void} onTick
     * @param {() => void} onExpire
     */
    constructor(totalSeconds, onTick, onExpire) {
        this.secondsLeft = totalSeconds;
        this.onTick = onTick;
        this.onExpire = onExpire;
        this._intervalId = null;
    }

    start() {
        this.stop();
        this.onTick(this.secondsLeft);
        this._intervalId = setInterval(() => {
            this.secondsLeft--;
            this.onTick(this.secondsLeft);
            if (this.secondsLeft <= 0) {
                this.stop();
                this.onExpire();
            }
        }, 1000);
    }

    stop() {
        if (this._intervalId !== null) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    static formatMMSS(totalSeconds) {
        const safe = Math.max(0, totalSeconds);
        const m = Math.floor(safe / 60).toString().padStart(2, '0');
        const s = (safe % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }
}
