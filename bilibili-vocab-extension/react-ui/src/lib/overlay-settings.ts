import type {
  BuiltinProfileId,
  ProfileConfig,
  ProfileId,
  ReviewDanmakuDensity,
  ReviewDanmakuSpeed,
  SettingsV3,
} from './settings-normalizer';
import {
  applyProfileConfigPatch,
  createSharedSettingsGuard,
  listProfileOptionsWithLabels,
} from './settings-bridge-core';

type OverlaySharedSettingsApi = {
  SETTINGS_STORAGE_KEY_V3: string;
  BUILTIN_PROFILE_IDS: BuiltinProfileId[];
  CEFR_LEVELS: string[];
  REVIEW_SPEEDS: ReviewDanmakuSpeed[];
  REVIEW_DENSITIES: ReviewDanmakuDensity[];
  normalizeProfileConfig: (value: unknown) => ProfileConfig;
  normalizeSettingsV3: (value: unknown) => SettingsV3;
  migrateToV3: (value: unknown) => SettingsV3;
  getProfileConfigById: (value: SettingsV3, profileId: ProfileId) => ProfileConfig;
};

type ProfileOption = { id: ProfileId; name: string; builtin: boolean };

const PROFILE_LABELS: Record<BuiltinProfileId, string> = {
  gentle: '轻量输入',
  balanced: '均衡输入',
  intensive: '强化曝光',
};

const SHARED_SETTINGS_ERROR =
  'SharedSettings is required before React overlay settings bridge loads';

const { requireSharedSettingsFunction, requireSharedSettingsArray, requireSharedSettingsValue } =
  createSharedSettingsGuard<OverlaySharedSettingsApi>(SHARED_SETTINGS_ERROR);

// Legacy storage key retained for backward compatibility with existing installs.
export const SETTINGS_STORAGE_KEY_V3 =
  requireSharedSettingsValue<string>('SETTINGS_STORAGE_KEY_V3');
export const BUILTIN_PROFILE_IDS =
  requireSharedSettingsArray<BuiltinProfileId>('BUILTIN_PROFILE_IDS');
export const CEFR_LEVELS = requireSharedSettingsArray<string>('CEFR_LEVELS');
export const REVIEW_SPEEDS = requireSharedSettingsArray<ReviewDanmakuSpeed>('REVIEW_SPEEDS');
export const REVIEW_DENSITIES =
  requireSharedSettingsArray<ReviewDanmakuDensity>('REVIEW_DENSITIES');

export type { ProfileConfig, SettingsV3 };

export function normalizeSettingsV3(input: unknown): SettingsV3 {
  return requireSharedSettingsFunction<OverlaySharedSettingsApi['normalizeSettingsV3']>(
    'normalizeSettingsV3'
  )(input);
}

export function migrateToV3(input: unknown): SettingsV3 {
  return requireSharedSettingsFunction<OverlaySharedSettingsApi['migrateToV3']>('migrateToV3')(
    input
  );
}

export function getProfileConfigById(settings: SettingsV3, profileId: ProfileId): ProfileConfig {
  return requireSharedSettingsFunction<OverlaySharedSettingsApi['getProfileConfigById']>(
    'getProfileConfigById'
  )(settings, profileId);
}

export function setActiveProfileConfig(
  settings: SettingsV3,
  profileId: ProfileId,
  patch: Partial<ProfileConfig>
): SettingsV3 {
  return applyProfileConfigPatch(
    {
      builtinProfileIds: BUILTIN_PROFILE_IDS,
      normalizeSettingsV3,
      normalizeProfileConfig:
        requireSharedSettingsFunction<OverlaySharedSettingsApi['normalizeProfileConfig']>(
          'normalizeProfileConfig'
        ),
      getProfileConfigById,
    },
    settings,
    profileId,
    patch
  );
}

export function listProfileOptions(settings: SettingsV3): ProfileOption[] {
  return listProfileOptionsWithLabels(BUILTIN_PROFILE_IDS, settings, (id) => PROFILE_LABELS[id]);
}
