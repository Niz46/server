"use strict";
// server/src/controllers/paymentControllers.ts
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
exports.downloadReceipt = exports.getPaymentsByTenant = exports.fundTenant = exports.withdrawFunds = exports.declineDeposit = exports.approveDeposit = exports.listPendingDeposits = exports.createDepositRequest = exports.createPayment = void 0;
const pdfkit_1 = __importDefault(require("pdfkit"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
/**
 * POST /payments
 * Creates a new payment record tied to a given lease.
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
        if (amountPaid >= amountDue)
            paymentStatus = "Paid";
        else if (amountPaid > 0)
            paymentStatus = "PartiallyPaid";
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
        res.status(201).json(newPayment);
    }
    catch (error) {
        console.error("Error creating payment:", error);
        res
            .status(500)
            .json({ message: "Internal server error creating payment." });
    }
    return;
});
exports.createPayment = createPayment;
/**
 * POST /payments/deposit-request
 * Tenant creates a deposit request (pending approval).
 */
const createDepositRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const tenantCognitoId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!tenantCognitoId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    // only pull leaseId and amount
    const { leaseId, amount } = req.body;
    // tighten the guard: null/undefined or ≤0 are invalid
    if (leaseId == null || leaseId <= 0 || amount == null || amount <= 0) {
        res.status(400).json({ message: "leaseId and amount required" });
        return;
    }
    const lease = yield prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.tenantCognitoId !== tenantCognitoId) {
        res
            .status(400)
            .json({ message: "Lease not found or does not belong to you" });
        return;
    }
    try {
        const deposit = yield prisma.payment.create({
            data: {
                leaseId,
                amountDue: amount,
                amountPaid: 0,
                dueDate: new Date(),
                paymentDate: new Date(),
                paymentStatus: "Pending",
                type: "Deposit",
                isApproved: false,
                tenantCognitoId,
            },
        });
        res.status(201).json(deposit);
    }
    catch (err) {
        console.error("Error creating deposit request:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.createDepositRequest = createDepositRequest;
/**
 * GET /payments/deposits/pending
 * Manager lists all deposit requests awaiting approval.
 */
const listPendingDeposits = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const deposits = yield prisma.payment.findMany({
            where: { type: "Deposit", isApproved: false },
            include: { lease: { include: { tenant: true } } },
        });
        res.json(deposits);
    }
    catch (err) {
        console.error("Error listing pending deposits:", err);
        res.status(500).json({ message: err.message });
    }
    return;
});
exports.listPendingDeposits = listPendingDeposits;
/**
 * PUT /payments/deposits/:id/approve
 * Manager approves a deposit: mark paid + credit tenant balance.
 */
const approveDeposit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    try {
        const p = yield prisma.payment.findUnique({ where: { id } });
        if (!p) {
            res.status(404).json({ message: "Deposit not found" });
            return;
        }
        // ---- NEW: Make sure there _is_ a leaseId and it's not null ----
        if (p.leaseId == null) {
            res.status(400).json({ message: "Invalid deposit: no lease associated" });
            return;
        }
        const lease = yield prisma.lease.findUnique({ where: { id: p.leaseId } });
        if (!lease) {
            res.status(404).json({ message: "Lease not found" });
            return;
        }
        yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // mark approved
            yield tx.payment.update({
                where: { id },
                data: {
                    isApproved: true,
                    paymentStatus: "Paid",
                    amountPaid: p.amountDue,
                },
            });
            // credit tenant
            const tenant = yield tx.tenant.findUnique({
                where: { cognitoId: lease.tenantCognitoId },
            });
            if (tenant) {
                yield tx.tenant.update({
                    where: { cognitoId: tenant.cognitoId },
                    data: { balance: tenant.balance + p.amountDue },
                });
            }
        }));
        res.json({ success: true });
    }
    catch (err) {
        console.error("Error approving deposit:", err);
        res.status(500).json({ message: err.message });
    }
    return;
});
exports.approveDeposit = approveDeposit;
/**
 * PUT /payments/deposits/:id/decline
 * Manager declines a deposit: just flag it back to Pending.
 */
const declineDeposit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    try {
        yield prisma.payment.update({
            where: { id },
            data: { paymentStatus: "Pending" },
        });
        res.json({ success: true });
    }
    catch (err) {
        console.error("Error declining deposit:", err);
        res.status(500).json({ message: err.message });
    }
    return;
});
exports.declineDeposit = declineDeposit;
/**
 * POST /payments/withdraw
 * Tenant withdraws funds if eligible.
 */
