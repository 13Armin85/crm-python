/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ICU from "i18next-icu";
import resourcesToBackend from "i18next-resources-to-backend";
import {
  SUPPORTED_LANGUAGES,
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  getLanguageDirection,
} from "../constants/language";
import { NAMESPACES, DEFAULT_NAMESPACE } from "../constants/namespaces";

import type { i18n as I18nInstance } from "i18next";
import type { TNamespace } from "../constants/namespaces";
import type { TLanguage } from "../types";

export const i18nInstance: I18nInstance = i18n.createInstance();

type TLocaleResources = Record<TNamespace, Record<string, unknown>>;

let faResourcesPromise: Promise<TLocaleResources> | undefined;

const loadLocaleResource = async (language: string, namespace: string) => {
  const locale = SUPPORTED_LANGUAGES.find(({ value }) => value.toLowerCase() === language.toLowerCase())?.value;
  if (!locale) throw new Error(`Unsupported language: ${language}`);

  if (locale === "fa") {
    faResourcesPromise ??= import("./fa-resources").then((module) => module.default);
    const resources = await faResourcesPromise;
    return resources[namespace as TNamespace];
  }

  // The package is consumed from `dist`, so runtime locale files must be
  // resolved next to the built entry point (and are copied there by tsdown).
  // The old `../locales` path escaped `dist` and silently made i18next fall
  // back to Persian whenever another language was selected.
  const localeDirectory = locale === "ka-GE" ? "ka-ge" : locale;
  const resource = await import(`./locales/${localeDirectory}/${namespace}.json`, {
    with: { type: "json" },
  });
  return resource.default;
};

i18nInstance.use(ICU).use(initReactI18next).use(resourcesToBackend(loadLocaleResource));

const initialLng =
  typeof window !== "undefined" ? localStorage.getItem(LANGUAGE_STORAGE_KEY) || FALLBACK_LANGUAGE : FALLBACK_LANGUAGE;

export const initPromise = i18nInstance
  .init({
    lng: initialLng,
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.value),
    ns: NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    // fallbackNS ensures all namespaces are searched for any key, so components
    // don't need to pass NAMESPACES to useTranslation (which triggers re-render cascades).
    fallbackNS: NAMESPACES.filter((ns) => ns !== DEFAULT_NAMESPACE),
    partialBundledLanguages: true,
    keySeparator: ".",
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    // Pinned explicitly even though it's the default — i18next-icu intercepts the
    // format pipeline and returns raw objects regardless of this flag, so the runtime
    // guard in useTranslation is what actually prevents React crashes. Documenting
    // intent here so this isn't accidentally flipped.
    returnObjects: false,
    react: { useSuspense: false },
  })
  // Eagerly pre-load all namespaces for the initial language so they're cached
  // before any component renders. This prevents the re-render cascade that occurs
  // when react-i18next triggers concurrent async loads for unloaded namespaces.
  .then(() => i18nInstance.loadNamespaces(NAMESPACES))
  .then(() => {
    if (typeof document !== "undefined") {
      const language = i18nInstance.resolvedLanguage as TLanguage | undefined;
      const activeLanguage = language ?? FALLBACK_LANGUAGE;
      document.documentElement.lang = activeLanguage;
      document.documentElement.dir = getLanguageDirection(activeLanguage);
    }
  });
