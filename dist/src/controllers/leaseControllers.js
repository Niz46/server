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
const fs_1 = __importDefault(require("fs"));
const prisma = new client_1.PrismaClient();
/**
 * GET /leases
 * Returns all leases (with tenant + property included).
 */
const getLeases = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leases = yield prisma.lease.findMany({
            include: {
                tenant: true,
                property: true,
            },
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
        const payments = yield prisma.payment.findMany({
            where: { leaseId },
        });
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
 * Returns all leases for a given property ID (including tenant & property).
 */
const getLeasesByPropertyId = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // The route is defined as “/:id/leases”, so we read req.params.id
        const propertyId = Number(req.params.id);
        if (isNaN(propertyId)) {
            res.status(400).json({ message: "Invalid propertyId." });
            return;
        }
        const leases = yield prisma.lease.findMany({
            where: { propertyId },
            include: {
                tenant: true,
                property: true,
            },
        });
        res.status(200).json(leases);
    }
    catch (error) {
        console.error("Error retrieving leases by property ID:", error);
        res
            .status(500)
            .json({ message: "Internal server error retrieving leases by property ID." });
    }
});
exports.getLeasesByPropertyId = getLeasesByPropertyId;
const downloadAgreement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const leaseId = Number(req.params.id);
    const lease = yield prisma.lease.findUnique({
        where: { id: leaseId },
        select: { agreementPath: true },
    });
    if (!(lease === null || lease === void 0 ? void 0 : lease.agreementPath) || !fs_1.default.existsSync(lease.agreementPath)) {
        res.status(404).json({ error: "Lease agreement not found" });
        return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=lease_agreement_${leaseId}.pdf`);
    fs_1.default.createReadStream(lease.agreementPath).pipe(res);
});
exports.downloadAgreement = downloadAgreement;