const withdrawFunds = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const tenantCognitoId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!tenantCognitoId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    // Extract the new fields
    const { amount, destinationType, destinationDetails } = req.body;
    if (amount <= 0 || !destinationType || !destinationDetails) {
        res.status(400).json({ message: "amount, destinationType, and destinationDetails are required" });
        return;
    }
    const tenant = yield prisma.tenant.findUnique({
        where: { cognitoId: tenantCognitoId },
    });
    if (!tenant || tenant.balance < amount) {
        res.status(400).json({ message: "Insufficient funds" });
        return;
    }
    try {
        yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.tenant.update({
                where: { cognitoId: tenantCognitoId },
                data: { balance: tenant.balance - amount },
            });
            yield tx.payment.create({
                data: {
                    leaseId: null,
                    amountDue: 0,
                    amountPaid: amount,
                    dueDate: new Date(),
                    paymentDate: new Date(),
                    paymentStatus: "Paid",
                    type: "Withdrawal",
                    isApproved: true,
                    destinationType,
                    destinationDetails,
                    tenantCognitoId,
                },
            });
        }));
        res.json({ success: true });
    }
    catch (err) {
        console.error("Error withdrawing funds:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.withdrawFunds = withdrawFunds;
/**
 * POST /tenants/:cognitoId/fund
 * Manager manually tops-up tenant.
 */
const fundTenant = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { cognitoId } = req.params;
    const { amount } = req.body;
    if (amount <= 0) {
        res.status(400).json({ message: "Invalid amount" });
        return;
    }
    try {
        yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const tenant = yield tx.tenant.findUnique({ where: { cognitoId } });
            if (!tenant) {
                throw new Error("Tenant not found");
            }
            yield tx.tenant.update({
                where: { cognitoId },
                data: { balance: tenant.balance + amount },
            });
            yield tx.payment.create({
                data: {
                    leaseId: null,
                    amountDue: 0,
                    amountPaid: amount,
                    dueDate: new Date(),
                    paymentDate: new Date(),
                    paymentStatus: "Paid",
                    type: "Deposit",
                    isApproved: true,
                },
            });
        }));
        res.json({ success: true });
    }
    catch (err) {
        console.error("Error funding tenant:", err);
        res.status(500).json({ message: err.message });
    }
    return;
});
exports.fundTenant = fundTenant;
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
    return;
});
exports.getPaymentsByTenant = getPaymentsByTenant;
/**
 * GET /payments/:id/receipt
 * Streams a dynamically-generated PDF receipt for a given payment ID.
 */
const downloadReceipt = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const paymentId = Number(req.params.id);
        const payment = yield prisma.payment.findUnique({
            where: { id: paymentId },
            include: {
                lease: {
                    include: { property: true, tenant: true },
                },
            },
        });
        if (!payment) {
            res.status(404).json({ error: "Payment not found." });
            return;
        }
        // Set headers for PDF download
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=receipt_${paymentId}.pdf`);
        // Generate PDF in-memory and pipe to response
        // inside your downloadReceipt controller
        const doc = new pdfkit_1.default({
            size: "A4",
            margin: 50,
            pdfVersion: "1.4",
            info: {
                Title: "Payment Receipt",
                Author: "Miles Home Real Estate",
                Subject: `Receipt for Payment #${payment.id}`,
            },
        });
        doc.pipe(res);
        // ── HEADER ──────────────────────────────────────────────────────────────────────
        // (If you have a logo, replace the text with:
        //    doc.image('/path/to/logo.png', { fit:[100,50], align:'left' });
        // )
        doc
            .fontSize(24)
            .font("Helvetica-Bold")
            .text("Miles Home Real Estate", { align: "left" });
        doc
            .fontSize(12)
            .font("Helvetica")
            .text(`Receipt #${payment.id}`, { align: "right" })
            .text(`Date: ${payment.paymentDate.toLocaleDateString("en-US")}`, {
            align: "right",
        })
            .moveDown(2);
        // ── BILL TO / CUSTOMER ──────────────────────────────────────────────────────────
        doc
            .fontSize(14)
            .font("Helvetica-Bold")
            .text("Bill To:", { continued: false })
            .moveDown(0.5)
            .fontSize(12)
            .font("Helvetica")
            .text(`${payment.lease.tenant.name}`)
            .text(`${payment.lease.tenant.email}`)
            .moveDown(1.5);
        // ── PAYMENT DETAILS TABLE ───────────────────────────────────────────────────────
        const tableTop = doc.y;
        const labelX = 50;
        const valueX = 300;
        // Column headers
        doc
            .fontSize(12)
            .font("Helvetica-Bold")
            .text("Description", labelX, tableTop)
            .text("Amount", valueX, tableTop)
            .moveDown(0.5);
        // Horizontal line
        doc.moveTo(labelX, doc.y).lineTo(550, doc.y).stroke().moveDown(0.5);
        // Rows
        const rows = [
            { desc: "Amount Paid", value: `$${payment.amountPaid.toFixed(2)}` },
            { desc: "Payment Status", value: payment.paymentStatus },
        ];
        rows.forEach((row) => {
            doc
                .font("Helvetica")
                .text(row.desc, labelX, doc.y)
                .text(row.value, valueX, doc.y, { width: 100, align: "right" })
                .moveDown(0.5);
        });
        // Totals line
        doc
            .moveTo(labelX, doc.y + 5)
            .lineTo(550, doc.y + 5)
            .stroke()
            .moveDown(1);
        // ── THANK YOU & FOOTER ─────────────────────────────────────────────────────────
        doc
            .fontSize(12)
            .font("Helvetica-Oblique")
            .text("Thank you for your business!", { align: "center" })
            .moveDown(2);
        // Signature line
        doc
            .font("Helvetica")
            .text("Miles Home LTD", labelX, doc.y)
            .text("Authorized Signature", labelX, doc.y + 15)
            .moveDown(1);
        // Optional: company contact in footer
        doc
            .fontSize(10)
            .font("Helvetica")
            .text("Miles Home Real Estate • 123 Main St, Springfield • (144) 026-99164 • milestonesrealstates@gmail.com", 50, 780, { align: "center", width: 500 });
        doc.end();
    }
    catch (err) {
        console.error("Error streaming receipt:", err);
        // If streaming fails mid-PDF, we can’t send JSON, so just close connection
        if (!res.headersSent) {
            res.status(500).json({ error: "Server error generating receipt." });
        }
        else {
            res.end();
        }
    }
});
exports.downloadReceipt = downloadReceipt;
