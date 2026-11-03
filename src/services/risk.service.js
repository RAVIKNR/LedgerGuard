function classify(score) {
    if (score >= 60) return { level: 'HIGH', decision: 'REVIEW' };
    if (score >= 30) return { level: 'MEDIUM', decision: 'APPROVED' };
    return { level: 'LOW', decision: 'APPROVED' };
}

async function assessTransfer(tx, { senderAccountId, receiverAccountId, amountMinor, currency }) {
    const [history, velocity, failedAttempts, priorRecipient] = await Promise.all([
        tx.transfer.findMany({
            where: {
                senderAccountId,
                currency,
                status: 'COMPLETED'
            },
            select: { amountMinor: true }
        }),
        tx.transfer.count({
            where: {
                senderAccountId,
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }
        }),
        tx.transfer.count({
            where: {
                senderAccountId,
                status: { in: ['FAILED', 'REVERSED'] },
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }
        }),
        tx.transfer.count({
            where: {
                senderAccountId,
                receiverAccountId,
                status: 'COMPLETED'
            }
        })
    ]);

    const reasons = [];
    let score = 0;
    const amount = BigInt(amountMinor);
    const amounts = history.map((item) => BigInt(item.amountMinor));

    if (amounts.length > 0) {
        const average = amounts.reduce((total, value) => total + value, 0n) / BigInt(amounts.length);
        const maximum = amounts.reduce((largest, value) => value > largest ? value : largest, 0n);
        if (amount > maximum || amount > average * 3n) {
            score += 35;
            reasons.push('Amount is unusually large relative to the sender history');
        }
    } else if (amount >= 10000000n) {
        score += 35;
        reasons.push('Amount is large for an account with no completed transfer history');
    }

    if (velocity >= 10) {
        score += 25;
        reasons.push('Ten or more transfers were attempted in the last 24 hours');
    }

    if (failedAttempts >= 3) {
        score += 25;
        reasons.push('Three or more failed or reversed transfers occurred in the last 24 hours');
    }

    if (priorRecipient === 0) {
        score += 10;
        reasons.push('Recipient has not previously received a completed transfer from this sender');
    }

    if (reasons.length === 0) {
        reasons.push('No configured risk signals were detected');
    }

    return { score, ...classify(score), reasons };
}

module.exports = { assessTransfer, classify };
