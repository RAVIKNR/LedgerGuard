jest.mock('jsonwebtoken', () => ({ verify: jest.fn() }));

jest.mock('../src/config/db', () => {
    const state = {
        users: new Map(),
        accounts: new Map(),
        audit: []
    };
    const prisma = {
        user: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            updateMany: jest.fn()
        },
        account: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            updateMany: jest.fn()
        },
        transfer: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        riskAssessment: { update: jest.fn() },
        ledgerEntry: { createMany: jest.fn() },
        adminAuditLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
        adminDecision: { create: jest.fn() },
        securityNotification: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(async operation => typeof operation === 'function'
            ? operation(prisma)
            : Promise.all(operation)),
        __state: state
    };
    return { prisma };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { prisma } = require('../src/config/db');
const app = require('../src/app');

const adminId = '10000000-0000-4000-8000-000000000001';
const targetUserId = '20000000-0000-4000-8000-000000000002';
const accountId = '30000000-0000-4000-8000-000000000003';
const accountNumber = '1234567890123456';

function user(id, status = 'ACTIVE') {
    return {
        id,
        name: id === adminId ? 'Admin User' : 'Customer User',
        email: id === adminId ? 'admin@example.com' : 'customer@example.com',
        status,
        emailVerifiedAt: null,
        isAdmin: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z')
    };
}

