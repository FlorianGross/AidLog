/**
 * selfintake/phrases.ts — PATIENT-FACING multilingual strings.
 *
 * These are shown to the PATIENT (not the responder), so they live here as a
 * self-contained, fully-typed table rather than in the app-wide i18n catalogue
 * (whose `Messages` shape every locale must mirror). The responder UI chrome
 * stays in $lib/i18n (German + the app's locales); only the patient flow uses
 * these.
 *
 * ⚠️ TRANSLATION QUALITY — READ BEFORE RELYING ON THIS IN THE FIELD ⚠️
 * Only the German (`de`) strings are authored by a German speaker and are the
 * source of truth. ALL non-German translations (en, tr, ar, ru, uk, fr) are
 * MACHINE-DRAFTED and have NOT been reviewed by a professional medical
 * translator. They are an emergency communication aid, NOT a substitute for a
 * qualified interpreter. Before production use each locale MUST be reviewed and
 * signed off by a native-speaking medical translator. See MACHINE_DRAFTED.
 */
import type { IntakeLang } from './types';

/** Locales that have NOT been professionally reviewed (everything but `de`). */
export const MACHINE_DRAFTED: ReadonlySet<IntakeLang> = new Set<IntakeLang>([
  'en',
  'tr',
  'ar',
  'ru',
  'uk',
  'fr',
]);

export function isMachineDrafted(lang: IntakeLang): boolean {
  return MACHINE_DRAFTED.has(lang);
}

/** Display label + endonym for each offered language (shown on the picker). */
export const LANG_LABELS: Record<IntakeLang, { endonym: string; de: string; flag: string }> = {
  de: { endonym: 'Deutsch', de: 'Deutsch', flag: '🇩🇪' },
  en: { endonym: 'English', de: 'Englisch', flag: '🇬🇧' },
  tr: { endonym: 'Türkçe', de: 'Türkisch', flag: '🇹🇷' },
  ar: { endonym: 'العربية', de: 'Arabisch', flag: '🇸🇦' },
  ru: { endonym: 'Русский', de: 'Russisch', flag: '🇷🇺' },
  uk: { endonym: 'Українська', de: 'Ukrainisch', flag: '🇺🇦' },
  fr: { endonym: 'Français', de: 'Französisch', flag: '🇫🇷' },
};

export const INTAKE_LANGS: readonly IntakeLang[] = ['de', 'en', 'tr', 'ar', 'ru', 'uk', 'fr'];

/** The full patient-facing phrase set for one language. */
export interface IntakePhrases {
  // generic flow chrome
  chooseLanguage: string;
  intro: string;
  next: string;
  back: string;
  finish: string;
  cancel: string;
  yes: string;
  no: string;
  unknown: string;
  skip: string;
  thanks: string;
  // questions
  qHauptbeschwerde: string;
  qSchmerzVorhanden: string;
  qSchmerzSkala: string;
  schmerzNone: string;
  schmerzWorst: string;
  qSchmerzLokalisation: string;
  qAllergien: string;
  qMedikamente: string;
  qVorerkrankungen: string;
  qLetzteMahlzeit: string;
  qSchwangerschaft: string;
  // verständigungshilfe (communication aid) common phrases
  vSchmerzen: string;
  vMedikamente: string;
  vAllergisch: string;
  vAtemnot: string;
  vSchwindel: string;
  vUebelkeit: string;
  vWhereHurt: string;
  vCallHelp: string;
  vStayCalm: string;
}

/**
 * de — SOURCE OF TRUTH (authored by a German speaker).
 */
