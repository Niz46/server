"use strict";
// File: server/src/controllers/propertyControllers.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProperty = exports.updateProperty = exports.createProperty = exports.getProperty = exports.getProperties = void 0;
const client_1 = require("@prisma/client");
const wkt_1 = require("@terraformer/wkt");
const client_s3_1 = require("@aws-sdk/client-s3");
const axios_1 = __importDefault(require("axios"));
const prisma = new client_1.PrismaClient();
// add after const prisma = new PrismaClient();
function getDbSchema() {
    // Prefer explicit env var DB_SCHEMA; fallback to parsing DATABASE_URL ?schema=...
    let schema = (process.env.DB_SCHEMA || "").trim();
    if (!schema && process.env.DATABASE_URL) {
        const m = process.env.DATABASE_URL.match(/[?&]schema=([a-zA-Z0-9_]+)/);
        if (m)
            schema = m[1];
    }
    if (!schema) {
        // If still missing, fallback to 'public' (but log so you can notice)
        console.warn("DB schema not provided; defaulting to 'public'. Set DB_SCHEMA in your .env");
        schema = "public  ";
    }
    // Validate to avoid SQL injection when we inject schema into SQL strings
    if (!/^[a-zA-Z0-9_]+$/.test(schema)) {
        throw new Error(`Invalid DB schema name: ${schema}`);
    }
    return schema;
}
// Initialize S3 client (ensure AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME are set in .env)
if (!process.env.AWS_REGION) {
    console.error("Missing AWS_REGION in environment");
    process.exit(1);
}
const s3Client = new client_s3_1.S3Client({
    region: process.env.AWS_REGION,
});
/**
 * GET /properties
 * - Optional query parameters: favoriteIds, priceMin, priceMax, beds, baths, propertyType,
 *   squareFeetMin, squareFeetMax, amenities, availableFrom, latitude, longitude
 * - Returns a JSON array of all properties matching the filters.
 */
