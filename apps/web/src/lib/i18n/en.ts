/**
 * English message groups (partial).
 *
 * The i18n runtime currently falls back every non-German locale to `de` (see
 * index.ts), so this file is NOT yet wired into the dictionary. It holds the
 * English translations for newer feature groups so that, when a full English
 * catalogue is authored, these are ready to merge. Keep keys in sync with the
 * matching groups in `de.ts`.
 */
export const en = {
  // --- Training / exercise mode (Übungs-/Demo-Modus) ---------------------
  training: {
    checkbox: 'Training deployment (demo/exercise)',
    hint: 'Training data is excluded from statistics & analytics and flagged as TRAINING in exports.',
    badge: 'TRAINING',
    banner: 'TRAINING MODE – This is an exercise. Not real patient documentation.',
    statsNote:
      'TRAINING: these statistics contain exercise data only and are not part of the org-wide analytics.',
    exportNote: 'TRAINING/DEMO – exercise dataset, not real patient documentation.',
  },
  // --- Event journal (ELW logbook) ---------------------------------------
  journal: {
    link: 'Journal',
    title: 'Event journal',
    addEntry: 'Add entry',
    time: 'Time',
    category: 'Category',
    text: 'Entry',
    textPlaceholder: 'What happened? (e.g. situation report, reinforcement request …)',
    textRequired: 'Please enter some text.',
    author: 'Author',
    authorPlaceholder: 'Name/role (optional)',
    saved: 'Entry saved',
    error: 'The entry could not be saved.',
    timelineTitle: 'History',
    refresh: 'Refresh',
    loading: 'Loading and decrypting the journal …',
    loadFailed: 'The event journal could not be loaded.',
    retry: 'Try again',
    empty: 'No journal entries for this deployment yet.',
    forwardOnlyHint: 'Only entries created after this feature was enabled are included here.',
    forbiddenTitle: 'No access',
    forbidden:
      'The event journal is only visible to the operation lead and administrators. Anyone may add entries.',
    privacyNote: 'Entries are decrypted in memory locally only and are not stored or transmitted.',
    categories: {
      alarmierung: 'Alerting',
      lagemeldung: 'Situation report',
      nachforderung: 'Reinforcement request',
      wetter_umfeld: 'Weather / environment',
      material: 'Material',
      sonstiges: 'Other',
    },
  },

  // --- Machine-readable, pseudonymized data export (FHIR / DIVI-MIND) -----
  export: {
    dataMenu: 'Data export',
    fhir: 'FHIR (JSON)',
    divi: 'DIVI/MIND (JSON)',
    pseudonymizedNote: 'Pseudonymized export – no real names, only coded clinical data.',
  },

  // --- Structured handover (to ambulance / emergency physician) ----------
  handover: {
    title: 'Handover (ISOBAR/SAMPLER)',
    print: 'Print handover',
    signatures: 'Signatures',
    qrHint: 'The QR code is for integrity verification only – it contains no patient data',
    medications: 'Medication given',
    medMittel: 'Agent',
    medDosis: 'Dose',
    medWeg: 'Route',
    medUhrzeit: 'Time',
    medPerson: 'Administered by',
    timeline: 'Times',
  },

  // --- Finalize gate (required fields) ------------------------------------
  finalize: {
    gateTitle: 'Please complete the required fields.',
    missingFields: 'Missing required entries',
  },

  // --- Data protection & erasure (GDPR / retention concept) --------------
  privacy: {
    title: 'Data protection & erasure',
    subtitle:
      'Retention period, permanent erasure via crypto-shredding, subject access (Art. 15) and record of processing activities (Art. 30).',
    forbidden: 'This page is accessible to administrators only.',
    loadFailed: 'The data-protection settings could not be loaded.',

    explainTitle: 'What does crypto-shredding mean?',
    explainBody:
      'The server stores ciphertext only and holds no keys. Erasure works by destroying the per-record keys (sealed_keys). Afterwards the corresponding plaintext can no longer be decrypted by anyone — not even with the organisation password. The signed, append-only record chain is kept for audit integrity; only its keys are removed.',
    irreversibleWarning: 'This action is IRREVERSIBLE. Destroyed keys cannot be recovered.',
    backupCaveat:
      'In restorable backups, erasure only takes effect after the backup rotation window has elapsed (see infra/BACKUP.md).',

    retentionTitle: 'Retention period (organisation-wide)',
    retentionIntro:
      'The period is measured from the server-side receipt time (tamper-resistant), not from the device creation time.',
    retentionNotConfigured: 'No retention period has been configured yet.',
    retentionCurrent: 'Current period: {days} days (~{years} years).',
    retentionUpdatedAt: 'Last changed: {date}',
    retentionDaysLabel: 'Retention period (days)',
    retentionYearsLabel: 'Retention period (years)',
    retentionDaysHint: 'Positive integer. Enforced server-side.',
    save: 'Save period',
    saved: 'Retention period saved.',
    saveFailed: 'The retention period could not be saved.',

    purgeTitle: 'Permanent erasure (crypto-shredding)',
    purgePolicyTitle: 'Erase by retention period',
    purgePolicyIntro:
      'Destroys the keys of all records whose receipt time predates the retention period.',
    purgeDeploymentTitle: 'Erase a single deployment (Art. 17)',
    purgeDeploymentIntro:
      'For an erasure request about a specific event: all records of this deployment are erased via crypto-shredding.',
    deploymentIdLabel: 'Deployment ID',
    deploymentIdPlaceholder: 'e.g. 3f1c…',
    preview: 'Preview',
    previewing: 'Computing preview …',
    previewResult:
      '{records} records and {keys} keys across {deployments} deployments would be irreversibly erased.',
    previewCutoff: 'Cutoff: records before {date}.',
    previewNone: 'No records match the criteria.',
    previewFailed: 'The preview could not be computed.',
    noPolicyForPurge: 'No retention period configured. Please save a period first.',
    confirmTitle: 'Confirm erasure',
    confirmIntro: 'To confirm, type {word} into the field. This action is irreversible.',
    confirmWord: 'DELETE',
    confirmPlaceholder: 'DELETE',
    execute: 'Erase permanently',
    executing: 'Erasing …',
    executed: '{records} records erased ({keys} keys destroyed).',
    executeFailed: 'The erasure could not be performed.',
    cancel: 'Cancel',

    logTitle: 'Deletion log',
    logIntro: 'Tamper-evident record of executed erasures (newest first).',
    logEmpty: 'No erasures have been executed yet.',
    logColScope: 'Scope',
    logColDeployment: 'Deployment',
    logColRecords: 'Records',
    logColKeys: 'Keys',
    logColCutoff: 'Cutoff',
    logColBy: 'Executed by',
    logColAt: 'Time',
    scopePolicy: 'Retention',
    scopeDeployment: 'Deployment',

    dsarTitle: 'Subject access (Art. 15 GDPR)',
    dsarIntro:
      'Decrypts a deployment’s records locally on this device with the organisation key and offers them as a download. No data leaves the device except by your explicit download.',
    dsarDeploymentLabel: 'Deployment ID',
    dsarExport: 'Build & download access record',
    dsarRunning: 'Decrypting …',
    dsarDone: 'Access record built: {records} records ({skipped} skipped).',
    dsarFailed: 'The access record could not be built.',
    dsarFilename: 'subject-access-art15',

    orgPassword: 'Organisation password',
    orgPasswordHint: 'Used transiently in memory to decrypt; never stored or transmitted.',
    wrongOrgPassword: 'Wrong organisation password.',

    ropaTitle: 'Record of processing activities (Art. 30 GDPR)',
    ropaIntro:
      'Generates a printable/downloadable record of processing activities from the organisation data and the known system facts. It contains no personal data.',
    ropaGenerate: 'Generate record',
    ropaPrint: 'Print',
    ropaDownload: 'Download as JSON',
    ropaFilename: 'record-of-processing-art30',
    ropaGeneratedAt: 'Generated on {date}',
  },

  // --- Generic form widgets (repeatable groups, computed, plausibility) ----
  formx: {
    addRow: 'Add row',
    removeRow: 'Remove row',
    rowLabel: 'Entry {n}',
    emptyRows: 'No entries yet.',
    computedEmpty: '—',
    requiredMarker: 'Required field',
    now: 'Now',
    outOfRange: 'outside normal range {range}',
    valueOutOfRange: '{value} outside normal range {range}',
  },

  // --- Personal & qualifications ------------------------------------------
  qualifications: {
    label: 'Qualification',
    none: 'No qualification',
    sectionGatedNote:
      'This section requires at least the qualification: {qualification}. You can only read it.',
  },

  // --- Attendance / duty roster (per deployment) --------------------------
  roster: {
    link: 'Duty',
    title: 'Attendance / duty',
    subtitle: 'Who is on duty?',
    qualification: 'Qualification',
    onDuty: 'on duty',
    offDuty: 'off duty',
    checkedIn: 'Checked in',
    checkedOut: 'Checked out',
    selfCheckIn: "I'm on duty",
    selfCheckOut: 'End duty',
    checkInOther: 'Check in',
    checkOutOther: 'Check out',
    empty: 'Nobody on duty yet.',
    emptyHint: 'Check yourself in to appear on the duty list.',
    loadFailed: 'The duty list could not be loaded.',
    updateFailed: 'Update failed.',
  },

  // --- Material / consumables inventory -----------------------------------
  material: {
    nav: 'Material',
    link: 'Material',
    title: 'Material / consumables',
    subtitle: 'Manage stock, consumption, expiry and minimum levels.',
    privacyNote:
      'Logistics data only (no patient link). Consumption is recorded per deployment in aggregate.',
    add: 'Add item',
    edit: 'Edit item',
    create: 'New item',
    empty: 'No material recorded yet.',
    emptyHint: 'Add items to track stock and consumption.',
    name: 'Name',
    category: 'Category',
    categoryPlaceholder: 'e.g. dressings',
    unit: 'Unit',
    stock: 'Stock',
    minStock: 'Minimum stock',
    minStockHint: 'Warns when stock ≤ minimum.',
    expiry: 'Expiry date',
    location: 'Location',
    locationPlaceholder: 'e.g. Backpack 2',
    active: 'Active',
    inactive: 'Inactive',
    lowStock: 'Low stock',
    expiringSoon: 'Expiring soon',
    expired: 'Expired',
    deactivate: 'Deactivate',
    deactivated: 'Deactivated (consumption history exists).',
    deleteConfirm: 'Really remove this item?',
    deleteExplain:
      'Items with consumption history are deactivated instead of deleted, so the history is preserved.',
    units: {
      Stk: 'Pcs',
      Pkg: 'Pack',
      Paar: 'Pair',
      ml: 'Millilitre',
      l: 'Litre',
      Set: 'Set',
    },
    consumption: {
      link: 'Material',
      title: 'Material consumption',
      subtitle: 'Record consumption for this deployment (aggregate, no patient link).',
      logTitle: 'Record consumption',
      item: 'Item',
      quantity: 'Quantity',
      note: 'Note',
      notePlaceholder: 'optional',
      log: 'Record',
      logged: 'Consumption recorded ✓',
      recordedBy: 'Recorded by',
      recordedAt: 'Time',
      remove: 'Remove',
      removeConfirm: 'Remove this consumption entry and restore stock?',
      empty: 'No consumption recorded yet.',
      emptyHint: 'Pick an item and record the quantity used.',
      noItems: 'No material has been created yet.',
      clamped: 'Stock clamped to 0 (more consumed than available).',
    },
    loadFailed: 'Material could not be loaded.',
    saveFailed: 'Saving failed.',
    deleteFailed: 'Deletion failed.',
    logFailed: 'Consumption could not be recorded.',
  },

  // --- CIRS — anonymous critical-incident reporting -----------------------
  cirs: {
    nav: 'CIRS / Report incident',
    reviewNav: 'CIRS review',
    title: 'CIRS – Report a critical incident',
    subtitle: 'Anonymous reporting of critical incidents and near misses for quality management.',
    intro:
      'Help us learn from critical incidents and near misses. Your report is anonymous — no link to you is stored.',
    anonymityTitle: 'Anonymous & encrypted',
    anonymityNote:
      'Your report is encrypted on this device and contains nothing that points to you: no name, no signature, no sender id. Only quality management can decrypt it with the organisation key.',
    residualNote:
      'Full anonymity at the network level is not guaranteed: when you submit, the server operator could in principle still correlate the request via IP address and timing. The stored timestamp is therefore coarsened to the date only (no time). For maximum anonymity, report with a time delay and possibly via a neutral network.',
    noPatientWarning:
      'Please do NOT enter patient or personal names, dates of birth, or uniquely identifying details. Describe the incident factually (CIRS principle).',
    fieldEreignis: 'What happened?',
    fieldEreignisHint: 'Describe the critical incident or near miss.',
    fieldKontext: 'Area / context (without patient data)',
    fieldKontextHint: 'e.g. medical service, transport, handover — without names.',
    fieldFaktoren: 'Contributing factors',
    fieldFaktorenHint: 'What contributed to the incident?',
    fieldFolgen: 'Possible consequences',
    fieldFolgenHint: 'What could have happened, or did happen?',
    fieldVorschlag: 'Improvement suggestion',
    fieldVorschlagHint: 'How could this be avoided in future?',
    fieldZeitraum: 'Approximate timeframe',
    fieldZeitraumHint: 'Deliberately vague, e.g. “week 23” or “May 2026”.',
    submit: 'Report anonymously',
    submitting: 'Sending …',
    submitFailed: 'The report could not be sent.',
    emptyForm: 'Please describe the incident before sending.',
    confirmTitle: 'Report sent – thank you!',
    confirmBody: 'Your anonymous CIRS report was transmitted encrypted. It is not linked to you.',
    confirmResidual:
      'Note: a residual technical correlation via IP/timing of the request by the server operator cannot be fully ruled out (see above).',
    newReport: 'Another report',
    review: {
      title: 'CIRS review',
      subtitle: 'Decrypt and process anonymous reports (quality management).',
      unlockTitle: 'Unlock organisation key',
      unlockIntro:
        'Enter the organisation password to decrypt the anonymous reports locally. Password and key never leave this device.',
      orgPassword: 'Organisation password',
      orgPasswordHint: 'Held in memory only briefly, then wiped.',
      unlock: 'Decrypt',
      unlocking: 'Decrypting …',
      wrongOrgPassword: 'Wrong organisation password.',
      forbidden: 'Quality management (admin) only.',
      loadFailed: 'Reports could not be loaded.',
      empty: 'No CIRS reports yet.',
      decryptFailed: 'This report could not be decrypted.',
      reportedOn: 'Reported on',
      status: 'Status',
      updateStatus: 'Change status',
      statusUpdated: 'Status updated ✓',
      statusUpdateFailed: 'Status could not be updated.',
      reset: 'Lock',
    },
    status: {
      neu: 'New',
      in_bearbeitung: 'In progress',
      abgeschlossen: 'Closed',
    },
  },

  // --- Event master data (optional, stored locally per device) ------------
  veranstaltung: {
    setupTitle: 'Event master data',
    editLink: 'Event',
    localNote:
      'This master data is stored only locally on this device (no server sync). It contains no patient/health data.',
    ort: 'Location',
    beginn: 'Start',
    ende: 'End',
    art: 'Event type',
    artPlaceholder: 'e.g. town festival, football match, concert',
    erwarteteBesucher: 'Expected number of visitors',
    veranstalter: 'Organiser',
    einsatzleiter: 'Operations lead',
  },

  // --- Force assessment (Cologne algorithm / Maurer scheme) ---------------
  kraefte: {
    title: 'Force assessment',
    subtitle: 'Orientation aid for medical-service staffing at events',
    disclaimer:
      'Orientation aid based on the Cologne algorithm (Maurer scheme); it does not replace a binding assessment by the competent authority/medical operations command.',
    inputTitle: 'Event parameters',
    resultTitle: 'Recommendation',
    breakdownTitle: 'Score breakdown',
    points: 'points',
    total: 'Total score',
    recommendationLevel: 'Recommendation level',
    sanitaeter: 'Medics (responders)',
    rettungsmittel: 'Rescue resources',
    arztbesetzteMittel: 'Physician-staffed resources',
    methodNote:
      'The point values are a disclosed parametrisation aligned with the published schemes and can be adjusted org-internally. Adapt the recommendation to the situation and local requirements.',
    stufe: {
      gering: 'low',
      erhoeht: 'elevated',
      hoch: 'high',
      sehr_hoch: 'very high',
    },
    field: {
      veranstaltungsart: 'Event type / risk',
      besucher: 'Expected number of visitors',
      struktur: 'Visitor structure (age mix)',
      verhalten: 'Expected behaviour / alcohol',
      witterung: 'Weather conditions',
      dauer: 'Event duration',
      flaeche: 'Area / accessibility',
      gefaehrdetePersonen: 'Presence of particularly vulnerable persons',
    },
    opt: {
      veranstaltungsart: {
        fest_ruhig: 'Quiet festival / market / exhibition',
        sport_publikum: 'Sports event with spectators',
        konzert_sitzend: 'Concert / stage (mostly seated)',
        konzert_stehend: 'Concert / festival (standing)',
        demonstration: 'Demonstration / rally',
        grossveranstaltung_risiko: 'Major event with elevated risk',
      },
      besucher: {
        bis_1000: 'up to 1,000',
        bis_5000: 'up to 5,000',
        bis_20000: 'up to 20,000',
        bis_50000: 'up to 50,000',
        ueber_50000: 'over 50,000',
      },
      struktur: {
        gemischt: 'Mixed audience',
        familien_kinder: 'Many families / children',
        jugendlich: 'Mostly adolescents',
        senioren: 'Mostly older people',
      },
      verhalten: {
        gering: 'Calm, little/no alcohol',
        maessig: 'Moderate alcohol consumption',
        hoch: 'High alcohol/drug consumption',
        aggressiv: 'Elevated violence/escalation potential',
      },
      witterung: {
        gemaessigt: 'Moderate / covered',
        hitze: 'Severe heat / direct sun',
        kaelte: 'Cold / wet',
        extrem: 'Storm / extreme conditions',
      },
      dauer: {
        bis_4h: 'up to 4 hours',
        bis_8h: 'up to 8 hours',
        bis_12h: 'up to 12 hours',
        mehrtaegig: 'Multi-day',
      },
      flaeche: {
        gut: 'Easily accessible, short distances',
        mittel: 'Partly restricted',
        schlecht: 'Sprawling / hard to reach',
      },
    },
  },

  // --- Watch report (closing report per deployment) -----------------------
  wachbericht: {
    title: 'Watch report',
    print: 'Print watch report',
    printFailed: 'The watch report could not be generated.',
    generatedAt: 'Generated on',
    eventSection: 'Event',
    zeitraum: 'Period',
    forcesSection: 'Deployed personnel',
    noForces: 'No duty entries recorded.',
    name: 'Name',
    qualification: 'Qualification',
    roleAtEvent: 'Role',
    checkIn: 'On duty',
    checkOut: 'Off duty',
    duration: 'Duration',
    figuresSection: 'Operation figures',
    materialSection: 'Material consumption',
    materialItem: 'Item',
    materialQuantity: 'Quantity',
    noMaterial: 'No material consumption recorded.',
    trainingBanner: 'TRAINING / DEMO – This report contains exercise data, not real documentation.',
    trainingExcludedNote:
      'Training/demo data is excluded from the operation figures. Contacts are decrypted locally only; nothing is stored or transmitted.',
    signatureLine: 'Date, signature operations lead',
  },

  // --- Display + language settings ----------------------------------------
  settings: {
    title: 'Display & language',
    subtitle: 'Interface language and display options for use in the field.',
    language: 'Language',
    languageHint:
      'Translations other than German are machine-generated and not professionally reviewed.',
    displayMode: 'Display mode',
    displayNormal: 'Normal',
    displayGlove: 'Glove / large-font mode',
    displayGloveHint:
      'Enlarges the font and touch targets for operation with gloves or with limited vision.',
  },
} as const;
