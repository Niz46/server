// File: server/src/controllers/propertyControllers.ts
import { Request, Response } from "express";
import { PrismaClient, Prisma, Location } from "@prisma/client";
import { wktToGeoJSON } from "@terraformer/wkt";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import axios from "axios";

const prisma = new PrismaClient();

// Initialize S3 client (ensure AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME are set in .env)
if (!process.env.AWS_REGION) {
  console.error("Missing AWS_REGION in environment");
  process.exit(1);
}
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
});

/**
 * GET /properties
 * - Optional query parameters: favoriteIds, priceMin, priceMax, beds, baths, propertyType,
 *   squareFeetMin, squareFeetMax, amenities, availableFrom, latitude, longitude
 * - Returns a JSON array of all properties matching the filters.
 */
export const getProperties = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      favoriteIds,
      priceMin,
      priceMax,
      beds,
      baths,
      propertyType,
      squareFeetMin,
      squareFeetMax,
      amenities,
      availableFrom,
      latitude,
      longitude,
      radiusKm,
    } = req.query;

    // Build a Prisma "where" object (safe)
    const where: any = {};

    // favorites -> id IN (...)
    if (favoriteIds) {
      const ids = (favoriteIds as string)
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => !isNaN(n));
      if (ids.length) where.id = { in: ids };
    }

    // price range
    if (priceMin || priceMax) {
      where.pricePerMonth = {};
      const pm = Number(priceMin);
      const pM = Number(priceMax);
      if (!isNaN(pm)) where.pricePerMonth.gte = pm;
      if (!isNaN(pM)) where.pricePerMonth.lte = pM;
    }

    // beds / baths
    if (beds && beds !== "any") {
      const b = Number(beds);
      if (!isNaN(b)) where.beds = { gte: b };
    }
    if (baths && baths !== "any") {
      const bt = Number(baths);
      if (!isNaN(bt)) where.baths = { gte: bt };
    }

    // square feet
    if (squareFeetMin || squareFeetMax) {
      where.squareFeet = {};
      const sfMin = Number(squareFeetMin);
      const sfMax = Number(squareFeetMax);
      if (!isNaN(sfMin)) where.squareFeet.gte = sfMin;
      if (!isNaN(sfMax)) where.squareFeet.lte = sfMax;
    }

    // propertyType
    if (propertyType && propertyType !== "any") {
      where.propertyType = propertyType;
    }

    // amenities (use Prisma array filter)
    if (amenities && amenities !== "any") {
      const amenArray = (amenities as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (amenArray.length) {
        // hasEvery => property must have all requested amenities
        where.amenities = { hasEvery: amenArray };
      }
    }

    // Handle availableFrom properly:
    // A property is considered available on a date if it is NOT occupied by a lease that covers that date.
    if (availableFrom && availableFrom !== "any") {
      const dt = new Date(availableFrom as string);
      if (!isNaN(dt.getTime())) {
        // Find propertyIds that ARE occupied on that date
        const occupied =
          (await prisma.$queryRaw<
            { propertyId: number }[]
          >`SELECT DISTINCT "propertyId" FROM "Lease" WHERE ${dt.toISOString()}::timestamp BETWEEN "startDate" AND "endDate";`) ||
          [];

        const occupiedIds = occupied.map((r) => r.propertyId);
        // Exclude occupied property IDs
        if (occupiedIds.length) {
          // respect any existing where.id condition
          if (where.id && where.id.in) {
            // intersect in & notIn logic
            where.id = {
              in: (where.id.in as number[]).filter(
                (i: number) => !occupiedIds.includes(i)
              ),
            };
          } else {
            where.id = { notIn: occupiedIds };
          }
        }
      }
    }

    // Geospatial filter: if latitude & longitude provided, find property IDs within radius (meters),
    // then constrain `where.id.in` to those IDs. This avoids complex SQL assembly.
    if (latitude && longitude) {
      const lat = parseFloat(latitude as string);
      const lng = parseFloat(longitude as string);
      if (!isNaN(lat) && !isNaN(lng)) {
        const rk = !isNaN(Number(radiusKm)) ? Number(radiusKm) : 5;
        const meters = rk * 1000;

        // Use geography to get accurate meters distance
        const nearby =
          (await prisma.$queryRaw<{ id: number }[]>`SELECT p.id
            FROM "Property" p
            JOIN "Location" l ON p."locationId" = l.id
            WHERE ST_DWithin(
              l.coordinates::geography,
              ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography,
              ${meters}::double precision
            );`) || [];

        const nearbyIds = nearby.map((r) => r.id);
        // If no nearby IDs, return empty result immediately
        if (nearbyIds.length === 0) {
          res.status(200).json([]);
          return;
        }
        // merge with existing where.id
        if (where.id && where.id.in) {
          where.id = {
            in: (where.id.in as number[]).filter((i) => nearbyIds.includes(i)),
          };
        } else {
          where.id = { in: nearbyIds };
        }
      }
    }

    // Finally query with Prisma client (safe)
    const properties = await prisma.property.findMany({
      where,
      include: {
        location: true,
        manager: true,
      },
      orderBy: { postedDate: "desc" },
      take: 1000,
    });

    // Attach numeric coordinates (ST_X/ST_Y) for each property location (like your existing endpoints)
    const enhanced = await Promise.all(
      properties.map(async (p) => {
        const coords =
          (await prisma.$queryRaw<
            { longitude: number; latitude: number }[]
          >`SELECT ST_X(coordinates::geometry) AS longitude, ST_Y(coordinates::geometry) AS latitude FROM "Location" WHERE id = ${p.locationId};`) ||
          [];

        return {
          ...p,
          location: {
            ...p.location,
            coordinates: (coords[0] && {
              longitude: Number(coords[0].longitude),
              latitude: Number(coords[0].latitude),
            }) || { longitude: 0, latitude: 0 },
          },
        };
      })
    );

    res.status(200).json(enhanced);
  } catch (error: any) {
    console.error("Error retrieving properties (new handler):", error);
    res
      .status(500)
      .json({ message: `Error retrieving properties: ${error.message}` });
  }
};

