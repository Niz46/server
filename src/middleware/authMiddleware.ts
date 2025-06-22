import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

interface DecodedToken extends JwtPayload {
  sub: string;
  "custom:role"?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
    }
  }
}

/**
 * Role-based auth middleware.
 * @param allowedRoles list of roles (lowercase) that may access the route
 */
export const authMiddleware = (allowedRoles: string[]) => {
  // normalize once
  const roles = allowedRoles.map((r) => r.toLowerCase());

  return (req: Request, res: Response, next: NextFunction): void => {
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

    let decoded: DecodedToken;
    try {
      // NOTE: for production, switch to jwt.verify() with your JWKS or secret
      decoded = jwt.decode(token) as DecodedToken;
      if (!decoded || !decoded.sub) {
        throw new Error("Invalid token payload");
      }
    } catch (err) {
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
