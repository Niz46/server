"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// server/src/routes/notificationRoutes.ts
const express_1 = __importDefault(require("express"));
const notificationControllers_1 = require("../controllers/notificationControllers");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// only managers can send email blasts
router.post("/all", (0, authMiddleware_1.authMiddleware)(["manager"]), notificationControllers_1.sendEmailToAll);
// managers can also send to individuals
router.post("/user", (0, authMiddleware_1.authMiddleware)(["manager"]), notificationControllers_1.sendEmailToUser);
exports.default = router;
