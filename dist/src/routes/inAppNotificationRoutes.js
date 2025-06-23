"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notificationControllers_1 = require("../controllers/notificationControllers");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
// Both managers & tenants can fetch their in-app notifications
router.get("/messages", (0, authMiddleware_1.authMiddleware)(["manager", "tenant"]), notificationControllers_1.getUserMessages);
router.get("/alerts", (0, authMiddleware_1.authMiddleware)(["manager", "tenant"]), notificationControllers_1.getUserAlerts);
exports.default = router;
