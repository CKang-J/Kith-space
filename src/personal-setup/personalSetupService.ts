import {
  getHumanProfile,
  getSpaceRecordBySlug,
  type HumanProfile,
  type SpaceRecord,
} from "../app-data/appDatabase.js";
import { ensurePersonalApp } from "../db/personalApp.js";

const HOME_SLUG = "home";
const ALLOWED_FIELDS = new Set(["name", "email", "description"]);

export interface PersonalSetupHuman {
  id: string;
  name: string;
  email: string | null;
  description: string | null;
}

export interface PersonalSetupHome {
  id: string;
  name: string;
  slug: string;
}

export type PersonalSetupStatus =
  | { initialized: false; human?: PersonalSetupHuman }
  | { initialized: true; human: PersonalSetupHuman; home: PersonalSetupHome };

export class PersonalSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalSetupError";
  }
}

function setupHuman(human: HumanProfile): PersonalSetupHuman {
  return {
    id: human.id,
    name: human.name,
    email: human.email,
    description: human.description,
  };
}

function setupHome(home: Pick<SpaceRecord, "id" | "name" | "slug">): PersonalSetupHome {
  return { id: home.id, name: home.name, slug: home.slug };
}

function requireInitializeInput(input: unknown): {
  name: string;
  email?: string | null;
  description?: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PersonalSetupError("request body must be an object");
  }
  const body = input as Record<string, unknown>;
  const unknownField = Object.keys(body).find((field) => !ALLOWED_FIELDS.has(field));
  if (unknownField) throw new PersonalSetupError(`unknown setup field: ${unknownField}`);
  return {
    name: body.name as string,
    email: body.email as string | null | undefined,
    description: body.description as string | null | undefined,
  };
}

/** Owns the one-time Human and Home initialization lifecycle. */
export class PersonalSetupService {
  getStatus(): PersonalSetupStatus {
    const human = getHumanProfile();
    const home = getSpaceRecordBySlug(HOME_SLUG);
    if (human && home) {
      return { initialized: true, human: setupHuman(human), home: setupHome(home) };
    }
    return human ? { initialized: false, human: setupHuman(human) } : { initialized: false };
  }

  async initialize(input: unknown): Promise<Extract<PersonalSetupStatus, { initialized: true }>> {
    const values = requireInitializeInput(input);
    const current = this.getStatus();
    if (current.initialized) return current;

    const { human, home } = await ensurePersonalApp(values);
    return { initialized: true, human: setupHuman(human), home: setupHome(home) };
  }
}
