import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import hi from "./locales/hi.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import ru from "./locales/ru.json";
import th from "./locales/th.json";
import zhCN from "./locales/zh-CN.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", native: "English" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "th", label: "Thai", native: "ไทย" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "zh-CN", label: "Simplified Chinese", native: "简体中文" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const LS_KEY = "vrcsm.language";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      ja: { translation: ja },
      ko: { translation: ko },
      ru: { translation: ru },
      th: { translation: th },
      "zh-CN": { translation: zhCN },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LS_KEY,
      caches: ["localStorage"],
    },
  });

export function changeLanguage(lng: SupportedLanguage): Promise<unknown> {
  return i18n.changeLanguage(lng);
}

export default i18n;
