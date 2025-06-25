"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const tenantControllers_1 = require("../controllers/tenantControllers");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// Managers only
router.get("/", (0, authMiddleware_1.authMiddleware)(["manager"]), tenantControllers_1.getAllTenants);
router.put("/:cognitoId/suspend", (0, authMiddleware_1.authMiddleware)(["manager"]), tenantControllers_1.suspendTenant);
// Tenant or Manager can view a single tenant
router.get("/:cognitoId", (0, authMiddleware_1.authMiddleware)(["tenant", "manager"]), tenantControllers_1.getTenant);
// Public sign-up endpoint
router.post("/", tenantControllers_1.createTenant);
// Tenant-only actions
router.put("/:cognitoId", (0, authMiddleware_1.authMiddleware)(["tenant"]), tenantControllers_1.updateTenant);
router.get("/:cognitoId/current-residences", (0, authMiddleware_1.authMiddleware)(["tenant"]), tenantControllers_1.getCurrentResidences);
router.post("/:cognitoId/favorites/:propertyId", (0, authMiddleware_1.authMiddleware)(["tenant"]), tenantControllers_1.addFavoriteProperty);
router.delete("/:cognitoId/favorites/:propertyId", (0, authMiddleware_1.authMiddleware)(["tenant"]), tenantControllers_1.removeFavoriteProperty);
exports.default = router;
