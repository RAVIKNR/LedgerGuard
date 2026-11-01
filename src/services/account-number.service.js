const crypto = require('crypto');

function generateAccountNumber() {
    const digits = [];
    while (digits.length < 16) {
        const bytes = crypto.randomBytes(16 - digits.length);
        for (const byte of bytes) {
            if (byte >= 250) continue;
            digits.push(String(byte % 10));
            if (digits.length === 16) break;
        }
    }
    return digits.join('');
}

async function createAccountWithNumber(client, data, options = {}) {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await client.account.create({
                data: { ...data, accountNumber: generateAccountNumber() },
                ...options
            });
        } catch (error) {
            lastError = error;
            const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
            if (error.code !== 'P2002' || !target.includes('account_number')) throw error;
        }
    }
    throw lastError;
}

module.exports = { generateAccountNumber, createAccountWithNumber };
