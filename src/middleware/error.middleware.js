function notFound(req, res) {
    res.status(404).json({
        error: {
            message: `Route not found: ${req.method} ${req.path}`
        }
    });
}

function errorHandler(error, req, res, next) {
    const statusCode = error.statusCode || 500;

    // Log the complete error for debugging in Render
    console.error('[UNHANDLED ERROR]', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code || null,
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl || req.path
    });

    // Structured request error log
    console.error('Request failed', {
        method: req.method,
        path: req.path,
        statusCode,
        requestId: req.requestId,
        errorName: error.name,
        errorMessage: error.message,
        prismaCode: error.code || null
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
