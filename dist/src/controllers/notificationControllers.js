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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailToUser = exports.sendEmailToAll = void 0;
const client_1 = require("@prisma/client");
const emailService_1 = require("../lib/emailService");
const prisma = new client_1.PrismaClient();
/**
 * Send email to all tenants. Only managers can access.
 */
const sendEmailToAll = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { subject, message } = req.body;
    try {
        const tenants = yield prisma.tenant.findMany({ select: { email: true } });
        yield Promise.all(tenants.map((t) => (0, emailService_1.sendEmail)({
            to: t.email,
            subject,
            text: message,
        })));
        res.status(200).json({ success: true });
    }
    catch (err) {
        console.error("sendEmailToAll error:", err);
        next(err);
    }
});
exports.sendEmailToAll = sendEmailToAll;
/**
 * Send email to a single user. Only managers can access.
 */
const sendEmailToUser = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, subject, message } = req.body;
    try {
        yield (0, emailService_1.sendEmail)({ to: email, subject, text: message });
        res.status(200).json({ success: true });
    }
    catch (err) {
        console.error("sendEmailToUser error:", err);
        next(err);
    }
});
exports.sendEmailToUser = sendEmailToUser;