const getProperties = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { favoriteIds, priceMin, priceMax, beds, baths, propertyType, squareFeetMin, squareFeetMax, amenities, availableFrom, latitude, longitude, } = req.query;
        const where = {};
        // favorites
        if (favoriteIds) {
            const ids = favoriteIds
                .split(",")
                .map((s) => Number(s.trim()))
                .filter((n) => !isNaN(n));
            if (ids.length)
                where.id = { in: ids };
        }
        // price
        if (priceMin || priceMax) {
            where.pricePerMonth = {};
            if (priceMin && !isNaN(Number(priceMin)))
                where.pricePerMonth.gte = Number(priceMin);
            if (priceMax && !isNaN(Number(priceMax)))
                where.pricePerMonth.lte = Number(priceMax);
        }
        // beds / baths / squareFeet
        if (beds && beds !== "any" && !isNaN(Number(beds)))
            where.beds = { gte: Number(beds) };
        if (baths && baths !== "any" && !isNaN(Number(baths)))
            where.baths = { gte: Number(baths) };
        if (squareFeetMin && !isNaN(Number(squareFeetMin))) {
            where.squareFeet = Object.assign(Object.assign({}, (where.squareFeet || {})), { gte: Number(squareFeetMin) });
        }
        if (squareFeetMax && !isNaN(Number(squareFeetMax))) {
            where.squareFeet = Object.assign(Object.assign({}, (where.squareFeet || {})), { lte: Number(squareFeetMax) });
        }
        // propertyType
        if (propertyType && propertyType !== "any")
            where.propertyType = propertyType;
        // amenities (array)
        if (amenities && amenities !== "any") {
            const amenArray = amenities
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            if (amenArray.length)
                where.amenities = { hasSome: amenArray };
        }
        // availableFrom -> has lease with startDate <= date
        if (availableFrom && availableFrom !== "any") {
            const dt = new Date(availableFrom);
            if (!isNaN(dt.getTime()))
                where.leases = { some: { startDate: { lte: dt } } };
        }
        // Geospatial filter: get location IDs via a small schema-qualified raw query (validated)
        if (latitude && longitude) {
            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
                // default radius (km) can be overridden by ?radiusKm=
                const radiusKm = !isNaN(Number(req.query.radiusKm))
                    ? Number(req.query.radiusKm)
                    : 5;
                const meters = Math.round(radiusKm * 1000);
                const schema = getDbSchema(); // validated
                // Cache for detected postgis schema
                let _postgisSchema = null;
                function detectPostgisSchema() {
                    return __awaiter(this, void 0, void 0, function* () {
                        var _a;
                        if (_postgisSchema)
                            return _postgisSchema;
                        try {
                            // Find the schema that contains the 'geography' type
                            const res = (yield prisma.$queryRawUnsafe(`SELECT n.nspname AS schema
              FROM pg_type t
              JOIN pg_namespace n ON t.typnamespace = n.oid
              WHERE t.typname = 'geography'
              LIMIT 1`));
                            const schema = ((_a = res === null || res === void 0 ? void 0 : res[0]) === null || _a === void 0 ? void 0 : _a.schema) || "public";
                            _postgisSchema = schema;
                            console.log("Detected PostGIS schema:", _postgisSchema);
                            return _postgisSchema;
                        }
                        catch (err) {
                            console.warn("Failed to detect PostGIS schema, defaulting to public", err);
                            _postgisSchema = "public";
                            return _postgisSchema;
                        }
                    });
                }
                // Parameterized query: $1 = lng, $2 = lat, $3 = meters
                // Use ::geography for the point so ST_DWithin's distance is in meters.
                const postgisSchema = yield detectPostgisSchema();
                const sql = `
          SELECT id
          FROM "${schema}"."Location"
          WHERE ST_DWithin(
            coordinates,
            ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326)::${postgisSchema}.geography,
            $3
          )
        `;
                const rows = (yield prisma.$queryRawUnsafe(sql, lng, lat, meters));
                const locIds = rows.map((r) => r.id);
                if (locIds.length === 0) {
                    res.status(200).json([]); // nothing nearby
                    return;
                }
                where.locationId = { in: locIds };
            }
        }
        const properties = yield prisma.property.findMany({
            where,
            include: {
                location: true,
                manager: true,
            },
        });
        res.status(200).json(properties);
    }
    catch (err) {
        console.error("Error retrieving properties:", err);
        res
            .status(500)
            .json({ message: `Error retrieving properties: ${err.message}` });
    }
});
exports.getProperties = getProperties;
/**
 * GET /properties/:id
 * - Returns a single property by its ID, including its Location (with GeoJSON coords).
 */
const getProperty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const propertyId = Number(id);
        if (isNaN(propertyId)) {
            res.status(400).json({ message: "Invalid property ID." });
            return;
        }
        const property = yield prisma.property.findUnique({
            where: { id: propertyId },
            include: { location: true },
        });
        if (!property) {
            res.status(404).json({ message: "Property not found." });
            return;
        }
        // Fetch WKT from Location, convert to GeoJSON
        const schema = getDbSchema();
        const coordsResult = (yield prisma.$queryRawUnsafe(`
    SELECT ST_AsText(coordinates) AS coordinates
    FROM "${schema}"."Location"
    WHERE id = ${property.location.id}
  `));
        const wkt = ((_a = coordsResult[0]) === null || _a === void 0 ? void 0 : _a.coordinates) || "";
        let geoJSON = {};
        let [lng, lat] = [0, 0];
        try {
            geoJSON = (0, wkt_1.wktToGeoJSON)(wkt);
            [lng, lat] = geoJSON.coordinates || [0, 0];
        }
        catch (_) {
            // WKT parsing error → default to (0,0)
        }
        const propertyWithCoords = Object.assign(Object.assign({}, property), { location: Object.assign(Object.assign({}, property.location), { coordinates: { longitude: lng, latitude: lat } }) });
        res.status(200).json(propertyWithCoords);
    }
    catch (error) {
        console.error("Error retrieving property:", error);
        res
            .status(500)
            .json({ message: `Error retrieving property: ${error.message}` });
    }
});
exports.getProperty = getProperty;
/**
 * POST /properties
 * - Creates a new Property + Location pair.
 * - Expects multipart/form-data with fields:
 *     • address, city, state, country, postalCode, managerCognitoId, pricePerMonth, securityDeposit, etc.
 *     • photos[] (one or more image files)
 */
