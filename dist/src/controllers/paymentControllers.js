"use strict";
// File: server/src/controllers/paymentControllers.ts
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
exports.downloadReceipt = exports.getPaymentsByTenant = exports.createPayment = void 0;
const pdfkit_1 = __importDefault(require("pdfkit"));
const client_1 = require("@prisma/client");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const promises_1 = require("stream/promises");
const prisma = new client_1.PrismaClient();
const RECEIPTS_DIR = path_1.default.join(__dirname, "../../receipts");
if (!fs_1.default.existsSync(RECEIPTS_DIR))
    fs_1.default.mkdirSync(RECEIPTS_DIR, { recursive: true });
/**
 * POST /payments
 * Creates a new payment record tied to a given lease, then generates and stores a PDF receipt.
 * Only tenants may call this endpoint.
 */
const createPayment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { leaseId, amountDue, amountPaid, dueDate, paymentDate } = req.body;
        const lease = yield prisma.lease.findUnique({
            where: { id: Number(leaseId) },
        });
        if (!lease) {
            res.status(400).json({ message: "Invalid leaseId." });
            return;
        }
        // Determine paymentStatus
        let paymentStatus = "Pending";
        if (amountPaid >= amountDue) {
            paymentStatus = "Paid";
        }
        else if (amountPaid > 0) {
            paymentStatus = "PartiallyPaid";
        }
        // Create the payment record
        const newPayment = yield prisma.payment.create({
            data: {
                leaseId: lease.id,
                amountDue: parseFloat(amountDue),
                amountPaid: parseFloat(amountPaid),
                dueDate: new Date(dueDate),
                paymentDate: new Date(paymentDate),
                paymentStatus,
            },
        });
        // --- PDF generation ---
        const receiptFilename = `receipt-${newPayment.id}.pdf`;
        const receiptPath = path_1.default.join(RECEIPTS_DIR, receiptFilename);
        const doc = new pdfkit_1.default({ size: "A4", margin: 50 });
        const writeStream = fs_1.default.createWriteStream(receiptPath);
        doc.pipe(writeStream);
        doc
            .fontSize(20)
            .text("Payment Receipt", { align: "center" })
            .moveDown(2)
            .fontSize(12)
            .text(`Receipt #: ${newPayment.id}`)
            .text(`Date Paid: ${new Date(newPayment.paymentDate).toLocaleDateString()}`)
            .text(`Lease ID: ${newPayment.leaseId}`)
            .text(`Amount Due: $${newPayment.amountDue.toFixed(2)}`)
            .text(`Amount Paid: $${newPayment.amountPaid.toFixed(2)}`)
            .text(`Status: ${newPayment.paymentStatus}`)
            .moveDown()
            .text("Thank you for your payment.", { align: "center" });
        doc.end();
        try {
            // Wait until PDF is fully written
            yield (0, promises_1.pipeline)(doc, writeStream);
            // Update DB with receipt path
            yield prisma.payment.update({
                where: { id: newPayment.id },
                data: { receiptPath },
            });
            // Return full record including path
            res.status(201).json(Object.assign(Object.assign({}, newPayment), { receiptPath }));
        }
        catch (pdfErr) {
            console.error("PDF generation failed:", pdfErr);
            // Even if PDF fails, return the payment record
            res.status(201).json(newPayment);
        }
    }
    catch (error) {
        console.error("Error creating payment:", error);
        res
            .status(500)
            .json({ message: "Internal server error creating payment." });
    }
});
exports.createPayment = createPayment;
/**
 * GET /payments/tenant/:tenantCognitoId
 * Returns all payments (with lease info) for a given tenantCognitoId.
 */
const getPaymentsByTenant = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { tenantCognitoId } = req.params;
        const payments = yield prisma.payment.findMany({
            where: { lease: { tenantCognitoId } },
            include: { lease: { include: { property: true } } },
        });
        res.status(200).json(payments);
    }
    catch (error) {
        console.error("Error retrieving tenant payments:", error);
        res
            .status(500)
            .json({ message: "Internal server error retrieving tenant payments." });
    }
});
exports.getPaymentsByTenant = getPaymentsByTenant;
/**
 * GET /payments/:id/receipt
 * Streams the PDF receipt for a given payment ID.
 */
const downloadReceipt = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const paymentId = Number(req.params.id);
        const payment = yield prisma.payment.findUnique({
            where: { id: paymentId },
            select: { receiptPath: true },
        });
        if (!(payment === null || payment === void 0 ? void 0 : payment.receiptPath) || !fs_1.default.existsSync(payment.receiptPath)) {
            res.status(404).json({ error: "Receipt not found" });
            return;
        }
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=receipt_${paymentId}.pdf`);
        fs_1.default.createReadStream(payment.receiptPath).pipe(res);
    }
    catch (err) {
        console.error("Error in downloadReceipt:", err);
        res.status(500).json({ error: "Server error" });
    }
});
exports.downloadReceipt = downloadReceipt;
