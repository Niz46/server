"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const paymentControllers_1 = require("../controllers/paymentControllers");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// Rent / one-off
router.post("/", (0, authMiddleware_1.authMiddleware)(["tenant"]), paymentControllers_1.createPayment);
// Deposits
router.post("/deposit-request", (0, authMiddleware_1.authMiddleware)(["tenant"]), paymentControllers_1.createDepositRequest);
router.get("/deposits/pending", (0, authMiddleware_1.authMiddleware)(["manager"]), paymentControllers_1.listPendingDeposits);
router.put("/deposits/:id/approve", (0, authMiddleware_1.authMiddleware)(["manager"]), paymentControllers_1.approveDeposit);
router.put("/deposits/:id/decline", (0, authMiddleware_1.authMiddleware)(["manager"]), paymentControllers_1.declineDeposit);
// Withdrawals
router.post("/withdraw", (0, authMiddleware_1.authMiddleware)(["tenant"]), paymentControllers_1.withdrawFunds);
// Manager tops up
router.post("/tenants/:cognitoId/fund", (0, authMiddleware_1.authMiddleware)(["manager"]), paymentControllers_1.fundTenant);
// Tenant’s history
router.get("/tenant/:tenantCognitoId", (0, authMiddleware_1.authMiddleware)(["tenant", "manager"]), paymentControllers_1.getPaymentsByTenant);
// PDF receipt
router.get("/:id/receipt", (0, authMiddleware_1.authMiddleware)(["tenant", "manager"]), paymentControllers_1.downloadReceipt);
exports.default = router;
