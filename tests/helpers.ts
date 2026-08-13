import { createDb } from "../database/db.ts";
import { GuildRepository } from "../core/repository.ts";

/** A fresh, in-memory GuildRepository for tests. */
export function newTestRepo(): GuildRepository {
  return new GuildRepository(createDb(":memory:"));
}
