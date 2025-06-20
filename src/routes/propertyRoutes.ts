// File: server/src/routes/propertyRoutes.ts

import express from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/authMiddleware";

// Import property controller functions:
import {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
} from "../controllers/propertyControllers";

// Import the lease‐by‐property handler:
import { getLeasesByPropertyId } from "../controllers/leaseControllers";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * ─── PROPERTY ENDPOINTS ────────────────────────────────────────────────────────
 */

// GET /properties
//   → Both “manager” and “tenant” roles can fetch the list
router.get("/", authMiddleware(["manager", "tenant"]), getProperties);

// GET /properties/:id
//   → Both “manager” and “tenant” roles can fetch details
router.get("/:id", authMiddleware(["manager", "tenant"]), getProperty);

// POST /properties
//   → Only “manager” can create a new property
router.post(
  "/",
  authMiddleware(["manager"]),
  upload.array("photos"),
  createProperty
);

// PUT /properties/:id
//   → Only “manager” can update an existing property
router.put("/:id", authMiddleware(["manager"]), updateProperty);

// DELETE /properties/:id
//   → Only “manager” can delete a property
router.delete("/:id", authMiddleware(["manager"]), deleteProperty);

/**
 * ─── LEASES FOR A GIVEN PROPERTY ───────────────────────────────────────────────
 * GET /properties/:id/leases
 *   → Returns all leases for that property, with nested tenant & property.
 *   → Both “manager” and “tenant” can access this.
 */
router.get(
  "/:id/leases",
  authMiddleware(["manager", "tenant"]),
  getLeasesByPropertyId
);

export default router;
