"use strict";
// File: server/src/controllers/applicationControllers.ts
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
exports.updateApplicationStatus = exports.createApplication = exports.listApplications = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
/**
 * GET /applications
 * List applications for a tenant or manager.
 */
const listApplications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, userType } = req.query;
        let whereClause = {};
        if (userId && userType) {
            if (userType === "tenant") {
                whereClause = { tenantCognitoId: String(userId) };
            }
            else if (userType === "manager") {
                whereClause = {
                    property: { managerCognitoId: String(userId) },
                };
            }
        }
        const applications = yield prisma.application.findMany({
            where: whereClause,
            include: {
                property: { include: { location: true, manager: true } },
                tenant: true,
            },
        });
        function calculateNextPaymentDate(startDate) {
            const today = new Date();
            const next = new Date(startDate);
            while (next <= today) {
                next.setMonth(next.getMonth() + 1);
            }
            return next;
        }
        const formatted = yield Promise.all(applications.map((app) => __awaiter(void 0, void 0, void 0, function* () {
            const lease = yield prisma.lease.findFirst({
                where: {
                    tenant: { cognitoId: app.tenantCognitoId },
                    propertyId: app.propertyId,
                },
                orderBy: { startDate: "desc" },
            });
            return Object.assign(Object.assign({}, app), { property: Object.assign(Object.assign({}, app.property), { address: app.property.location.address }), manager: app.property.manager, lease: lease
                    ? Object.assign(Object.assign({}, lease), { nextPaymentDate: calculateNextPaymentDate(lease.startDate) }) : null });
        })));
        res.json(formatted);
        return;
    }
    catch (error) {
        console.error("Error retrieving applications:", error);
        res
            .status(500)
            .json({ message: `Internal server error: ${error.message}` });
        return;
    }
});
exports.listApplications = listApplications;
/**
 * POST /applications
 * Create a new application (no lease/payment yet).
 */
const createApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { applicationDate, status, propertyId, tenantCognitoId, name, email, phoneNumber, message, } = req.body;
        const property = yield prisma.property.findUnique({
            where: { id: propertyId },
        });
        if (!property) {
            res.status(404).json({ message: "Property not found" });
            return;
        }
        const newApp = yield prisma.application.create({
            data: {
                applicationDate: new Date(applicationDate),
                status,
                name,
                email,
                phoneNumber,
                message,
                property: { connect: { id: propertyId } },
                tenant: { connect: { cognitoId: tenantCognitoId } },
            },
            include: {
                property: true,
                tenant: true,
            },
        });
        res.status(201).json(newApp);
        return;
    }
    catch (error) {
        console.error("Error creating application:", error);
        res
            .status(500)
            .json({ message: `Internal server error: ${error.message}` });
        return;
    }
});
exports.createApplication = createApplication;
/**
 * PUT /applications/:id/status
 * Update application status.
 * If approving, create lease + initial Paid payment, attach tenant, then update app.
 */
const updateApplicationStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const app = yield prisma.application.findUnique({
            where: { id: Number(id) },
            include: { property: true, tenant: true },
        });
        if (!app) {
            res.status(404).json({ message: "Application not found." });
            return;
        }
        if (status === "Approved") {
            const newLease = yield prisma.lease.create({
                data: {
                    startDate: new Date(),
                    endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                    rent: app.property.pricePerMonth,
                    deposit: app.property.securityDeposit,
                    propertyId: app.propertyId,
                    tenantCognitoId: app.tenantCognitoId,
                },
            });
            yield prisma.payment.create({
                data: {
                    leaseId: newLease.id,
                    amountDue: app.property.pricePerMonth,
                    amountPaid: app.property.pricePerMonth,
                    dueDate: new Date(),
                    paymentDate: new Date(),
                    paymentStatus: "Paid",
                },
            });
            yield prisma.property.update({
                where: { id: app.propertyId },
                data: {
                    tenants: { connect: { cognitoId: app.tenantCognitoId } },
                },
            });
            yield prisma.application.update({
                where: { id: Number(id) },
                data: { status, leaseId: newLease.id },
            });
        }
        else {
            yield prisma.application.update({
                where: { id: Number(id) },
                data: { status },
            });
        }
        const updatedApp = yield prisma.application.findUnique({
            where: { id: Number(id) },
            include: { property: true, tenant: true, lease: true },
        });
        res.json(updatedApp);
        return;
    }
    catch (error) {
        console.error("Error updating status:", error);
        res
            .status(500)
            .json({ message: `Internal server error: ${error.message}` });
        return;
    }
});
exports.updateApplicationStatus = updateApplicationStatus;