/**
 * GET /properties/:id
 * - Returns a single property by its ID, including its Location (with GeoJSON coords).
 */
export const getProperty = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const propertyId = Number(id);

    if (isNaN(propertyId)) {
      res.status(400).json({ message: "Invalid property ID." });
      return;
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      include: { location: true },
    });

    if (!property) {
      res.status(404).json({ message: "Property not found." });
      return;
    }

    // Fetch WKT from Location, convert to GeoJSON
    const coordsResult = (await prisma.$queryRaw<{ coordinates: string }[]>`
      SELECT ST_AsText(coordinates) AS coordinates
      FROM "Location"
      WHERE id = ${property.location.id}
    `) as { coordinates: string }[];

    const wkt = coordsResult[0]?.coordinates || "";
    let geoJSON: any = {};
    let [lng, lat] = [0, 0];
    try {
      geoJSON = wktToGeoJSON(wkt);
      [lng, lat] = geoJSON.coordinates || [0, 0];
    } catch (_) {
      // WKT parsing error -> default to (0,0)
    }

    const propertyWithCoords = {
      ...property,
      location: {
        ...property.location,
        coordinates: { longitude: lng, latitude: lat },
      },
    };

    res.status(200).json(propertyWithCoords);
  } catch (error: any) {
    console.error("Error retrieving property:", error);
    res
      .status(500)
      .json({ message: `Error retrieving property: ${error.message}` });
  }
};

/**
 * POST /properties
 */
