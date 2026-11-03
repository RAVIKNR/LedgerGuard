const DEFAULT_REVIEW_DURATION_HOURS = 24;
const MAX_REVIEW_DURATION_HOURS = 168;

function getReviewDurationHours(rawValue = process.env.REVIEW_DURATION_HOURS) {
    if (rawValue === undefined || rawValue === '') return DEFAULT_REVIEW_DURATION_HOURS;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_REVIEW_DURATION_HOURS) {
        throw new Error(`REVIEW_DURATION_HOURS must be a finite number greater than 0 and no greater than ${MAX_REVIEW_DURATION_HOURS}`);
    }
    return value;
}

module.exports = {
    DEFAULT_REVIEW_DURATION_HOURS,
    MAX_REVIEW_DURATION_HOURS,
    getReviewDurationHours
};
