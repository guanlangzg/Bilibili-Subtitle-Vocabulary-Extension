import type { BuiltinProfileId, ProfileConfig, ProfileId, SettingsV3 } from './settings-normalizer';

// Single source for the SharedSettings guard helpers used by both the overlay
// and popup/options settings bridges, so the two entry bundles resolve the
// same global contract with the same load-time validation semantics.
export function createSharedSettingsGuard<TApi extends object>(missingMessage: string) {
  function readSharedSettings(): TApi | undefined {
    const globalShared =
      typeof globalThis !== 'undefined'
        ? (globalThis as typeof globalThis & { SharedSettings?: TApi }).SharedSettings
        : undefined;
    const windowShared =
      typeof window !== 'undefined'
        ? (window as Window & { SharedSettings?: TApi }).SharedSettings
        : undefined;
    const shared = windowShared || globalShared;
    return shared && typeof shared === 'object' ? shared : undefined;
  }

  function getSharedSettings(): TApi {
    const shared = readSharedSettings();
    if (!shared) {
      throw new Error(missingMessage);
    }
    return shared;
  }

  // Resolved once at guard creation (module load) to keep load-time validation.
  const shared = getSharedSettings();

  function requireSharedSettingsFunction<T extends (...args: never[]) => unknown>(
    name: keyof TApi
  ): T {
    const value = shared[name];
    if (typeof value !== 'function') {
      throw new Error(`${missingMessage}: ${String(name)} must be a function`);
    }
    return value as unknown as T;
  }

  function requireSharedSettingsArray<T>(name: keyof TApi): T[] {
    const value = shared[name];
    if (!Array.isArray(value)) {
      throw new Error(`${missingMessage}: ${String(name)} must be an array`);
    }
    return value.slice() as T[];
  }

  function requireSharedSettingsValue<T>(name: keyof TApi): T {
    const value = shared[name];
    if (value == null) {
      throw new Error(`${missingMessage}: ${String(name)} is missing`);
    }
    return value as T;
  }

  return {
    shared,
    readSharedSettings,
    getSharedSettings,
    requireSharedSettingsFunction,
    requireSharedSettingsArray,
    requireSharedSettingsValue,
  };
}

export interface SharedProfileOption {
  id: ProfileId;
  name: string;
  builtin: boolean;
}

export interface ProfileConfigPatchDeps {
  builtinProfileIds: BuiltinProfileId[];
  normalizeSettingsV3: (value: SettingsV3) => SettingsV3;
  normalizeProfileConfig: (value: unknown) => ProfileConfig;
  getProfileConfigById: (value: SettingsV3, profileId: ProfileId) => ProfileConfig;
}

// Pure helper shared by setActiveProfileConfig implementations in both bridges.
export function applyProfileConfigPatch(
  deps: ProfileConfigPatchDeps,
  settings: SettingsV3,
  profileId: ProfileId,
  patch: Partial<ProfileConfig>
): SettingsV3 {
  const normalized = deps.normalizeSettingsV3(settings);
  const baseProfile = deps.getProfileConfigById(normalized, profileId);
  const nextProfile = deps.normalizeProfileConfig({
    ...baseProfile,
    ...patch,
  });
  const next = JSON.parse(JSON.stringify(normalized)) as SettingsV3;
  if (deps.builtinProfileIds.includes(profileId as BuiltinProfileId)) {
    next.profilesBuiltin[profileId as BuiltinProfileId] = nextProfile;
  } else {
    next.profilesCustom = next.profilesCustom.map((item) =>
      item.id === profileId ? { ...item, config: nextProfile, updatedAt: Date.now() } : item
    );
  }
  return deps.normalizeSettingsV3(next);
}

// Pure helper shared by listProfileOptions implementations in both bridges;
// the builtin id list and label source are the only parts the entries differ in.
export function listProfileOptionsWithLabels(
  builtinProfileIds: BuiltinProfileId[],
  settings: SettingsV3,
  builtinLabel: (profileId: BuiltinProfileId) => string
): SharedProfileOption[] {
  const builtins: SharedProfileOption[] = builtinProfileIds.map((id) => ({
    id,
    name: builtinLabel(id),
    builtin: true,
  }));
  const custom: SharedProfileOption[] = settings.profilesCustom.map((item) => ({
    id: item.id,
    name: item.name,
    builtin: false,
  }));
  return [...builtins, ...custom];
}