const de: IntakePhrases = {
  chooseLanguage: 'Bitte wählen Sie Ihre Sprache',
  intro:
    'Diese Fragen helfen den Einsatzkräften. Tippen Sie Ihre Antworten ein. Sie können Fragen überspringen. Die Einsatzkraft prüft alles anschließend mit Ihnen.',
  next: 'Weiter',
  back: 'Zurück',
  finish: 'Fertig',
  cancel: 'Abbrechen',
  yes: 'Ja',
  no: 'Nein',
  unknown: 'Weiß ich nicht',
  skip: 'Überspringen',
  thanks: 'Danke. Die Einsatzkraft sieht sich Ihre Angaben jetzt an.',
  qHauptbeschwerde: 'Was ist Ihr Hauptproblem? Was tut weh oder fehlt Ihnen?',
  qSchmerzVorhanden: 'Haben Sie Schmerzen?',
  qSchmerzSkala: 'Wie stark sind die Schmerzen? (0 = keine, 10 = stärkste)',
  schmerzNone: 'keine Schmerzen',
  schmerzWorst: 'stärkste Schmerzen',
  qSchmerzLokalisation: 'Wo haben Sie Schmerzen?',
  qAllergien: 'Haben Sie Allergien? Wenn ja, welche?',
  qMedikamente: 'Nehmen Sie regelmäßig Medikamente? Wenn ja, welche?',
  qVorerkrankungen: 'Haben Sie Vorerkrankungen? (z. B. Herz, Diabetes, Asthma)',
  qLetzteMahlzeit: 'Wann haben Sie zuletzt gegessen oder getrunken?',
  qSchwangerschaft: 'Sind Sie schwanger?',
  vSchmerzen: 'Haben Sie Schmerzen?',
  vMedikamente: 'Nehmen Sie Medikamente?',
  vAllergisch: 'Sind Sie allergisch?',
  vAtemnot: 'Bekommen Sie schlecht Luft?',
  vSchwindel: 'Ist Ihnen schwindelig?',
  vUebelkeit: 'Ist Ihnen übel?',
  vWhereHurt: 'Wo tut es weh?',
  vCallHelp: 'Wir rufen Hilfe.',
  vStayCalm: 'Bleiben Sie ruhig, wir helfen Ihnen.',
};

// ⚠️ MACHINE-DRAFTED below — needs professional medical-translator review. ⚠️
const en: IntakePhrases = {
  chooseLanguage: 'Please choose your language',
  intro:
    'These questions help the medical responders. Type your answers. You may skip any question. The responder will review everything with you afterwards.',
  next: 'Next',
  back: 'Back',
  finish: 'Done',
  cancel: 'Cancel',
  yes: 'Yes',
  no: 'No',
  unknown: 'I don’t know',
  skip: 'Skip',
  thanks: 'Thank you. The responder will now review your answers.',
  qHauptbeschwerde: 'What is your main problem? What hurts or is wrong?',
  qSchmerzVorhanden: 'Are you in pain?',
  qSchmerzSkala: 'How strong is the pain? (0 = none, 10 = worst)',
  schmerzNone: 'no pain',
  schmerzWorst: 'worst pain',
  qSchmerzLokalisation: 'Where is the pain?',
  qAllergien: 'Do you have any allergies? If yes, which ones?',
  qMedikamente: 'Do you take any regular medication? If yes, which?',
  qVorerkrankungen: 'Do you have any pre-existing conditions? (e.g. heart, diabetes, asthma)',
  qLetzteMahlzeit: 'When did you last eat or drink?',
  qSchwangerschaft: 'Are you pregnant?',
  vSchmerzen: 'Are you in pain?',
  vMedikamente: 'Do you take any medication?',
  vAllergisch: 'Are you allergic to anything?',
  vAtemnot: 'Are you short of breath?',
  vSchwindel: 'Do you feel dizzy?',
  vUebelkeit: 'Do you feel nauseous?',
  vWhereHurt: 'Where does it hurt?',
  vCallHelp: 'We are calling for help.',
  vStayCalm: 'Stay calm, we will help you.',
};

