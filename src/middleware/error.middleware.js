function notFound(req, res) {
    res.status(404).json({
        error: {
            message: `Route not found: ${req.method} ${req.path}`
        }
    });
}

function errorHandler(error, req, res, next) {
    const statusCode = error.statusCode || 500;

    const safeCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
        ? error.code
        : null;
    console.error('Request failed', {
        method: req.method,
        path: req.path,
        statusCode,
        requestId: req.requestId,
        errorName: typeof error.name === 'string' ? error.name : 'Error',
        prismaCode: safeCode
    });

    // Keep internal error details hidden from API clients
    const responseError = statusCode === 500
        ? {
            message: 'Internal server error'
        }
        : {
            ...(error.code ? { code: error.code } : {}),
            message: error.message,
            ...(error.details ? { details: error.details } : {})
        };

    if (res.headersSent) {
        return next(error);
    }

    return res.status(statusCode).json({
        error: responseError
    });
}

module.exports = { notFound, errorHandler };
