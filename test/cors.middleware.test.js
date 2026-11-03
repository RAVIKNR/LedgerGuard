const { createCorsMiddleware, getAllowedOrigin } = require('../src/middleware/cors.middleware');

function response() {
    return {
        vary: jest.fn(),
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        end: jest.fn()
    };
}

describe('CORS origin policy', () => {
    it('normalizes the configured URL to an HTTP(S) origin', () => {
        expect(getAllowedOrigin('https://ledgerguard.example.test')).toBe('https://ledgerguard.example.test');
        expect(() => getAllowedOrigin('javascript:alert(1)')).toThrow('FRONTEND_URL must be an HTTP(S) origin');
        expect(() => getAllowedOrigin('http://ledgerguard.example.test', 'production'))
            .toThrow('FRONTEND_URL must use HTTPS in production');
    });

    it('allows only the configured origin and supports authenticated preflight headers', () => {
        const res = response();
        const next = jest.fn();

        createCorsMiddleware('https://ledgerguard.example.test')({
            method: 'OPTIONS',
            get: jest.fn().mockReturnValue('https://ledgerguard.example.test')
        }, res, next);

        expect(res.vary).toHaveBeenCalledWith('Origin');
        expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://ledgerguard.example.test');
       expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cache-Control, Pragma, Idempotency-Key, X-Request-Id');
        expect(res.status).toHaveBeenCalledWith(204);
        expect(res.end).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects requests carrying an unconfigured origin', () => {
        const res = response();
        const next = jest.fn();

        createCorsMiddleware('https://ledgerguard.example.test')({
            method: 'POST',
            get: jest.fn().mockReturnValue('https://untrusted.example.test')
        }, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: { message: 'Origin is not allowed' } });
        expect(next).not.toHaveBeenCalled();
    });

    it('continues same-origin or server-to-server requests without an Origin header', () => {
        const res = response();
        const next = jest.fn();

        createCorsMiddleware('https://ledgerguard.example.test')({
            method: 'GET',
            get: jest.fn().mockReturnValue(undefined)
        }, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.set).not.toHaveBeenCalled();
    });
});
