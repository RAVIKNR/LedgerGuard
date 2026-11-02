const tls = require('tls');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = require('./src/app');
const connectDB = require('./src/config/db');

const port = Number(process.env.PORT) || 3000;

function checkSmtpConnectivity() {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT) || 465;

    const socket = tls.connect({
        host,
        port,
        servername: host,
        timeout: 10000
    }, () => {
        console.log(`[smtp-diagnostic] TLS CONNECTION OK: ${host}:${port}`);
        socket.end();
    });

    socket.on('timeout', () => {
        console.error('[smtp-diagnostic] CONNECTION TIMEOUT');
        socket.destroy();
    });

    socket.on('error', (error) => {
        console.error('[smtp-diagnostic] CONNECTION FAILED:', error.code || error.message);
    });
}

async function startServer() {
    await connectDB();
    app.listen(port, () => {
        console.log(`LedgerGuard API listening on port ${port}`);
        if (process.env.SMTP_DIAGNOSTIC === 'true') {
    checkSmtpConnectivity();
}
    });
}

startServer().catch((error) => {
    console.error('Unable to start LedgerGuard API:', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/i.test(error.code)
            ? error.code
            : undefined
    });
    process.exitCode = 1;
});
