function notFound(req, res) {
    res.status(404).json({
        error: {
            message: `Route not found: ${req.method} ${req.path}`
        }
    });
}

function errorHandler(error, req, res, next) {
    const statusCode = error.statusCode || 500;

    console.error('Request failed', {
        method: req.method,
        path: req.path,
        statusCode,
        requestId: req.requestId,
        errorName: error.name,
        prismaCode: error.code || null
    });


    const responseError = statusCode === 500
        ? { message: 'Internal server error' }
        : {
            ...(error.code ? { code: error.code } : {}),
            message: error.message,
            ...(error.details ? { details: error.details } : {})
        };
    res.status(statusCode).json({ error: responseError });
}

module.exports = { notFound, errorHandler };
