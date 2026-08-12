import { createDb } from "../database/db.ts";
import { StudioRepository } from "../core/repository.ts";

/** A fresh, in-memory StudioRepository for tests. */
export function newTestRepo(): StudioRepository {
  return new StudioRepository(createDb(":memory:"));
}