const tr: IntakePhrases = {
  chooseLanguage: 'Lütfen dilinizi seçin',
  intro:
    'Bu sorular sağlık ekibine yardımcı olur. Cevaplarınızı yazın. İstediğiniz soruyu atlayabilirsiniz. Görevli daha sonra her şeyi sizinle birlikte gözden geçirecektir.',
  next: 'İleri',
  back: 'Geri',
  finish: 'Bitti',
  cancel: 'İptal',
  yes: 'Evet',
  no: 'Hayır',
  unknown: 'Bilmiyorum',
  skip: 'Atla',
  thanks: 'Teşekkürler. Görevli şimdi cevaplarınızı inceleyecek.',
  qHauptbeschwerde: 'Ana sorununuz nedir? Neresi ağrıyor veya neyiniz var?',
  qSchmerzVorhanden: 'Ağrınız var mı?',
  qSchmerzSkala: 'Ağrı ne kadar şiddetli? (0 = yok, 10 = en şiddetli)',
  schmerzNone: 'ağrı yok',
  schmerzWorst: 'en şiddetli ağrı',
  qSchmerzLokalisation: 'Ağrı nerede?',
  qAllergien: 'Alerjiniz var mı? Varsa hangileri?',
  qMedikamente: 'Düzenli ilaç kullanıyor musunuz? Kullanıyorsanız hangileri?',
  qVorerkrankungen: 'Mevcut bir hastalığınız var mı? (örn. kalp, diyabet, astım)',
  qLetzteMahlzeit: 'En son ne zaman yemek yediniz veya bir şey içtiniz?',
  qSchwangerschaft: 'Hamile misiniz?',
  vSchmerzen: 'Ağrınız var mı?',
  vMedikamente: 'İlaç kullanıyor musunuz?',
  vAllergisch: 'Alerjiniz var mı?',
  vAtemnot: 'Nefes almakta zorlanıyor musunuz?',
  vSchwindel: 'Başınız dönüyor mu?',
  vUebelkeit: 'Miden bulanıyor mu?',
  vWhereHurt: 'Neresi ağrıyor?',
  vCallHelp: 'Yardım çağırıyoruz.',
  vStayCalm: 'Sakin olun, size yardım edeceğiz.',
};

// Arabic — right-to-left (dir="rtl" handled in the UI).
const ar: IntakePhrases = {
  chooseLanguage: 'يرجى اختيار لغتك',
  intro:
    'تساعد هذه الأسئلة فريق الإسعاف. اكتب إجاباتك. يمكنك تخطّي أي سؤال. سيراجع المسعف كل شيء معك لاحقًا.',
  next: 'التالي',
  back: 'رجوع',
  finish: 'تم',
  cancel: 'إلغاء',
  yes: 'نعم',
  no: 'لا',
  unknown: 'لا أعرف',
  skip: 'تخطّي',
  thanks: 'شكرًا. سيراجع المسعف إجاباتك الآن.',
  qHauptbeschwerde: 'ما هي مشكلتك الرئيسية؟ أين يؤلمك أو ماذا تشكو؟',
  qSchmerzVorhanden: 'هل تشعر بألم؟',
  qSchmerzSkala: 'ما مدى شدة الألم؟ (0 = لا ألم، 10 = أشد ألم)',
  schmerzNone: 'لا ألم',
  schmerzWorst: 'أشد ألم',
  qSchmerzLokalisation: 'أين يؤلمك؟',
  qAllergien: 'هل لديك حساسية؟ إذا نعم، ما هي؟',
  qMedikamente: 'هل تتناول أدوية بانتظام؟ إذا نعم، ما هي؟',
  qVorerkrankungen: 'هل لديك أمراض مزمنة؟ (مثل القلب، السكري، الربو)',
  qLetzteMahlzeit: 'متى أكلت أو شربت آخر مرة؟',
  qSchwangerschaft: 'هل أنتِ حامل؟',
  vSchmerzen: 'هل تشعر بألم؟',
  vMedikamente: 'هل تتناول أدوية؟',
  vAllergisch: 'هل لديك حساسية؟',
  vAtemnot: 'هل تجد صعوبة في التنفس؟',
  vSchwindel: 'هل تشعر بدوار؟',
  vUebelkeit: 'هل تشعر بالغثيان؟',
  vWhereHurt: 'أين يؤلمك؟',
  vCallHelp: 'نحن نطلب المساعدة.',
  vStayCalm: 'ابقَ هادئًا، سنساعدك.',
};

