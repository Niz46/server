// server/src/routes/notificationRoutes.ts
import express from "express";
import {
  sendEmailToAll,
  sendEmailToUser,
} from "../controllers/notificationControllers";
import { authMiddleware } from "../middleware/authMiddleware";

const router = express.Router();
// only managers can send email blasts
router.post("/all", authMiddleware(["manager"]), sendEmailToAll);
// managers can also send to individuals
router.post("/user", authMiddleware(["manager"]), sendEmailToUser);

export default router;
