/**
 * The languages Higgs speaks.
 *
 * Taken from https://docs.boson.ai/models/higgs-tts/languages — 85 at high quality
 * (WER/CER under 5) and 17 at standard quality (5–10). The docs list names, not codes, so
 * the ISO-639-1 codes here are the standard ones; a handful of the languages have no
 * 639-1 code at all, which matters because the transcription hint only accepts 639-1.
 * Those are still offered as a reply language, where the name is what does the work.
 */

export type Language = {
  name: string;
  /** ISO-639-1. Absent where the language has no two-letter code. */
  code?: string;
  /** Boson's own quality tier for this language. */
  tier: "high" | "standard";
  /**
   * ISO 3166-1 alpha-2 of the flag shown beside it. A language is not a country, so this
   * is the flag people associate with it rather than a claim about where it is spoken.
   * Absent for Esperanto and Latin, which belong to no country.
   */
  flag?: string;
};

export const LANGUAGES: Language[] = [
  { name: "Afrikaans", code: "af", tier: "high", flag: "za" },
  { name: "Arabic", code: "ar", tier: "high", flag: "sa" },
  { name: "Armenian", code: "hy", tier: "high", flag: "am" },
  { name: "Assamese", code: "as", tier: "high", flag: "in" },
  { name: "Asturian", tier: "high", flag: "es" },
  { name: "Azerbaijani", code: "az", tier: "high", flag: "az" },
  { name: "Bashkir", code: "ba", tier: "high", flag: "ru" },
  { name: "Basque", code: "eu", tier: "high", flag: "es" },
  { name: "Belarusian", code: "be", tier: "high", flag: "by" },
  { name: "Bengali", code: "bn", tier: "high", flag: "bd" },
  { name: "Bosnian", code: "bs", tier: "high", flag: "ba" },
  { name: "Bulgarian", code: "bg", tier: "high", flag: "bg" },
  { name: "Catalan", code: "ca", tier: "high", flag: "es" },
  { name: "Cebuano", tier: "high", flag: "ph" },
  { name: "Central Kurdish", code: "ku", tier: "high", flag: "iq" },
  { name: "Chinese", code: "zh", tier: "high", flag: "cn" },
  { name: "Croatian", code: "hr", tier: "high", flag: "hr" },
  { name: "Czech", code: "cs", tier: "high", flag: "cz" },
  { name: "Danish", code: "da", tier: "high", flag: "dk" },
  { name: "Dutch", code: "nl", tier: "high", flag: "nl" },
  { name: "Eastern Mari", tier: "high", flag: "ru" },
  { name: "English", code: "en", tier: "high", flag: "gb" },
  { name: "Esperanto", code: "eo", tier: "high"  },
  { name: "Estonian", code: "et", tier: "high", flag: "ee" },
  { name: "Finnish", code: "fi", tier: "high", flag: "fi" },
  { name: "French", code: "fr", tier: "high", flag: "fr" },
  { name: "Galician", code: "gl", tier: "high", flag: "es" },
  { name: "Georgian", code: "ka", tier: "high", flag: "ge" },
  { name: "German", code: "de", tier: "high", flag: "de" },
  { name: "Greek", code: "el", tier: "high", flag: "gr" },
  { name: "Gujarati", code: "gu", tier: "high", flag: "in" },
  { name: "Haitian Creole", code: "ht", tier: "high", flag: "ht" },
  { name: "Hausa", code: "ha", tier: "high", flag: "ng" },
  { name: "Hebrew", code: "he", tier: "high", flag: "il" },
  { name: "Hindi", code: "hi", tier: "high", flag: "in" },
  { name: "Hungarian", code: "hu", tier: "high", flag: "hu" },
  { name: "Indonesian", code: "id", tier: "high", flag: "id" },
  { name: "Italian", code: "it", tier: "high", flag: "it" },
  { name: "Japanese", code: "ja", tier: "high", flag: "jp" },
  { name: "Javanese", code: "jv", tier: "high", flag: "id" },
  { name: "Kannada", code: "kn", tier: "high", flag: "in" },
  { name: "Kazakh", code: "kk", tier: "high", flag: "kz" },
  { name: "Kinyarwanda", code: "rw", tier: "high", flag: "rw" },
  { name: "Korean", code: "ko", tier: "high", flag: "kr" },
  { name: "Kyrgyz", code: "ky", tier: "high", flag: "kg" },
  { name: "Latvian", code: "lv", tier: "high", flag: "lv" },
  { name: "Lingala", code: "ln", tier: "high", flag: "cd" },
  { name: "Lithuanian", code: "lt", tier: "high", flag: "lt" },
  { name: "Luo", tier: "high", flag: "ke" },
  { name: "Macedonian", code: "mk", tier: "high", flag: "mk" },
  { name: "Malay", code: "ms", tier: "high", flag: "my" },
  { name: "Malayalam", code: "ml", tier: "high", flag: "in" },
  { name: "Maltese", code: "mt", tier: "high", flag: "mt" },
  { name: "Māori", code: "mi", tier: "high", flag: "nz" },
  { name: "Marathi", code: "mr", tier: "high", flag: "in" },
  { name: "Mongolian", code: "mn", tier: "high", flag: "mn" },
  { name: "Nepali", code: "ne", tier: "high", flag: "np" },
  { name: "Norwegian", code: "no", tier: "high", flag: "no" },
  { name: "Occitan", code: "oc", tier: "high", flag: "fr" },
  { name: "Persian", code: "fa", tier: "high", flag: "ir" },
  { name: "Polish", code: "pl", tier: "high", flag: "pl" },
  { name: "Portuguese", code: "pt", tier: "high", flag: "pt" },
  { name: "Romanian", code: "ro", tier: "high", flag: "ro" },
  { name: "Russian", code: "ru", tier: "high", flag: "ru" },
  { name: "Sepedi", tier: "high", flag: "za" },
  { name: "Serbian", code: "sr", tier: "high", flag: "rs" },
  { name: "Shona", code: "sn", tier: "high", flag: "zw" },
  { name: "Slovak", code: "sk", tier: "high", flag: "sk" },
  { name: "Slovene", code: "sl", tier: "high", flag: "si" },
  { name: "Spanish", code: "es", tier: "high", flag: "es" },
  { name: "Swahili", code: "sw", tier: "high", flag: "ke" },
  { name: "Swedish", code: "sv", tier: "high", flag: "se" },
  { name: "Tagalog", code: "tl", tier: "high", flag: "ph" },
  { name: "Tajik", code: "tg", tier: "high", flag: "tj" },
  { name: "Tamil", code: "ta", tier: "high", flag: "in" },
  { name: "Telugu", code: "te", tier: "high", flag: "in" },
  { name: "Thai", code: "th", tier: "high", flag: "th" },
  { name: "Turkish", code: "tr", tier: "high", flag: "tr" },
  { name: "Ukrainian", code: "uk", tier: "high", flag: "ua" },
  { name: "Urdu", code: "ur", tier: "high", flag: "pk" },
  { name: "Uyghur", code: "ug", tier: "high", flag: "cn" },
  { name: "Uzbek", code: "uz", tier: "high", flag: "uz" },
  { name: "Vietnamese", code: "vi", tier: "high", flag: "vn" },
  { name: "Xhosa", code: "xh", tier: "high", flag: "za" },
  { name: "Zulu", code: "zu", tier: "high", flag: "za" },

  { name: "Albanian", code: "sq", tier: "standard", flag: "al" },
  { name: "Chichewa", code: "ny", tier: "standard", flag: "mw" },
  { name: "Eastern Punjabi", code: "pa", tier: "standard", flag: "in" },
  { name: "Ganda", code: "lg", tier: "standard", flag: "ug" },
  { name: "Icelandic", code: "is", tier: "standard", flag: "is" },
  { name: "Irish", code: "ga", tier: "standard", flag: "ie" },
  { name: "Kabuverdianu", tier: "standard", flag: "cv" },
  { name: "Kabyle", tier: "standard", flag: "dz" },
  { name: "Kamba", tier: "standard", flag: "ke" },
  { name: "Latin", code: "la", tier: "standard"  },
  { name: "Luxembourgish", code: "lb", tier: "standard", flag: "lu" },
  { name: "Oromo", code: "om", tier: "standard", flag: "et" },
  { name: "Pashto", code: "ps", tier: "standard", flag: "af" },
  { name: "Sindhi", code: "sd", tier: "standard", flag: "pk" },
  { name: "Somali", code: "so", tier: "standard", flag: "so" },
  { name: "Umbundu", tier: "standard", flag: "ao" },
  { name: "Welsh", code: "cy", tier: "standard", flag: "gb-wls" },
];

