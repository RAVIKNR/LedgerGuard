const { errorHandler, notFound } = require('../src/middleware/error.middleware');

describe('error middleware redaction', () => {
    afterEach(() => jest.restoreAllMocks());

    it('does not reflect query strings in not-found responses', () => {
        const marker = 'test-only-verification-token';
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };

        notFound({ method: 'GET', path: '/missing-route', originalUrl: `/missing-route?token=${marker}` }, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(JSON.stringify(res.json.mock.calls)).not.toContain(marker);
        expect(res.json).toHaveBeenCalledWith({ error: { message: 'Route not found: GET /missing-route' } });
    });

    it('does not log raw error details or expose them in internal-error responses', () => {
        const marker = 'test-only-private-diagnostic';
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = {
            headersSent: false,
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const req = {
            method: 'POST',
            path: '/api/action',
            requestId: 'request-1'
        };

        errorHandler(Object.assign(new Error(marker), { meta: { detail: marker } }), req, res, jest.fn());

        expect(log).toHaveBeenCalledWith('Request failed', expect.objectContaining({
            errorName: 'Error',
            path: '/api/action'
        }));
        expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: { message: 'Internal server error' } });
    });
});
