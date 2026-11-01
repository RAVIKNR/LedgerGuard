jest.mock('jsonwebtoken', () => ({
    verify: jest.fn()
}));

jest.mock('../src/config/db', () => ({
    prisma: {
        user: {
            findUnique: jest.fn()
        }
    }
}));

const jwt = require('jsonwebtoken');
const { prisma } = require('../src/config/db');
const { authenticate } = require('../src/middleware/account.middleware');

describe('authentication middleware error handling', () => {
    let req;
    let res;
    let next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            get: jest.fn().mockReturnValue('Bearer test-token'),
            cookies: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
    });

    it('returns 401 for an invalid or expired JWT', async () => {
        jwt.verify.mockImplementation(() => {
            throw new Error('invalid token');
        });

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('forwards user database errors instead of misreporting them as invalid sessions', async () => {
        const databaseError = Object.assign(new Error('column does not exist'), { code: 'P2022' });
        jwt.verify.mockReturnValue({ sub: 'user-id' });
        prisma.user.findUnique.mockRejectedValue(databaseError);

        await authenticate(req, res, next);

        expect(next).toHaveBeenCalledWith(databaseError);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('selects only the banking profile fields from the authenticated user', async () => {
        jwt.verify.mockReturnValue({ sub: 'user-id' });
        prisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            status: 'ACTIVE'
        });

        await authenticate(req, res, next);

        const query = prisma.user.findUnique.mock.calls[0][0];
        expect(query.select).toEqual(expect.objectContaining({ email: true, phone: true }));
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a JWT issued before the user password was changed', async () => {
        jwt.verify.mockReturnValue({ sub: 'user-id', authVersion: 1 });
        prisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            status: 'ACTIVE',
            authVersion: 2
        });

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});
