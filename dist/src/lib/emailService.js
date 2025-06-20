"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
// server/src/lib/emailService.ts
const dotenv_1 = __importDefault(require("dotenv"));
const mailgun_js_1 = __importDefault(require("mailgun.js"));
const form_data_1 = __importDefault(require("form-data"));
dotenv_1.default.config();
const { MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_SENDER_EMAIL, MAILGUN_SENDER_NAME, } = process.env;
if (!MAILGUN_API_KEY ||
    !MAILGUN_DOMAIN ||
    !MAILGUN_SENDER_EMAIL ||
    !MAILGUN_SENDER_NAME) {
    throw new Error('Missing Mailgun config. Please set MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_SENDER_EMAIL, and MAILGUN_SENDER_NAME in .env');
}
const mailgun = new mailgun_js_1.default(form_data_1.default);
const mg = mailgun.client({ username: 'api', key: MAILGUN_API_KEY });
/**
 * sendEmail — wraps Mailgun’s API for single-recipient sends.
 */
function sendEmail(_a) {
    return __awaiter(this, arguments, void 0, function* ({ to, subject, text, html }) {
        try {
            // Cast to any to satisfy TypeScript and align with Mailgun API payload
            const messageData = {
                from: `${MAILGUN_SENDER_NAME} <${MAILGUN_SENDER_EMAIL}>`,
                to: [to],
                subject,
                text,
                html,
            };
            const result = yield mg.messages.create(MAILGUN_DOMAIN, messageData);
            console.log(`✅ Mailgun: Sent to ${to}`, result);
            return result;
        }
        catch (err) {
            console.error('❌ Mailgun send error:', err.message || err);
            throw err;
        }
    });
}
