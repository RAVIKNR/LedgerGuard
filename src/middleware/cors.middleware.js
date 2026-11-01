const { getFrontendUrl } = require('../config/frontend-url');

function getAllowedOrigin(frontendUrl, nodeEnv) {
    return getFrontendUrl(frontendUrl, nodeEnv);
}

function createCorsMiddleware(frontendUrl, nodeEnv) {
    const allowedOrigin = getAllowedOrigin(frontendUrl, nodeEnv);

    return function corsMiddleware(req, res, next) {
        res.vary('Origin');
        const origin = req.get('Origin');

       if (origin && origin !== allowedOrigin) {
    console.error('[CORS] Origin mismatch:', {
        receivedOrigin: origin,
        allowedOrigin,
    });

    return res.status(403).json({ error: { message: 'Origin is not allowed' } });
}

        if (origin && allowedOrigin) {
            res.set('Access-Control-Allow-Origin', allowedOrigin);
            res.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, OPTIONS');
           res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cache-Control, Idempotency-Key, X-Request-Id');
        }

        if (req.method === 'OPTIONS' && origin && allowedOrigin) {
            return res.status(204).end();
        }

        next();
    };
}

module.exports = { createCorsMiddleware, getAllowedOrigin };
