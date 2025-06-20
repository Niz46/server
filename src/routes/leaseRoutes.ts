// File: server/src/routes/leaseRoutes.ts

import express from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import {
  getLeases,
  getLeasePayments,
  downloadAgreement 
} from "../controllers/leaseControllers";

const router = express.Router();

// GET /leases
router.get("/", authMiddleware(["manager", "tenant"]), getLeases);

// GET /leases/:id/payments
router.get("/:id/payments", authMiddleware(["manager", "tenant"]), getLeasePayments);

router.get("/:id/agreement", downloadAgreement);
export default router;