const ru: IntakePhrases = {
  chooseLanguage: 'Пожалуйста, выберите язык',
  intro:
    'Эти вопросы помогают спасателям. Введите свои ответы. Любой вопрос можно пропустить. Затем спасатель проверит всё вместе с вами.',
  next: 'Далее',
  back: 'Назад',
  finish: 'Готово',
  cancel: 'Отмена',
  yes: 'Да',
  no: 'Нет',
  unknown: 'Не знаю',
  skip: 'Пропустить',
  thanks: 'Спасибо. Спасатель сейчас просмотрит ваши ответы.',
  qHauptbeschwerde: 'Какая у вас основная проблема? Что болит или беспокоит?',
  qSchmerzVorhanden: 'У вас есть боль?',
  qSchmerzSkala: 'Насколько сильная боль? (0 = нет, 10 = самая сильная)',
  schmerzNone: 'нет боли',
  schmerzWorst: 'сильнейшая боль',
  qSchmerzLokalisation: 'Где болит?',
  qAllergien: 'Есть ли у вас аллергия? Если да, на что?',
  qMedikamente: 'Принимаете ли вы лекарства регулярно? Если да, какие?',
  qVorerkrankungen: 'Есть ли у вас хронические заболевания? (например, сердце, диабет, астма)',
  qLetzteMahlzeit: 'Когда вы в последний раз ели или пили?',
  qSchwangerschaft: 'Вы беременны?',
  vSchmerzen: 'У вас есть боль?',
  vMedikamente: 'Вы принимаете лекарства?',
  vAllergisch: 'У вас есть аллергия?',
  vAtemnot: 'Вам трудно дышать?',
  vSchwindel: 'У вас кружится голова?',
  vUebelkeit: 'Вас тошнит?',
  vWhereHurt: 'Где болит?',
  vCallHelp: 'Мы вызываем помощь.',
  vStayCalm: 'Сохраняйте спокойствие, мы вам поможем.',
};

const uk: IntakePhrases = {
  chooseLanguage: 'Будь ласка, оберіть мову',
  intro:
    'Ці запитання допомагають рятувальникам. Введіть свої відповіді. Будь-яке запитання можна пропустити. Потім рятувальник перегляне все разом із вами.',
  next: 'Далі',
  back: 'Назад',
  finish: 'Готово',
  cancel: 'Скасувати',
  yes: 'Так',
  no: 'Ні',
  unknown: 'Не знаю',
  skip: 'Пропустити',
  thanks: 'Дякуємо. Рятувальник зараз перегляне ваші відповіді.',
  qHauptbeschwerde: 'Яка ваша основна проблема? Що болить або турбує?',
  qSchmerzVorhanden: 'У вас є біль?',
  qSchmerzSkala: 'Наскільки сильний біль? (0 = немає, 10 = найсильніший)',
  schmerzNone: 'немає болю',
  schmerzWorst: 'найсильніший біль',
  qSchmerzLokalisation: 'Де болить?',
  qAllergien: 'Чи є у вас алергія? Якщо так, на що?',
  qMedikamente: 'Чи приймаєте ви ліки регулярно? Якщо так, які?',
  qVorerkrankungen: 'Чи маєте ви хронічні захворювання? (наприклад, серце, діабет, астма)',
  qLetzteMahlzeit: 'Коли ви востаннє їли чи пили?',
  qSchwangerschaft: 'Ви вагітні?',
  vSchmerzen: 'У вас є біль?',
  vMedikamente: 'Ви приймаєте ліки?',
  vAllergisch: 'У вас є алергія?',
  vAtemnot: 'Вам важко дихати?',
  vSchwindel: 'У вас паморочиться в голові?',
  vUebelkeit: 'Вас нудить?',
  vWhereHurt: 'Де болить?',
  vCallHelp: 'Ми викликаємо допомогу.',
  vStayCalm: 'Зберігайте спокій, ми вам допоможемо.',
};

