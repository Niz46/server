"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
/**
 * Role-based auth middleware.
 * @param allowedRoles list of roles (lowercase) that may access the route
 */
const authMiddleware = (allowedRoles) => {
    // normalize once
    const roles = allowedRoles.map((r) => r.toLowerCase());
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ message: "Unauthorized: no token" });
            return;
        }
        const token = authHeader.split(" ")[1];
        if (!token) {
            res.status(401).json({ message: "Unauthorized: malformed header" });
            return;
        }
        let decoded;
        try {
            // NOTE: for production, switch to jwt.verify() with your JWKS or secret
            decoded = jsonwebtoken_1.default.decode(token);
            if (!decoded || !decoded.sub) {
                throw new Error("Invalid token payload");
            }
        }
        catch (err) {
            console.error("Failed to decode token:", err);
            res.status(400).json({ message: "Invalid token" });
            return;
        }
        const userRole = (decoded["custom:role"] || "").toLowerCase();
        if (!roles.includes(userRole)) {
            console.warn(`Access denied for role="${userRole}", allowed=${roles}`);
            res.status(403).json({ message: "Access Denied" });
            return;
        }
        // attach for downstream handlers
        req.user = { id: decoded.sub, role: userRole };
        next();
    };
};
exports.authMiddleware = authMiddleware;
