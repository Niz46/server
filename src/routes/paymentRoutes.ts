// File: server/src/routes/paymentRoutes.ts

import express from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import {
  createPayment,
  getPaymentsByTenant, downloadReceipt} from "../controllers/paymentControllers";

const router = express.Router();

// POST /payments
//   → Tenant must be logged in to make a payment.
router.post("/", authMiddleware(["tenant"]), createPayment);

// GET /payments/tenant/:tenantCognitoId
//   → Manager or tenant can fetch all payments belonging to that tenant.
router.get(
  "/tenant/:tenantCognitoId",
  authMiddleware(["manager", "tenant"]),
  getPaymentsByTenant
);

router.get("/:id/receipt", downloadReceipt);

export default router;