describe('administrator operations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = 'test-admin-jwt-secret';
        process.env.ADMIN_USER_ID = adminId;
        prisma.__state.users.clear();
        prisma.__state.accounts.clear();
        prisma.__state.audit.length = 0;
        prisma.__state.users.set(adminId, user(adminId));
        prisma.__state.users.set(targetUserId, user(targetUserId));
        prisma.__state.accounts.set(accountId, {
            id: accountId,
            accountNumber,
            userId: targetUserId,
            currency: 'INR ',
            status: 'ACTIVE',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            updatedAt: new Date('2026-02-01T00:00:00.000Z'),
            user: { id: targetUserId, name: 'Customer User', email: 'customer@example.com', status: 'ACTIVE' }
            , ledgerEntries: []
        });
        jwt.verify.mockImplementation(token => ({
            sub: token === 'admin-token' ? adminId : targetUserId
        }));
        prisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(prisma.__state.users.get(where.id) || null));
        prisma.user.findMany.mockImplementation(({ where = {} }) => {
            let users = [...prisma.__state.users.values()];
            if (where.status) users = users.filter(item => item.status === where.status);
            if (typeof where.isAdmin === 'boolean') users = users.filter(item => item.isAdmin === where.isAdmin);
            if (where.emailVerifiedAt?.not === null) users = users.filter(item => item.emailVerifiedAt !== null);
            if (where.id?.not) users = users.filter(item => item.id !== where.id.not);
            if (where.OR) users = users.filter(item => where.OR.some(condition =>
                condition.isAdmin === true ? item.isAdmin === true :
                    condition.id ? item.id === condition.id :
                        Object.entries(condition).some(([key, filter]) =>
                            typeof filter?.contains === 'string' && String(item[key] || '').toLowerCase().includes(filter.contains.toLowerCase())
                        )
            ));
            return Promise.resolve(users);
        });
        prisma.user.count.mockImplementation(({ where = {} } = {}) => {
            let users = [...prisma.__state.users.values()];
            if (where.status) users = users.filter(item => item.status === where.status);
            if (where.OR) users = users.filter(item => where.OR.some(condition =>
                condition.isAdmin === true ? item.isAdmin === true : item.id === condition.id
            ));
            return Promise.resolve(users.length);
        });
        prisma.user.updateMany.mockImplementation(({ where, data }) => {
            const item = prisma.__state.users.get(where.id);
            if (!item || (where.status && item.status !== where.status) ||
                (typeof where.isAdmin === 'boolean' && item.isAdmin !== where.isAdmin)) return Promise.resolve({ count: 0 });
            Object.assign(item, data);
            return Promise.resolve({ count: 1 });
        });
        prisma.account.findUnique.mockImplementation(({ where }) => Promise.resolve(prisma.__state.accounts.get(where.id) || null));
        prisma.account.count.mockResolvedValue(0);
        prisma.account.updateMany.mockImplementation(({ where, data }) => {
            const item = prisma.__state.accounts.get(where.id);
            if (!item || item.status !== where.status) return Promise.resolve({ count: 0 });
            Object.assign(item, data);
            return Promise.resolve({ count: 1 });
        });
        prisma.$queryRaw.mockResolvedValue([]);
        prisma.adminAuditLog.create.mockImplementation(async ({ data }) => {
            const event = { ...data, id: `audit-${prisma.__state.audit.length + 1}`, createdAt: new Date() };
            prisma.__state.audit.push(event);
            return event;
        });
        prisma.securityNotification.create.mockResolvedValue({ id: 'security-notification-id' });
    });

    afterAll(() => {
        delete process.env.JWT_SECRET;
        delete process.env.ADMIN_USER_ID;
    });

    function admin() {
        return { Authorization: 'Bearer admin-token' };
    }

    it('protects management endpoints from unauthenticated and non-admin users', async () => {
        const unauthenticated = await request(app).get('/api/admin/users');
        const forbidden = await request(app).get('/api/admin/users').set('Authorization', 'Bearer customer-token');

        expect(unauthenticated.status).toBe(401);
        expect(forbidden.status).toBe(403);
        expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('rejects invalid transition to already-active and closed user states', async () => {
        const unchanged = await request(app).patch(`/api/admin/users/${targetUserId}/status`)
            .set(admin()).send({ status: 'ACTIVE', reason: 'review complete' });

        expect(unchanged.status).toBe(409);
        prisma.__state.users.set(targetUserId, user(targetUserId, 'CLOSED'));
        const closed = await request(app).patch(`/api/admin/users/${targetUserId}/status`)
            .set(admin()).send({ status: 'SUSPENDED', reason: 'review complete' });
        expect(closed.status).toBe(409);
        expect(prisma.__state.audit).toHaveLength(0);
    });

    it('rejects invalid account transitions and never reopens closed accounts', async () => {
        const alreadyActive = await request(app).patch(`/api/admin/accounts/${accountId}/status`)
            .set(admin()).send({ status: 'ACTIVE', reason: 'no change' });
        expect(alreadyActive.status).toBe(409);

        prisma.__state.accounts.get(accountId).status = 'CLOSED';
        const closed = await request(app).patch(`/api/admin/accounts/${accountId}/status`)
            .set(admin()).send({ status: 'ACTIVE', reason: 'attempted reopen' });
        expect(closed.status).toBe(409);
        expect(prisma.__state.audit).toHaveLength(0);
    });

    it('suspends and reactivates users with durable actor and reason audit entries', async () => {
        const suspended = await request(app).patch(`/api/admin/users/${targetUserId}/status`)
            .set(admin()).send({ status: 'SUSPENDED', reason: 'Compliance review' });
        expect(suspended.status).toBe(200);
        expect(suspended.body.user.status).toBe('SUSPENDED');

        const reactivated = await request(app).patch(`/api/admin/users/${targetUserId}/status`)
            .set(admin()).send({ status: 'ACTIVE', reason: 'Review completed' });
        expect(reactivated.status).toBe(200);
        expect(prisma.__state.audit).toEqual(expect.arrayContaining([
            expect.objectContaining({
                actorId: adminId,
                action: 'USER_SUSPENDED',
                targetType: 'USER',
                targetId: targetUserId,
                reason: 'Compliance review',
                metadata: { previousStatus: 'ACTIVE', status: 'SUSPENDED' }
            }),
            expect.objectContaining({ action: 'USER_REACTIVATED', reason: 'Review completed' })
        ]));
    });

    it('rejects self-suspension and requires a reason for status changes', async () => {
        const self = await request(app).patch(`/api/admin/users/${adminId}/status`)
            .set(admin()).send({ status: 'SUSPENDED', reason: 'self' });
        const missingReason = await request(app).patch(`/api/admin/accounts/${accountId}/status`)
            .set(admin()).send({ status: 'FROZEN' });

        expect(self.status).toBe(409);
        expect(missingReason.status).toBe(400);
        expect(prisma.__state.audit).toHaveLength(0);
    });

    it('lists administrators and eligible verified active users without exposing extra fields', async () => {
        const target = prisma.__state.users.get(targetUserId);
        target.emailVerifiedAt = new Date('2026-01-02T00:00:00.000Z');
        prisma.__state.users.set(adminId, { ...prisma.__state.users.get(adminId), isAdmin: true });
        const administrators = await request(app).get('/api/admin/administrators').set(admin());
        const eligible = await request(app).get('/api/admin/eligible-admin-users').set(admin());

        expect(administrators.status).toBe(200);
        expect(administrators.body.administrators).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: adminId, isAdmin: true, bootstrapAdmin: true })
        ]));
        expect(eligible.status).toBe(200);
        expect(eligible.body.users).toEqual([
            expect.objectContaining({ id: targetUserId, emailVerifiedAt: target.emailVerifiedAt.toISOString() })
        ]);
        expect(eligible.body.users[0]).not.toHaveProperty('passwordHash');
    });

    it('promotes an eligible user with a durable actor, reason, and outcome audit record', async () => {
        prisma.__state.users.get(targetUserId).emailVerifiedAt = new Date('2026-01-02T00:00:00.000Z');
        const response = await request(app).patch(`/api/admin/users/${targetUserId}/admin-role`)
            .set(admin()).send({ action: 'PROMOTE', reason: 'Approved administrator onboarding' });

        expect(response.status).toBe(200);
        expect(response.body.user.isAdmin).toBe(true);
        expect(prisma.__state.audit).toEqual([
            expect.objectContaining({
                actorId: adminId,
                action: 'ADMIN_PROMOTED',
                targetType: 'USER',
                targetId: targetUserId,
                reason: 'Approved administrator onboarding',
                metadata: expect.objectContaining({ outcome: 'SUCCESS', previousIsAdmin: false, isAdmin: true })
            })
        ]);
    });

    it('demotes a secondary administrator and revokes access on the next request', async () => {
        prisma.__state.users.get(targetUserId).isAdmin = true;
        const response = await request(app).patch(`/api/admin/users/${targetUserId}/admin-role`)
            .set(admin()).send({ action: 'DEMOTE', reason: 'Role no longer required' });
        const denied = await request(app).get('/api/admin/overview')
            .set({ Authorization: 'Bearer secondary-token' });

        expect(response.status).toBe(200);
        expect(response.body.user.isAdmin).toBe(false);
        expect(denied.status).toBe(403);
        expect(prisma.__state.audit).toEqual([
            expect.objectContaining({
                actorId: adminId,
                action: 'ADMIN_DEMOTED',
                targetId: targetUserId,
                reason: 'Role no longer required',
                metadata: expect.objectContaining({ outcome: 'SUCCESS', previousIsAdmin: true, isAdmin: false })
            })
        ]);
    });

    it('prevents self-demotion, demotion of the bootstrap administrator, and removal of the last active admin', async () => {
        prisma.__state.users.get(targetUserId).isAdmin = true;
        const self = await request(app).patch(`/api/admin/users/${adminId}/admin-role`)
            .set(admin()).send({ action: 'DEMOTE', reason: 'test' });

        jwt.verify.mockImplementation(token => ({ sub: token === 'secondary-token' ? targetUserId : adminId }));
        prisma.__state.users.get(targetUserId).isAdmin = true;
        const bootstrap = await request(app).patch(`/api/admin/users/${adminId}/admin-role`)
            .set({ Authorization: 'Bearer secondary-token' }).send({ action: 'DEMOTE', reason: 'test' });

        prisma.user.count.mockResolvedValueOnce(1);
        const lastAdmin = await request(app).patch(`/api/admin/users/${targetUserId}/admin-role`)
            .set(admin()).send({ action: 'DEMOTE', reason: 'test' });

        expect(self.status).toBe(409);
        expect(bootstrap.status).toBe(409);
        expect(lastAdmin.status).toBe(409);
        expect(prisma.__state.audit).toHaveLength(0);
    });

    it('freezes and unfreezes accounts without changing ledger data and audits the transitions', async () => {
        const frozen = await request(app).patch(`/api/admin/accounts/${accountId}/status`)
            .set(admin()).send({ status: 'FROZEN', reason: 'Fraud review' });

        expect(frozen.status).toBe(200);
        expect(frozen.body.account.status).toBe('FROZEN');
        expect(prisma.$queryRaw).toHaveBeenCalled();
        expect(prisma.securityNotification.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                userId: targetUserId,
                accountId,
                eventType: 'ACCOUNT_FROZEN',
                resultingStatus: 'FROZEN'
            })
        }));

        const unfrozen = await request(app).patch(`/api/admin/accounts/${accountId}/status`)
            .set(admin()).send({ status: 'ACTIVE', reason: 'Review cleared' });
        expect(unfrozen.status).toBe(200);
        expect(unfrozen.body.account.status).toBe('ACTIVE');
        expect(prisma.__state.audit.map(event => event.action)).toEqual(['ACCOUNT_FROZEN', 'ACCOUNT_UNFROZEN']);
        expect(prisma.securityNotification.create).toHaveBeenCalledTimes(2);
    });

    it('validates pagination limits and accepts transaction filters with date ranges', async () => {
        const invalidPage = await request(app).get('/api/admin/accounts?pageSize=101').set(admin());
        expect(invalidPage.status).toBe(400);

        prisma.transfer.findMany.mockResolvedValue([]);
        prisma.transfer.count.mockResolvedValue(0);
        const filtered = await request(app).get('/api/admin/transfers')
            .query({
                page: 2,
                pageSize: 15,
                status: 'REVIEW',
                accountId,
                riskLevel: 'HIGH',
                riskDecision: 'REVIEW',
                from: '2026-01-01',
                to: '2026-01-31'
            })
            .set(admin());

        expect(filtered.status).toBe(200);
        expect(filtered.body.pagination).toEqual({ page: 2, pageSize: 15, total: 0, totalPages: 0 });
        expect(prisma.transfer.findMany).toHaveBeenCalledWith(expect.objectContaining({
            skip: 15,
            take: 15,
            where: expect.objectContaining({
                status: 'REVIEW',
                OR: [{ senderAccountId: accountId }, { receiverAccountId: accountId }]
            })
        }));

        prisma.transfer.findMany.mockResolvedValue([{
            id: '40000000-0000-4000-8000-000000000004',
            senderAccountId: accountId,
            receiverAccountId: '30000000-0000-4000-8000-000000000004',
            senderAccount: { accountNumber },
            receiverAccount: { accountNumber: '6543210987654321' },
            amountMinor: 1250n,
            currency: 'INR ',
            status: 'COMPLETED',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            riskAssessment: null
        }]);
        const transfers = await request(app).get('/api/admin/transfers').set(admin());
        expect(transfers.status).toBe(200);
        expect(transfers.body.transfers[0]).toMatchObject({
            senderAccountNumber: accountNumber,
            receiverAccountNumber: '6543210987654321'
        });
    });

    it('returns paginated user and account lists and exposes audit records only to admins', async () => {
        prisma.user.findMany.mockResolvedValue([user(targetUserId)]);
        prisma.user.count.mockResolvedValue(1);
        const users = await request(app).get('/api/admin/users?page=1&pageSize=10&search=customer')
            .set(admin());
        expect(users.status).toBe(200);
        expect(users.body.users).toHaveLength(1);
        expect(users.body.pagination).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });

        prisma.account.findMany.mockResolvedValue([prisma.__state.accounts.get(accountId)]);
        prisma.account.count.mockResolvedValue(1);
        const accounts = await request(app).get('/api/admin/accounts').set(admin());
        expect(accounts.status).toBe(200);
        expect(accounts.body.accounts[0].currency).toBe('INR');
        expect(accounts.body.accounts[0].accountNumber).toBe(accountNumber);

        prisma.adminAuditLog.findMany.mockResolvedValue([{
            id: 'audit-1',
            actorId: adminId,
            actor: { id: adminId, name: 'Admin User', email: 'admin@example.com' },
            action: 'USER_SUSPENDED',
            targetType: 'USER',
            targetId: targetUserId,
            reason: 'Compliance review',
            metadata: { previousStatus: 'ACTIVE', status: 'SUSPENDED' },
            createdAt: new Date('2026-03-01T00:00:00.000Z')
        }]);
        prisma.adminAuditLog.count.mockResolvedValue(1);
        const audit = await request(app).get('/api/admin/audit').set(admin());
        expect(audit.status).toBe(200);
        expect(audit.body.events[0]).toMatchObject({
            actor: { id: adminId },
            action: 'USER_SUSPENDED',
            reason: 'Compliance review'
        });

    });

    it('searches eligible recipients by holder name and exact account number', async () => {
            prisma.account.findMany.mockResolvedValue([{
                id: accountId,
                accountNumber,
                user: { name: 'Customer User' }
            }]);
            prisma.account.count.mockResolvedValue(1);

            const byName = await request(app).get('/api/admin/accounts/recipients')
                .query({ page: 1, pageSize: 50, search: 'Customer' }).set(admin());

            expect(byName.status).toBe(200);
            expect(byName.body).toEqual({
                accounts: [{ accountId, accountNumber, holderName: 'Customer User' }],
                pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 }
            });
            expect(prisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    currency: 'INR',
                    status: 'ACTIVE',
                    OR: [{ user: { is: { name: { contains: 'Customer', mode: 'insensitive' } } } }]
                })
            }));

            const byAccountNumber = await request(app).get('/api/admin/accounts/recipients')
                .query({ search: accountNumber }).set(admin());
            expect(byAccountNumber.status).toBe(200);
            expect(prisma.account.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
                where: expect.objectContaining({ OR: [{ accountNumber }, expect.anything()] })
            }));
        });

    it('returns empty recipient results and validates recipient pagination', async () => {
            prisma.account.findMany.mockResolvedValue([]);
            prisma.account.count.mockResolvedValue(0);

            const empty = await request(app).get('/api/admin/accounts/recipients')
                .query({ search: 'no-match' }).set(admin());
            expect(empty.status).toBe(200);
            expect(empty.body.accounts).toEqual([]);
            expect(empty.body.pagination.total).toBe(0);

            const invalid = await request(app).get('/api/admin/accounts/recipients')
                .query({ page: 0, pageSize: 51 }).set(admin());
            expect(invalid.status).toBe(400);
            expect(prisma.account.findMany).toHaveBeenCalledTimes(1);
        });

    it('protects recipient search from unauthenticated and non-admin users', async () => {
            const unauthenticated = await request(app).get('/api/admin/accounts/recipients');
            const forbidden = await request(app).get('/api/admin/accounts/recipients').set('Authorization', 'Bearer customer-token');
            expect(unauthenticated.status).toBe(401);
            expect(forbidden.status).toBe(403);
        });

    it('audits an existing transfer review decision without direct balance mutation', async () => {
        const transferId = '40000000-0000-4000-8000-000000000004';
        prisma.transfer.findUnique.mockResolvedValue({
            id: transferId,
            status: 'REVIEW',
            senderAccountId: accountId,
            receiverAccountId: '50000000-0000-4000-8000-000000000005',
            amountMinor: 12345n,
            currency: 'INR ',
            riskAssessment: { transferId }
        });
        prisma.transfer.update.mockResolvedValue({ id: transferId });
        prisma.riskAssessment.update.mockResolvedValue({});
        prisma.adminDecision.create.mockResolvedValue({
            transferId,
            decision: 'DECLINE',
            createdAt: new Date('2026-03-01T00:00:00.000Z')
        });

        const response = await request(app).post(`/api/admin/transfers/${transferId}/decision`)
            .set(admin()).send({ decision: 'DECLINE', notes: 'Manual review failed' });

        expect(response.status).toBe(200);
        expect(prisma.transfer.update).toHaveBeenCalledWith({
            where: { id: transferId },
            data: { status: 'FAILED', failureReason: 'Manual review failed' }
        });
        expect(prisma.ledgerEntry.createMany).not.toHaveBeenCalled();
        expect(prisma.__state.audit).toEqual([
            expect.objectContaining({
                actorId: adminId,
                action: 'TRANSFER_DECLINE',
                targetType: 'TRANSFER',
                targetId: transferId,
                reason: 'Manual review failed'
            })
        ]);
    });
});
