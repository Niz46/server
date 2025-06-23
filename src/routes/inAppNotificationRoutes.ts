import { Router } from "express";
import { getUserMessages, getUserAlerts } from "../controllers/notificationControllers";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// Both managers & tenants can fetch their in-app notifications
router.get("/messages", authMiddleware(["manager","tenant"]), getUserMessages);
router.get("/alerts",   authMiddleware(["manager","tenant"]), getUserAlerts);

export default router;