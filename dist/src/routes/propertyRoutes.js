"use strict";
// File: server/src/routes/propertyRoutes.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const authMiddleware_1 = require("../middleware/authMiddleware");
// Import property controller functions:
const propertyControllers_1 = require("../controllers/propertyControllers");
// Import the lease‐by‐property handler:
const leaseControllers_1 = require("../controllers/leaseControllers");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
/**
 * ─── PROPERTY ENDPOINTS ────────────────────────────────────────────────────────
 */
// GET /properties
//   → Both “manager” and “tenant” roles can fetch the list
router.get("/", (0, authMiddleware_1.authMiddleware)(["manager", "tenant"]), propertyControllers_1.getProperties);
// GET /properties/:id
//   → Both “manager” and “tenant” roles can fetch details
router.get("/:id", (0, authMiddleware_1.authMiddleware)(["manager", "tenant"]), propertyControllers_1.getProperty);
// POST /properties
//   → Only “manager” can create a new property
router.post("/", (0, authMiddleware_1.authMiddleware)(["manager"]), upload.array("photos"), propertyControllers_1.createProperty);
// PUT /properties/:id
//   → Only “manager” can update an existing property
router.put("/:id", (0, authMiddleware_1.authMiddleware)(["manager"]), propertyControllers_1.updateProperty);
// DELETE /properties/:id
//   → Only “manager” can delete a property
router.delete("/:id", (0, authMiddleware_1.authMiddleware)(["manager"]), propertyControllers_1.deleteProperty);
/**
 * ─── LEASES FOR A GIVEN PROPERTY ───────────────────────────────────────────────
 * GET /properties/:id/leases
 *   → Returns all leases for that property, with nested tenant & property.
 *   → Both “manager” and “tenant” can access this.
 */
router.get("/:id/leases", (0, authMiddleware_1.authMiddleware)(["manager", "tenant"]), leaseControllers_1.getLeasesByPropertyId);
exports.default = router;
