"use strict";
// File: server/src/routes/leaseRoutes.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const leaseControllers_1 = require("../controllers/leaseControllers");
const router = express_1.default.Router();
// GET /leases
router.get("/", (0, authMiddleware_1.authMiddleware)(["manager", "tenant"]), leaseControllers_1.getLeases);
// GET /leases/:id/payments
router.get("/:id/payments", (0, authMiddleware_1.authMiddleware)(["manager", "tenant"]), leaseControllers_1.getLeasePayments);
router.get("/:id/agreement", leaseControllers_1.downloadAgreement);
exports.default = router;
