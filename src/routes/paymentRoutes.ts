import express from "express";
import {
  createPayment,
  createDepositRequest,
  listPendingDeposits,
  approveDeposit,
  declineDeposit,
  withdrawFunds,
  fundTenant,
  getPaymentsByTenant,
  downloadReceipt,
} from "../controllers/paymentControllers";
import { authMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

// Rent / one-off
router.post("/", authMiddleware(["tenant"]), createPayment);

// Deposits
router.post("/deposit-request", authMiddleware(["tenant"]), createDepositRequest);
router.get("/deposits/pending", authMiddleware(["manager"]), listPendingDeposits);
router.put("/deposits/:id/approve", authMiddleware(["manager"]), approveDeposit);
router.put("/deposits/:id/decline", authMiddleware(["manager"]), declineDeposit);

// Withdrawals
router.post("/withdraw", authMiddleware(["tenant"]), withdrawFunds);

// Manager tops up
router.post("/tenants/:cognitoId/fund", authMiddleware(["manager"]), fundTenant);

// Tenant’s history
router.get("/tenant/:tenantCognitoId", authMiddleware(["tenant","manager"]), getPaymentsByTenant);

// PDF receipt
router.get("/:id/receipt", authMiddleware(["tenant","manager"]), downloadReceipt);

export default router;