/** Only these can be used as a transcription hint, which takes ISO-639-1. */
export const TRANSCRIBABLE = LANGUAGES.filter(language => language.code);

export function languageName(code: string) {
  if (!code) return "";
  return LANGUAGES.find(language => language.code === code)?.name ?? code;
}

export function languageByName(name: string) {
  return LANGUAGES.find(language => language.name === name);
}

/**
 * A Twemoji SVG for a flag, by ISO 3166-1 alpha-2.
 *
 * Native flag emoji do not render on Windows at all, and differ across platforms
 * elsewhere, so the picker uses Twemoji's SVGs — the same set the emoji came from — for
 * one consistent set of flags. A regional code like `gb-wls` maps to its own subdivision
 * sequence rather than a two-letter pair.
 */
const TWEMOJI = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg";

const SUBDIVISIONS: Record<string, string> = {
  // 🏴 + tag letters + cancel tag, the way subdivision flags are encoded.
  "gb-wls": "1f3f4-e0067-e0062-e0077-e006c-e0073-e007f",
};

export function flagUrl(flag: string | undefined) {
  if (!flag) return null;
  const subdivision = SUBDIVISIONS[flag];
  if (subdivision) return `${TWEMOJI}/${subdivision}.svg`;
  const codepoints = [...flag.toUpperCase()]
    .map(letter => (0x1f1e6 + letter.charCodeAt(0) - 65).toString(16))
    .join("-");
  return `${TWEMOJI}/${codepoints}.svg`;
}
