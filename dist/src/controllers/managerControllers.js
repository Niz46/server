"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getManagerProperties = exports.updateManager = exports.createManager = exports.getManager = void 0;
const client_1 = require("@prisma/client");
const wkt_1 = require("@terraformer/wkt");
const prisma = new client_1.PrismaClient();
/**
 * Return the DB schema name to use. Prefer env var DB_SCHEMA, then parse DATABASE_URL.
 * Validates the result to avoid SQL injection when interpolating schema names into SQL.
 */
function getDbSchema() {
    let schema = (process.env.DB_SCHEMA || "").trim();
    if (!schema && process.env.DATABASE_URL) {
        const m = process.env.DATABASE_URL.match(/[?&]schema=([a-zA-Z0-9_]+)/);
        if (m)
            schema = m[1];
    }
    if (!schema) {
        console.warn("DB schema not provided; defaulting to 'public'. Set DB_SCHEMA in .env");
        schema = "public";
    }
    // simple validation: only allow alphanumeric and underscore
    if (!/^[a-zA-Z0-9_]+$/.test(schema)) {
        throw new Error(`Invalid DB schema name: ${schema}`);
    }
    return schema;
}
const getManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { cognitoId } = req.params;
        const manager = yield prisma.manager.findUnique({
            where: { cognitoId },
        });
        if (manager) {
            res.json(manager);
        }
        else {
            res.status(404).json({ message: "Manager not found" });
        }
    }
    catch (error) {
        res
            .status(500)
            .json({ message: `Error retrieving manager: ${error.message}` });
    }
});
exports.getManager = getManager;
const createManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { cognitoId, name, email, phoneNumber } = req.body;
        const manager = yield prisma.manager.create({
            data: {
                cognitoId,
                name,
                email,
                phoneNumber,
            },
        });
        res.status(201).json(manager);
    }
    catch (error) {
        res
            .status(500)
            .json({ message: `Error creating manager: ${error.message}` });
    }
});
exports.createManager = createManager;
const updateManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { cognitoId } = req.params;
        const { name, email, phoneNumber } = req.body;
        const updateManager = yield prisma.manager.update({
            where: { cognitoId },
            data: {
                name,
                email,
                phoneNumber,
            },
        });
        res.json(updateManager);
    }
    catch (error) {
        res
            .status(500)
            .json({ message: `Error updating manager: ${error.message}` });
    }
});
exports.updateManager = updateManager;
const getManagerProperties = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { cognitoId } = req.params;
        const properties = yield prisma.property.findMany({
            where: { managerCognitoId: cognitoId },
            include: {
                location: true,
            },
        });
        const schema = getDbSchema(); // validated schema name
        const propertiesWithFormattedLocation = yield Promise.all(properties.map((property) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            try {
                // If location is missing for some reason, skip the raw query and return property as-is
                if (!property.location ||
                    property.location.id === undefined ||
                    property.location.id === null) {
                    return property;
                }
                // Schema is validated in getDbSchema(), so it's safe to interpolate here
                const sql = `
            SELECT ST_AsText(coordinates) AS coordinates
            FROM "${schema}"."Location"
            WHERE id = $1
            LIMIT 1
          `;
                // Pass the id as a parameter to avoid injection in values
                const coordsResult = (yield prisma.$queryRawUnsafe(sql, property.location.id));
                const wkt = ((_a = coordsResult === null || coordsResult === void 0 ? void 0 : coordsResult[0]) === null || _a === void 0 ? void 0 : _a.coordinates) || "";
                let geoJSON = {};
                let longitude = 0;
                let latitude = 0;
                if (wkt) {
                    try {
                        geoJSON = (0, wkt_1.wktToGeoJSON)(wkt);
                        // wktToGeoJSON returns [lon, lat] for Point
                        if (Array.isArray(geoJSON.coordinates) &&
                            geoJSON.coordinates.length >= 2) {
                            longitude = geoJSON.coordinates[0];
                            latitude = geoJSON.coordinates[1];
                        }
                    }
                    catch (e) {
                        console.warn(`WKT -> GeoJSON conversion failed for location id=${property.location.id}`, e);
                    }
                }
                return Object.assign(Object.assign({}, property), { location: Object.assign(Object.assign({}, property.location), { coordinates: { longitude, latitude } }) });
            }
            catch (innerErr) {
                // Don't fail the whole response because of a single location; log and return property as-is
                console.error(`Failed to format location for property id=${property.id}:`, innerErr);
                return property;
            }
        })));
        res.json(propertiesWithFormattedLocation);
    }
    catch (err) {
        console.error("Error retrieving manager properties:", err);
        res
            .status(500)
            .json({ message: `Error retrieving manager properties: ${err.message}` });
    }
});
exports.getManagerProperties = getManagerProperties;