export const createProperty = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const {
      address,
      city,
      state,
      country,
      postalCode,
      managerCognitoId,
      ...propertyData
    } = req.body;

    // 1) Geocode via Nominatim
    const geocodeURL = `https://nominatim.openstreetmap.org/search?${new URLSearchParams(
      {
        street: address,
        city,
        country,
        postalcode: postalCode,
        format: "json",
        limit: "1",
      }
    ).toString()}`;

    const geoResp = await axios.get(geocodeURL, {
      headers: { "User-Agent": "RealEstateApp (you@example.com)" },
    });

    let [lon, lat] = [0, 0];
    if (geoResp.data[0]?.lon && geoResp.data[0]?.lat) {
      lon = parseFloat(geoResp.data[0].lon);
      lat = parseFloat(geoResp.data[0].lat);
    }

    // 2) Insert Location (unqualified PostGIS functions and explicit geometry usage)
    const [newLocation] = (await prisma.$queryRaw<Location[]>`
      INSERT INTO "Location" (address, city, state, country, "postalCode", coordinates)
      VALUES (
        ${address},
        ${city},
        ${state},
        ${country},
        ${postalCode},
        ST_SetSRID(ST_MakePoint(${lon}::double precision, ${lat}::double precision), 4326)
      )
      RETURNING id, address, city, state, country, "postalCode", ST_AsText(coordinates) as coordinates;
    `) as Location[];

    // 3) (Optional) upload files to S3 — left commented as in your original
    // ...

    // 4) Create property record
    const newProperty = await prisma.property.create({
      data: {
        ...propertyData,
        locationId: newLocation.id,
        managerCognitoId,
        amenities:
          typeof propertyData.amenities === "string"
            ? propertyData.amenities.split(",").map((s: string) => s.trim())
            : [],
        highlights:
          typeof propertyData.highlights === "string"
            ? propertyData.highlights.split(",").map((s: string) => s.trim())
            : [],
        isPetsAllowed: propertyData.isPetsAllowed === "true",
        isParkingIncluded: propertyData.isParkingIncluded === "true",
        pricePerMonth: parseFloat(propertyData.pricePerMonth),
        securityDeposit: parseFloat(propertyData.securityDeposit),
        applicationFee: parseFloat(propertyData.applicationFee),
        beds: parseInt(propertyData.beds, 10),
        baths: parseFloat(propertyData.baths),
        squareFeet: parseInt(propertyData.squareFeet, 10),
      },
      include: {
        location: true,
        manager: true,
      },
    });

    res.status(201).json(newProperty);
  } catch (error: any) {
    console.error("Error creating property:", error);
    res
      .status(500)
      .json({ message: `Error creating property: ${error.message}` });
  }
};

// updateProperty and deleteProperty unchanged (use your prior implementations)

/**
 * PUT /properties/:id
 * - Updates an existing Property by ID.
 * - If new photos are included, it re-uploads them to S3 and appends their URLs.
 */
export const updateProperty = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const propertyId = Number(id);
    const files = req.files as Express.Multer.File[];

    if (isNaN(propertyId)) {
      res.status(400).json({ message: "Invalid property ID." });
      return;
    }

    const existing = await prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!existing) {
      res.status(404).json({ message: "Property not found." });
      return;
    }

    const updatedData = req.body;
    const toUpdate: any = { ...updatedData };

    // Handle field conversions
    if (updatedData.amenities && typeof updatedData.amenities === "string") {
      toUpdate.amenities = (updatedData.amenities as string)
        .split(",")
        .map((s) => s.trim());
    }
    if (updatedData.highlights && typeof updatedData.highlights === "string") {
      toUpdate.highlights = (updatedData.highlights as string)
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

    const result = await prisma.property.update({
      where: { id: propertyId },
      data: toUpdate,
      include: { location: true, manager: true },
    });

    res.status(200).json(result);
  } catch (error: any) {
    console.error("Error updating property:", error);
    res
      .status(500)
      .json({ message: `Error updating property: ${error.message}` });
  }
};

/**
 * DELETE /properties/:id
 * - Deletes a property by its ID.
 */
export const deleteProperty = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const propertyId = Number(id);

    if (isNaN(propertyId)) {
      res.status(400).json({ message: "Invalid property ID." });
      return;
    }

    const existing = await prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!existing) {
      res.status(404).json({ message: "Property not found." });
      return;
    }

    await prisma.property.delete({ where: { id: propertyId } });
    res.status(204).send();
  } catch (error: any) {
    console.error("Error deleting property:", error);
    res
      .status(500)
      .json({ message: `Error deleting property: ${error.message}` });
  }
};
