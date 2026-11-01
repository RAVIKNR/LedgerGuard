const jwt = require('jsonwebtoken');
const { prisma } = require('../config/db');

const authenticatedUserSelect = {
    id: true,
    name: true,
    email: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    phone: true,
    addressLine: true,
    city: true,
    region: true,
    postalCode: true,
    country: true,
    isAdmin: true,
    authVersion: true
};

function getToken(req) {
    const authorization = req.get('authorization');

    if (authorization && authorization.startsWith('Bearer ')) {
        return authorization.slice(7);
    }

    return req.cookies.token;
}

async function authenticate(req, res, next) {
    const token = getToken(req);

    if (!token) {
        return res.status(401).json({ error: { message: 'Authentication required' } });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({ error: { message: 'Invalid or expired token' } });
    }

    let user;
    try {
        user = await prisma.user.findUnique({
            where: { id: decoded.sub },
            select: authenticatedUserSelect
        });
    } catch (error) {
        return next(error);
    }

    if (!user || user.status !== 'ACTIVE' || (decoded.authVersion !== undefined && decoded.authVersion !== user.authVersion)) {
        return res.status(401).json({ error: { message: 'User is not active' } });
    }

    req.user = user;
    next();
}

module.exports = {
    authenticate,
    Accountmiddleware: authenticate,
    systemUserMiddleware: authenticate
};
