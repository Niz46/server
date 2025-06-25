import express from "express";
import {
  getAllTenants,
  getTenant,
  createTenant,
  updateTenant,
  getCurrentResidences,
  addFavoriteProperty,
  removeFavoriteProperty,
} from "../controllers/tenantControllers";
import { authMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

// Managers only
router.get("/", authMiddleware(["manager"]), getAllTenants);

// Tenant or Manager can view a single tenant
router.get("/:cognitoId", authMiddleware(["tenant","manager"]), getTenant);

// Public sign-up endpoint
router.post("/", createTenant);

// Tenant-only actions
router.put("/:cognitoId", authMiddleware(["tenant", "manager"]), updateTenant);

router.get(
  "/:cognitoId/current-residences",
  authMiddleware(["tenant"]),
  getCurrentResidences
);

router.post(
  "/:cognitoId/favorites/:propertyId",
  authMiddleware(["tenant"]),
  addFavoriteProperty
);

router.delete(
  "/:cognitoId/favorites/:propertyId",
  authMiddleware(["tenant"]),
  removeFavoriteProperty
);

export default router;
