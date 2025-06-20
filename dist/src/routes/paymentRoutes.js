"use strict";
// File: server/src/routes/paymentRoutes.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const paymentControllers_1 = require("../controllers/paymentControllers");
const router = express_1.default.Router();
// POST /payments
//   → Tenant must be logged in to make a payment.
router.post("/", (0, authMiddleware_1.authMiddleware)(["tenant"]), paymentControllers_1.createPayment);
// GET /payments/tenant/:tenantCognitoId
//   → Manager or tenant can fetch all payments belonging to that tenant.
router.get("/tenant/:tenantCognitoId", (0, authMiddleware_1.authMiddleware)(["manager", "tenant"]), paymentControllers_1.getPaymentsByTenant);
router.get("/:id/receipt", paymentControllers_1.downloadReceipt);
exports.default = router;