const createProperty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const files = req.files;
        const _c = req.body, { address, city, state, country, postalCode, managerCognitoId } = _c, propertyData = __rest(_c, ["address", "city", "state", "country", "postalCode", "managerCognitoId"]);
        // 1) Geocode via Nominatim
        const geocodeURL = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
            street: address,
            city,
            country,
            postalcode: postalCode,
            format: "json",
            limit: "1",
        }).toString()}`;
        const geoResp = yield axios_1.default.get(geocodeURL, {
            headers: { "User-Agent": "RealEstateApp (you@example.com)" },
        });
        let [lon, lat] = [0, 0];
        if (((_a = geoResp.data[0]) === null || _a === void 0 ? void 0 : _a.lon) && ((_b = geoResp.data[0]) === null || _b === void 0 ? void 0 : _b.lat)) {
            lon = parseFloat(geoResp.data[0].lon);
            lat = parseFloat(geoResp.data[0].lat);
        }
        // 2) Insert Location
        const schema = getDbSchema();
        const insertSql = `
    INSERT INTO "${schema}"."Location"
      (address, city, state, country, "postalCode", coordinates)
    VALUES
      ($1, $2, $3, $4, $5,
      ST_SetSRID(
        ST_MakePoint($6::double precision, $7::double precision),
        4326
      )::project_c.geography)
    RETURNING id, address, city, state, country, "postalCode", ST_AsText(coordinates) as coordinates;
  `;
        const [newLocation] = (yield prisma.$queryRawUnsafe(insertSql, address, city, state, country, postalCode, lon, lat));
        // 3) Upload each file to S3 and collect its public URL
        // const photoUrls: string[] = [];
        // if (files && files.length) {
        //   if (!process.env.S3_BUCKET_NAME) {
        //     throw new Error("Missing S3_BUCKET_NAME in environment");
        //   }
        //   for (const file of files) {
        //     const key = `properties/${Date.now()}-${file.originalname}`;
        //     const uploadParams = {
        //       Bucket: process.env.S3_BUCKET_NAME!, // non-null assertion
        //       Key: key,
        //       Body: file.buffer,
        //       ContentType: file.mimetype,
        //     };
        //     const uploadWatch = new Upload({
        //       client: s3Client,
        //       params: uploadParams,
        //     });
        //     const uploadResult = await uploadWatch.done();
        //     // uploadResult.Location is the public URL (if bucket is public)
        //     if (uploadResult.Location) {
        //       photoUrls.push(uploadResult.Location);
        //     }
        //   }
        // }
        // 4) Create the Property record
        const newProperty = yield prisma.property.create({
            data: Object.assign(Object.assign({}, propertyData), { locationId: newLocation.id, managerCognitoId, 
                // photoUrls, // URLs returned by S3 (empty array if none)
                amenities: typeof propertyData.amenities === "string"
                    ? propertyData.amenities.split(",").map((s) => s.trim())
                    : [], highlights: typeof propertyData.highlights === "string"
                    ? propertyData.highlights.split(",").map((s) => s.trim())
                    : [], isPetsAllowed: propertyData.isPetsAllowed === "true", isParkingIncluded: propertyData.isParkingIncluded === "true", pricePerMonth: parseFloat(propertyData.pricePerMonth), securityDeposit: parseFloat(propertyData.securityDeposit), applicationFee: parseFloat(propertyData.applicationFee), beds: parseInt(propertyData.beds, 10), baths: parseFloat(propertyData.baths), squareFeet: parseInt(propertyData.squareFeet, 10) }),
            include: {
                location: true,
                manager: true,
            },
        });
        res.status(201).json(newProperty);
    }
    catch (error) {
        console.error("Error creating property:", error);
        res
            .status(500)
            .json({ message: `Error creating property: ${error.message}` });
    }
});
exports.createProperty = createProperty;
/**
 * PUT /properties/:id
 * - Updates an existing Property by ID.
 * - If new photos are included, it re-uploads them to S3 and appends their URLs.
 */
const updateProperty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const propertyId = Number(id);
        const files = req.files;
        if (isNaN(propertyId)) {
            res.status(400).json({ message: "Invalid property ID." });
            return;
        }
        const existing = yield prisma.property.findUnique({
            where: { id: propertyId },
        });
        if (!existing) {
            res.status(404).json({ message: "Property not found." });
            return;
        }
        const updatedData = req.body;
        const toUpdate = Object.assign({}, updatedData);
        // Handle field conversions
        if (updatedData.amenities && typeof updatedData.amenities === "string") {
            toUpdate.amenities = updatedData.amenities
                .split(",")
                .map((s) => s.trim());
        }
        if (updatedData.highlights && typeof updatedData.highlights === "string") {
            toUpdate.highlights = updatedData.highlights
                .split(",")
                .map((s) => s.trim());
        }
        if (updatedData.pricePerMonth !== undefined) {
            toUpdate.pricePerMonth = parseFloat(updatedData.pricePerMonth);
        }
        if (updatedData.securityDeposit !== undefined) {
            toUpdate.securityDeposit = parseFloat(updatedData.securityDeposit);
        }
        if (updatedData.applicationFee !== undefined) {
            toUpdate.applicationFee = parseFloat(updatedData.applicationFee);
        }
        if (updatedData.beds !== undefined) {
            toUpdate.beds = parseInt(updatedData.beds, 10);
        }
        if (updatedData.baths !== undefined) {
            toUpdate.baths = parseFloat(updatedData.baths);
        }
        if (updatedData.squareFeet !== undefined) {
            toUpdate.squareFeet = parseInt(updatedData.squareFeet, 10);
        }
        if (updatedData.isPetsAllowed !== undefined) {
            toUpdate.isPetsAllowed = updatedData.isPetsAllowed === "true";
        }
        if (updatedData.isParkingIncluded !== undefined) {
            toUpdate.isParkingIncluded = updatedData.isParkingIncluded === "true";
        }
        // Upload new files if provided
        // if (files && files.length) {
        //   if (!process.env.S3_BUCKET_NAME) {
        //     throw new Error("Missing S3_BUCKET_NAME in environment");
        //   }
        //   const newPhotoUrls: string[] = [];
        //   for (const file of files) {
        //     const key = `properties/${Date.now()}-${file.originalname}`;
        //     const uploadParams = {
        //       Bucket: process.env.S3_BUCKET_NAME!, // non-null assertion
        //       Key: key,
        //       Body: file.buffer,
        //       ContentType: file.mimetype,
        //     };
        //     const uploadWatch = new Upload({
        //       client: s3Client,
        //       params: uploadParams,
        //     });
        //     const uploadResult = await uploadWatch.done();
        //     if (uploadResult.Location) {
        //       newPhotoUrls.push(uploadResult.Location);
        //     }
        //   }
        //   // Append to existing URLs
        //   toUpdate.photoUrls = [...existing.photoUrls, ...newPhotoUrls];
        // }
        const result = yield prisma.property.update({
            where: { id: propertyId },
            data: toUpdate,
            include: { location: true, manager: true },
        });
        res.status(200).json(result);
    }
    catch (error) {
        console.error("Error updating property:", error);
        res
            .status(500)
            .json({ message: `Error updating property: ${error.message}` });
    }
});
exports.updateProperty = updateProperty;
/**
 * DELETE /properties/:id
 * - Deletes a property by its ID.
 */
const deleteProperty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const propertyId = Number(id);
        if (isNaN(propertyId)) {
            res.status(400).json({ message: "Invalid property ID." });
            return;
        }
        const existing = yield prisma.property.findUnique({
            where: { id: propertyId },
        });
        if (!existing) {
            res.status(404).json({ message: "Property not found." });
            return;
        }
        yield prisma.property.delete({ where: { id: propertyId } });
        res.status(204).send();
    }
    catch (error) {
        console.error("Error deleting property:", error);
        res
            .status(500)
            .json({ message: `Error deleting property: ${error.message}` });
    }
});
exports.deleteProperty = deleteProperty;
