const {
    DEFAULT_REVIEW_DURATION_HOURS,
    MAX_REVIEW_DURATION_HOURS,
    getReviewDurationHours
} = require('../src/config/review-policy');

describe('review policy configuration', () => {
    it('defaults to a 24-hour review period', () => {
        expect(getReviewDurationHours(undefined)).toBe(DEFAULT_REVIEW_DURATION_HOURS);
    });

    it.each(['0', '-1', 'Infinity', 'NaN', String(MAX_REVIEW_DURATION_HOURS + 1)])(
        'rejects invalid duration %s',
        value => expect(() => getReviewDurationHours(value)).toThrow('REVIEW_DURATION_HOURS')
    );

    it('accepts a finite bounded duration', () => {
        expect(getReviewDurationHours('48')).toBe(48);
    });
});
