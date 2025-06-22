"use strict";
// File: server/src/controllers/leaseControllers.ts
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
exports.downloadAgreement = exports.getLeasesByPropertyId = exports.getLeasePayments = exports.getLeases = void 0;
const client_1 = require("@prisma/client");
const pdfkit_1 = __importDefault(require("pdfkit"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const promises_1 = require("stream/promises");
const prisma = new client_1.PrismaClient();
const AGREEMENTS_DIR = path_1.default.join(__dirname, "../../agreements");
if (!fs_1.default.existsSync(AGREEMENTS_DIR))
    fs_1.default.mkdirSync(AGREEMENTS_DIR, { recursive: true });
/**
 * GET /leases
 * Returns all leases (with tenant + property included).
 */
const getLeases = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leases = yield prisma.lease.findMany({
            include: { tenant: true, property: true },
        });
        res.status(200).json(leases);
    }
    catch (error) {
        console.error("Error retrieving leases:", error);
        res
            .status(500)
            .json({ message: "Internal server error retrieving leases." });
    }
});
exports.getLeases = getLeases;
/**
 * GET /leases/:id/payments
 * Returns all payments for a single lease ID.
 */
const getLeasePayments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaseId = Number(req.params.id);
        if (isNaN(leaseId)) {
            res.status(400).json({ message: "Invalid lease ID." });
            return;
        }
        const payments = yield prisma.payment.findMany({ where: { leaseId } });
        res.status(200).json(payments);
    }
    catch (error) {
        console.error("Error retrieving lease payments:", error);
        res
            .status(500)
            .json({ message: "Internal server error retrieving lease payments." });
    }
});
exports.getLeasePayments = getLeasePayments;
/**
 * GET /properties/:id/leases
 * Returns all leases for a given property ID.
 */
const getLeasesByPropertyId = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const propertyId = Number(req.params.id);
        if (isNaN(propertyId)) {
            res.status(400).json({ message: "Invalid propertyId." });
            return;
        }
        const leases = yield prisma.lease.findMany({
            where: { propertyId },
            include: { tenant: true, property: true },
        });
        res.status(200).json(leases);
    }
    catch (error) {
        console.error("Error retrieving leases by property ID:", error);
        res.status(500).json({
            message: "Internal server error retrieving leases by property ID.",
        });
    }
});
exports.getLeasesByPropertyId = getLeasesByPropertyId;
/**
 * GET /leases/:id/agreement
 * Generates (if needed) and streams the lease agreement PDF.
 */
const downloadAgreement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaseId = Number(req.params.id);
        const leaseRecord = yield prisma.lease.findUnique({
            where: { id: leaseId },
            select: { agreementPath: true },
        });
        let agreementPath = leaseRecord === null || leaseRecord === void 0 ? void 0 : leaseRecord.agreementPath;
        // If not generated yet, create it
        if (!agreementPath || !fs_1.default.existsSync(agreementPath)) {
            agreementPath = path_1.default.join(AGREEMENTS_DIR, `lease-${leaseId}.pdf`);
            const doc = new pdfkit_1.default({ size: "A4", margin: 50 });
            const ws = fs_1.default.createWriteStream(agreementPath);
            doc.pipe(ws);
            doc
                .fontSize(18)
                .text("Lease Agreement", { align: "center" })
                .moveDown()
                .fontSize(12)
                .text(`Lease ID: ${leaseId}`)
                .text(`Date: ${new Date().toLocaleDateString()}`)
                .moveDown()
                .text("This lease agreement is between the property manager and the tenant...", {
                align: "justify",
            });
            doc.end();
            yield (0, promises_1.pipeline)(doc, ws);
            yield prisma.lease.update({
                where: { id: leaseId },
                data: { agreementPath },
            });
        }
        // Stream it back
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=lease_agreement_${leaseId}.pdf`);
        fs_1.default.createReadStream(agreementPath).pipe(res);
    }
    catch (err) {
        console.error("Error in downloadAgreement:", err);
        res.status(500).json({ error: "Server error downloading agreement." });
    }
});
exports.downloadAgreement = downloadAgreement;
