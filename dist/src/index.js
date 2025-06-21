"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const body_parser_1 = __importDefault(require("body-parser"));
const tenantRoutes_1 = __importDefault(require("./routes/tenantRoutes"));
const managerRoutes_1 = __importDefault(require("./routes/managerRoutes"));
const propertyRoutes_1 = __importDefault(require("./routes/propertyRoutes"));
const leaseRoutes_1 = __importDefault(require("./routes/leaseRoutes"));
const applicationRoutes_1 = __importDefault(require("./routes/applicationRoutes"));
const paymentRoutes_1 = __importDefault(require("./routes/paymentRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const authMiddleware_1 = require("./middleware/authMiddleware");
// Create Express app
const app = (0, express_1.default)();
// Environment & Configuration
const PORT = process.env.PORT ? Number(process.env.PORT) : 3002;
const ALLOWED_ORIGINS = [
    'https://mileshomerealestate.com',
    'https://app.mileshomerealestate.com',
    "https://app-milehomerealestate-com.onrender.com",
    'http://localhost:3000', // for local development
];
// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
// Secure HTTP headers
app.use((0, helmet_1.default)());
app.use(helmet_1.default.crossOriginResourcePolicy({ policy: 'cross-origin' }));
// Define your CORS options once
const corsOptions = {
    origin: (origin, callback) => {
        // allow requests with no origin (e.g. mobile apps, curl, Postman)
        if (!origin)
            return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error(`CORS policy: Origin ${origin} not allowed`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};
// Apply CORS to all routes
app.use((0, cors_1.default)(corsOptions));
// Ensure preflight `OPTIONS` is handled by CORS before any other middleware
app.options('*', (0, cors_1.default)(corsOptions));
// Body parsers
app.use(express_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: false }));
// HTTP request logging
app.use((0, morgan_1.default)('combined'));
// ─── HEALTHCHECK & PUBLIC ROUTES ─────────────────────────────────────────────
app.get('/', (_req, res) => {
    res.status(200).send('🏠 Real Estate API: Home route');
});
// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use('/applications', applicationRoutes_1.default);
app.use('/notifications/email', notificationRoutes_1.default);
app.use('/properties', propertyRoutes_1.default);
app.use('/leases', leaseRoutes_1.default);
app.use('/payments', paymentRoutes_1.default);
app.use('/tenants', tenantRoutes_1.default);
// Protect manager routes, but CORS preflight is already handled above
app.use('/managers', (0, authMiddleware_1.authMiddleware)(['manager']), managerRoutes_1.default);
// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
// 404 handler
app.use((req, res) => {
    res.status(404).json({ message: 'Route not found.' });
});
// Global error handler
app.use((err, _req, res, _next) => {
    console.error('🔥 Server error:', err);
    res.status(500).json({ message: err.message || 'Internal server error.' });
});
// ─── START SERVER ────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});