const fr: IntakePhrases = {
  chooseLanguage: 'Veuillez choisir votre langue',
  intro:
    'Ces questions aident les secouristes. Saisissez vos réponses. Vous pouvez ignorer toute question. Le secouriste vérifiera ensuite tout avec vous.',
  next: 'Suivant',
  back: 'Retour',
  finish: 'Terminé',
  cancel: 'Annuler',
  yes: 'Oui',
  no: 'Non',
  unknown: 'Je ne sais pas',
  skip: 'Passer',
  thanks: 'Merci. Le secouriste va maintenant examiner vos réponses.',
  qHauptbeschwerde: 'Quel est votre problème principal ? Qu’est-ce qui vous fait mal ?',
  qSchmerzVorhanden: 'Avez-vous mal ?',
  qSchmerzSkala: 'Quelle est l’intensité de la douleur ? (0 = aucune, 10 = maximale)',
  schmerzNone: 'aucune douleur',
  schmerzWorst: 'douleur maximale',
  qSchmerzLokalisation: 'Où avez-vous mal ?',
  qAllergien: 'Avez-vous des allergies ? Si oui, lesquelles ?',
  qMedikamente: 'Prenez-vous des médicaments régulièrement ? Si oui, lesquels ?',
  qVorerkrankungen: 'Avez-vous des maladies préexistantes ? (p. ex. cœur, diabète, asthme)',
  qLetzteMahlzeit: 'Quand avez-vous mangé ou bu pour la dernière fois ?',
  qSchwangerschaft: 'Êtes-vous enceinte ?',
  vSchmerzen: 'Avez-vous mal ?',
  vMedikamente: 'Prenez-vous des médicaments ?',
  vAllergisch: 'Êtes-vous allergique ?',
  vAtemnot: 'Avez-vous du mal à respirer ?',
  vSchwindel: 'Avez-vous des vertiges ?',
  vUebelkeit: 'Avez-vous la nausée ?',
  vWhereHurt: 'Où avez-vous mal ?',
  vCallHelp: 'Nous appelons les secours.',
  vStayCalm: 'Restez calme, nous allons vous aider.',
};

const PHRASES: Record<IntakeLang, IntakePhrases> = { de, en, tr, ar, ru, uk, fr };

/** Patient-facing phrases for a language (always defined; falls back to de). */
export function phrasesFor(lang: IntakeLang): IntakePhrases {
  return PHRASES[lang] ?? de;
}

/**
 * One entry in the standalone Verständigungshilfe (communication aid): a German
 * label (for the responder), a pictogram, and the key into IntakePhrases used
 * to render the translated phrase.
 */
export interface AidPhrase {
  key: keyof IntakePhrases;
  /** Pictogram (emoji) shown next to the phrase for quick recognition. */
  icon: string;
  /** German label shown to the responder. */
  de: string;
}

export const AID_PHRASES: readonly AidPhrase[] = [
  { key: 'vSchmerzen', icon: '🤕', de: 'Haben Sie Schmerzen?' },
  { key: 'vWhereHurt', icon: '📍', de: 'Wo tut es weh?' },
  { key: 'vMedikamente', icon: '💊', de: 'Nehmen Sie Medikamente?' },
  { key: 'vAllergisch', icon: '⚠️', de: 'Sind Sie allergisch?' },
  { key: 'vAtemnot', icon: '🫁', de: 'Bekommen Sie schlecht Luft?' },
  { key: 'vSchwindel', icon: '💫', de: 'Ist Ihnen schwindelig?' },
  { key: 'vUebelkeit', icon: '🤢', de: 'Ist Ihnen übel?' },
  { key: 'vCallHelp', icon: '📞', de: 'Wir rufen Hilfe.' },
  { key: 'vStayCalm', icon: '🤝', de: 'Bleiben Sie ruhig, wir helfen Ihnen.' },
];
