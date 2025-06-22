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
const prisma = new client_1.PrismaClient();
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
 * Dynamically generates and streams a lease agreement PDF.
 */
const downloadAgreement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaseId = Number(req.params.id);
        if (isNaN(leaseId)) {
            res.status(400).json({ error: "Invalid lease ID." });
            return;
        }
        // Fetch lease details (including tenant and property if needed)
        const lease = yield prisma.lease.findUnique({
            where: { id: leaseId },
            include: {
                tenant: true,
                property: true, // Include property details if needed
            },
        });
        if (!lease) {
            res.status(404).json({ error: "Lease not found." });
            return;
        }
        // Set headers for PDF download
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=lease_agreement_${leaseId}.pdf`);
        // Stream PDF directly
        const doc = new pdfkit_1.default({ size: "A4", margin: 50 });
        doc.pipe(res);
        // Header
        doc.fontSize(18).text("Lease Agreement", { align: "center" }).moveDown();
        // Lease info
        doc
            .fontSize(12)
            .text(`Lease ID: ${lease.id}`)
            .text(`Property: ${lease.property.name} (${lease.property.id})`)
            .text(`Tenant: ${lease.tenant.name} (${lease.tenant.cognitoId})`)
            .text(`Start Date: ${lease.startDate.toLocaleDateString()}`)
            .text(`End Date: ${lease.endDate.toLocaleDateString()}`)
            .moveDown();
        // Body placeholder
        doc
            .text("This Lease Agreement is entered into between the Manager and the Tenant. " +
            "The Manager agrees to lease the property to the Tenant under the following terms and conditions...", { align: "justify" })
            .moveDown();
        // Signature lines
        doc
            .moveDown(2)
            .text("__________________________", { continued: true })
            .text("    ")
            .text("__________________________")
            .text("   Manager Signature", { continued: true })
            .text("    ")
            .text("Tenant Signature");
        doc.end();
    }
    catch (err) {
        console.error("Error streaming agreement:", err);
        // If headers already sent, just end; otherwise send JSON
        if (!res.headersSent) {
            res.status(500).json({ error: "Server error generating agreement." });
        }
        else {
            res.end();
        }
    }
});
exports.downloadAgreement = downloadAgreement;
