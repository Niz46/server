import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { wktToGeoJSON } from "@terraformer/wkt";

const prisma = new PrismaClient();
/**
 * Return the DB schema name to use. Prefer env var DB_SCHEMA, then parse DATABASE_URL.
 * Validates the result to avoid SQL injection when interpolating schema names into SQL.
 */
function getDbSchema(): string {
  let schema = (process.env.DB_SCHEMA || "").trim();

  if (!schema && process.env.DATABASE_URL) {
    const m = process.env.DATABASE_URL.match(/[?&]schema=([a-zA-Z0-9_]+)/);
    if (m) schema = m[1];
  }

  if (!schema) {
    console.warn(
      "DB schema not provided; defaulting to 'public'. Set DB_SCHEMA in .env"
    );
    schema = "public";
  }

  // simple validation: only allow alphanumeric and underscore
  if (!/^[a-zA-Z0-9_]+$/.test(schema)) {
    throw new Error(`Invalid DB schema name: ${schema}`);
  }

  return schema;
}

export const getManager = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { cognitoId } = req.params;
    const manager = await prisma.manager.findUnique({
      where: { cognitoId },
    });

    if (manager) {
      res.json(manager);
    } else {
      res.status(404).json({ message: "Manager not found" });
    }
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `Error retrieving manager: ${error.message}` });
  }
};

export const createManager = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { cognitoId, name, email, phoneNumber } = req.body;

    const manager = await prisma.manager.create({
      data: {
        cognitoId,
        name,
        email,
        phoneNumber,
      },
    });

    res.status(201).json(manager);
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `Error creating manager: ${error.message}` });
  }
};

export const updateManager = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { cognitoId } = req.params;
    const { name, email, phoneNumber } = req.body;

    const updateManager = await prisma.manager.update({
      where: { cognitoId },
      data: {
        name,
        email,
        phoneNumber,
      },
    });

    res.json(updateManager);
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `Error updating manager: ${error.message}` });
  }
};

export const getManagerProperties = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { cognitoId } = req.params;
    const properties = await prisma.property.findMany({
      where: { managerCognitoId: cognitoId },
      include: {
        location: true,
      },
    });

    const schema = getDbSchema(); // validated schema name

    const propertiesWithFormattedLocation = await Promise.all(
      properties.map(async (property) => {
        try {
          // If location is missing for some reason, skip the raw query and return property as-is
          if (
            !property.location ||
            property.location.id === undefined ||
            property.location.id === null
          ) {
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
          const coordsResult = (await prisma.$queryRawUnsafe<
            { coordinates: string }[]
          >(sql, property.location.id)) as { coordinates: string }[];

          const wkt = coordsResult?.[0]?.coordinates || "";
          let geoJSON: any = {};
          let longitude = 0;
          let latitude = 0;

          if (wkt) {
            try {
              geoJSON = wktToGeoJSON(wkt);
              // wktToGeoJSON returns [lon, lat] for Point
              if (
                Array.isArray(geoJSON.coordinates) &&
                geoJSON.coordinates.length >= 2
              ) {
                longitude = geoJSON.coordinates[0];
                latitude = geoJSON.coordinates[1];
              }
            } catch (e) {
              console.warn(
                `WKT -> GeoJSON conversion failed for location id=${property.location.id}`,
                e
              );
            }
          }

          return {
            ...property,
            location: {
              ...property.location,
              coordinates: { longitude, latitude },
            },
          };
        } catch (innerErr) {
          // Don't fail the whole response because of a single location; log and return property as-is
          console.error(
            `Failed to format location for property id=${property.id}:`,
            innerErr
          );
          return property;
        }
      })
    );

    res.json(propertiesWithFormattedLocation);
  } catch (err: any) {
    console.error("Error retrieving manager properties:", err);
    res
      .status(500)
      .json({ message: `Error retrieving manager properties: ${err.message}` });
  }
};
