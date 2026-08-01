// ============================================================
// KONFIGURACE
// Klíče uložte v Editoru: Project Settings -> Script Properties
// SONIOX_API_KEY, GEMINI_API_KEY, ELEVENLABS_API_KEY
// ============================================================
const PROPS = PropertiesService.getScriptProperties();

const CONFIG = {

  // --- Složky ---
  folders: {
    sourceId: '1p7hofka3RlCTzZ-4HcJhsg9X97dV_npm',      // sledovaná složka s nahrávkami
    destinationId: '1QScgUOIPzxpGNWl7dmCo2q6l_tIRzT6d'  // složka pro výstupy (může být stejná)
  },

  // --- Běhové limity ---
  runtime: {
    maxRuntimeMs: 5 * 60 * 1000,   // bezpečný strop pod 6min limitem Apps Scriptu
    lockWaitMs: 5000,              // čekání na zámek proti souběžným běhům
    urlFetchMaxBytes: 50 * 1024 * 1024  // limit UrlFetchApp na payload (~50 MB)
  },

  // --- Přepisové engine ---
  // Každý engine lze samostatně vypnout (enabled: false).
  engines: {
    soniox: {
      enabled: true,
      model: 'stt-async-v5',
      languageHints: ['cs'],
      pollTimeoutMs: 4 * 60 * 1000,  // max čekání na jeden přepis
      pollIntervalMs: 3000
    },
    elevenlabs: {
      enabled: true,
      modelId: 'scribe_v2',
      languageCode: 'ces',      // ISO 639-3
      tagAudioEvents: false,    // bez tagů [smích] apod.
      diarize: false            // true = označení mluvčích (příplatek, delší zpracování)
    }
  },

  // --- Gemini (fúze / korektura) ---
  gemini: {
    model: 'gemini-flash-latest',
    generationConfig: {
      temperature: 0.2          // nízká teplota = konzervativní, věrná fúze
      // maxOutputTokens: 65536 // volitelně, dle potřeby odkomentovat
    }
  },

  // --- Výstup ---
  output: {
    finalSuffix: '_final.txt',          // název: <baseName>_final.txt
    saveRawTranscripts: false,          // true = uloží i surové přepisy z obou enginů
    rawSuffixTemplate: '_{engine}_raw.txt',
    // requireAllEngines:
    //   true  = finál vznikne jen pokud uspěly VŠECHNY zapnuté enginy
    //           (jinak soubor zůstává ve frontě na další běh)
    //   false = finál vznikne i z jediného dostupného přepisu
    requireAllEngines: false,
    // Hvězdička = soubor je hotový a další běhy ho přeskočí
    starWhenDone: true
  },

  // --- Retry pro HTTP volání ---
  fetch: {
    maxAttempts: 3,
    backoffBaseMs: 1000   // 2s, 4s, ... (exponenciální)
  },

  // --- Prompty ---
  prompts: {
    // Fúze dvou přepisů: AI vybere/zkombinuje nejlepší finální verzi
    merge: `Jsi expert na korekturu a redakci českého jazyka. Dostaneš DVA nezávislé automatické přepisy TÉŽE nahrávky, každý z jiného přepisovacího systému. Každý systém dělá jiné typy chyb.

Tvůj úkol:
1. Porovnej oba přepisy a sestav z nich JEDEN finální text. Tam, kde se liší, vyber variantu, která dává v kontextu větší smysl (správná jména, termíny, čísla).
2. Oprav překlepy a interpunkci, rozděl text do odstavců.
3. Zachovej hovorový styl a nic nevynechávej ani nedomýšlej – drž se obsahu nahrávky.

{transcripts}

Vrať POUZE finální opravený text, bez komentářů a bez uvozovacích vět.`,

    // Korektura jediného přepisu (fallback, když uspěl jen jeden engine)
    refineSingle: `Jsi expert na korekturu českého jazyka. Dostaneš text z automatického přepisu.
Oprav překlepy, interpunkci a rozděl do odstavců. Zachovej hovorový styl.
Text k opravě:
---
{text}
---
Vrať pouze opravený text.`
  }
};

// ============================================================
// HLAVNÍ FUNKCE (spouštět triggerem)
// ============================================================
function processNewRecordings() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.runtime.lockWaitMs)) {
    console.log('Jiný běh stále pracuje, končím.');
    return;
  }

  const startTime = Date.now();

  try {
    const folder = DriveApp.getFolderById(CONFIG.folders.sourceId);
    const destFolder = DriveApp.getFolderById(CONFIG.folders.destinationId);
    const files = folder.getFiles();

    while (files.hasNext()) {
      if (Date.now() - startTime > CONFIG.runtime.maxRuntimeMs) {
        console.log('Dochází čas, zbytek zpracuje další běh.');
        break;
      }

      const file = files.next();
      if (file.isStarred()) continue;

      const baseName = file.getName().replace(/\.[^/.]+$/, "");
      const finalName = baseName + CONFIG.output.finalSuffix;

      // Idempotence: finál už existuje -> jen doznačit a jít dál
      if (fileExistsInFolder(destFolder, finalName)) {
        console.log('Finální výstup už existuje, přeskakuji: ' + finalName);
        if (CONFIG.output.starWhenDone) file.setStarred(true);
        continue;
      }

      console.log('Zpracovávám: ' + file.getName());
      const blob = file.getBlob();

      if (blob.getBytes().length > CONFIG.runtime.urlFetchMaxBytes) {
        console.warn(`Soubor ${file.getName()} přesahuje limit UrlFetchApp, přeskočeno.`);
        continue;
      }

      // --- 1. Přepisy všemi zapnutými enginy ---
      const transcripts = runEnabledEngines(blob, baseName, destFolder);

      const enabledCount = Object.values(CONFIG.engines).filter(e => e.enabled).length;
      const successCount = Object.keys(transcripts).length;

      if (successCount === 0) {
        console.warn('Žádný engine nevrátil přepis, soubor zůstává ve frontě: ' + file.getName());
        continue;
      }
      if (CONFIG.output.requireAllEngines && successCount < enabledCount) {
        console.warn(`Uspělo jen ${successCount}/${enabledCount} enginů a requireAllEngines=true, ` +
          'soubor zůstává ve frontě: ' + file.getName());
        continue;
      }

      // --- 2. AI rozhodne o jednom finálním výstupu ---
      let finalText;
      try {
        finalText = buildFinalTranscript(transcripts);
      } catch (e) {
        console.error('Sestavení finálního výstupu selhalo u ' + file.getName() + ': ' + e.toString());
        continue; // surové přepisy jsou případně uložené, finál zkusí další běh
      }

      // --- 3. Uložení a označení ---
      try {
        destFolder.createFile(finalName, finalText);
        console.log('Uloženo: ' + finalName);
        if (CONFIG.output.starWhenDone) file.setStarred(true);
        console.log('Hotovo: ' + file.getName());
      } catch (e) {
        console.error('Chyba při ukládání finálu: ' + e.toString());
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// ORCHESTRACE ENGINŮ
// ============================================================

/**
 * Spustí všechny zapnuté enginy nad daným blobem.
 * Využívá případné dřívější surové přepisy uložené na Disku (idempotence
 * mezi běhy – drahý přepis se neopakuje, pokud minule uspěl).
 * Vrací objekt { soniox: "...", elevenlabs: "..." } jen s úspěšnými přepisy.
 */
function runEnabledEngines(blob, baseName, destFolder) {
  const registry = {
    soniox: transcribeAudioWithSoniox,
    elevenlabs: transcribeAudioWithElevenLabs
  };

  const transcripts = {};

  for (const [engine, fn] of Object.entries(registry)) {
    const cfg = CONFIG.engines[engine];
    if (!cfg || !cfg.enabled) continue;

    const rawName = baseName + CONFIG.output.rawSuffixTemplate.replace('{engine}', engine);

    // Znovupoužití dříve uloženého surového přepisu
    const existing = readFileIfExists(destFolder, rawName);
    if (existing !== null && existing.trim()) {
      console.log(`${engine}: surový přepis už existuje, používám uložený.`);
      transcripts[engine] = existing;
      continue;
    }

    try {
      const raw = fn(blob, cfg);
      if (raw && raw.trim()) {
        transcripts[engine] = raw;
        if (CONFIG.output.saveRawTranscripts) {
          destFolder.createFile(rawName, raw);
          console.log('Uložen surový přepis: ' + rawName);
        }
      }
    } catch (e) {
      console.error(`${engine} selhal: ` + e.toString());
    }
  }

  return transcripts;
}

/**
 * Z dostupných přepisů sestaví jeden finální text:
 * - 2+ přepisů -> Gemini fúze (výběr/kombinace nejlepší verze)
 * - 1 přepis   -> Gemini korektura
 * - selhání Gemini -> fallback na nejdelší surový přepis
 */
function buildFinalTranscript(transcripts) {
  const entries = Object.entries(transcripts);

  let prompt;
  if (entries.length >= 2) {
    const block = entries
      .map(([engine, text], i) => `=== PŘEPIS ${i + 1} (${engine}) ===\n${text}`)
      .join('\n\n');
    prompt = CONFIG.prompts.merge.replace('{transcripts}', block);
  } else {
    prompt = CONFIG.prompts.refineSingle.replace('{text}', entries[0][1]);
  }

  const result = callGemini(prompt);
  if (result) return result;

  // Fallback: Gemini nedala použitelný výstup -> nejdelší surový přepis
  console.warn('Gemini nevrátila použitelný výstup, ukládám nejdelší surový přepis.');
  return entries.map(([, t]) => t).sort((a, b) => b.length - a.length)[0];
}

// ============================================================
// POMOCNÉ FUNKCE (Drive, HTTP)
// ============================================================

function fileExistsInFolder(folder, name) {
  return folder.getFilesByName(name).hasNext();
}

/** Vrátí obsah souboru daného jména, nebo null pokud neexistuje. */
function readFileIfExists(folder, name) {
  const it = folder.getFilesByName(name);
  if (!it.hasNext()) return null;
  return it.next().getBlob().getDataAsString();
}

/**
 * Fetch s retry a exponenciálním backoffem.
 * Opakuje při 429 a 5xx a při síťových výjimkách (ty muteHttpExceptions netlumí).
 */
function fetchWithRetry(url, options, maxAttempts = CONFIG.fetch.maxAttempts) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();
      if (code === 429 || code >= 500) {
        lastError = new Error(`HTTP ${code}: ${res.getContentText().slice(0, 300)}`);
      } else {
        return res; // úspěch i "trvalé" chyby (4xx) vrátíme volajícímu
      }
    } catch (e) {
      lastError = e; // timeout, DNS apod.
    }
    if (attempt < maxAttempts) {
      Utilities.sleep(Math.pow(2, attempt) * CONFIG.fetch.backoffBaseMs);
    }
  }
  throw lastError;
}

// ============================================================
// ENGINE: ElevenLabs Scribe
// ============================================================
function transcribeAudioWithElevenLabs(audioBlob, cfg) {
  const options = {
    'method': 'post',
    'headers': { 'xi-api-key': PROPS.getProperty('ELEVENLABS_API_KEY') },
    // Blob v payloadu => UrlFetchApp automaticky odešle multipart/form-data
    'payload': {
      'file': audioBlob,
      'model_id': cfg.modelId,
      'language_code': cfg.languageCode,
      'tag_audio_events': String(cfg.tagAudioEvents),
      'diarize': String(cfg.diarize)
    },
    'muteHttpExceptions': true
  };

  const res = fetchWithRetry("https://api.elevenlabs.io/v1/speech-to-text", options);
  if (res.getResponseCode() !== 200) {
    throw new Error(`ElevenLabs STT Error (${res.getResponseCode()}): ${res.getContentText().slice(0, 500)}`);
  }

  const json = JSON.parse(res.getContentText());

  if (json.text && typeof json.text === "string" && json.text.trim()) {
    return json.text.trim();
  }
  if (Array.isArray(json.words)) {
    const assembled = json.words.map(w => w.text || "").join("").trim();
    if (assembled) return assembled;
  }
  throw new Error('ElevenLabs vrátil prázdný přepis: ' + JSON.stringify(json).slice(0, 300));
}

// ============================================================
// ENGINE: Soniox
// ============================================================
function transcribeAudioWithSoniox(audioBlob, cfg) {
  const authHeaders = { 'Authorization': 'Bearer ' + PROPS.getProperty('SONIOX_API_KEY') };

  // 1. Upload
  const uploadRes = fetchWithRetry("https://api.soniox.com/v1/files", {
    'method': 'post',
    'headers': authHeaders,
    'payload': { 'file': audioBlob },
    'muteHttpExceptions': true
  });
  if (uploadRes.getResponseCode() !== 200 && uploadRes.getResponseCode() !== 201) {
    throw new Error(`Soniox Upload Error: ${uploadRes.getContentText()}`);
  }
  const fileId = JSON.parse(uploadRes.getContentText()).id;

  try {
    // 2. Vytvoření přepisu
    const createRes = fetchWithRetry("https://api.soniox.com/v1/transcriptions", {
      'method': 'post',
      'contentType': 'application/json',
      'headers': authHeaders,
      'payload': JSON.stringify({
        "model": cfg.model,
        "file_id": fileId,
        "language_hints": cfg.languageHints
      }),
      'muteHttpExceptions': true
    });
    if (createRes.getResponseCode() !== 200 && createRes.getResponseCode() !== 201) {
      throw new Error(`Soniox Create Transcription Error: ${createRes.getContentText()}`);
    }
    const transcriptionId = JSON.parse(createRes.getContentText()).id;

    // 3. Polling s timeoutem – čekáme explicitně na "completed"
    const statusUrl = `https://api.soniox.com/v1/transcriptions/${transcriptionId}`;
    const getOptions = { 'method': 'get', 'headers': authHeaders, 'muteHttpExceptions': true };
    const pollStart = Date.now();
    let status = "queued";

    while (status !== "completed") {
      if (Date.now() - pollStart > cfg.pollTimeoutMs) {
        throw new Error('Soniox: vypršel časový limit čekání na přepis.');
      }
      Utilities.sleep(cfg.pollIntervalMs);
      const statusRes = fetchWithRetry(statusUrl, getOptions);
      if (statusRes.getResponseCode() !== 200) {
        throw new Error(`Soniox Status Error: ${statusRes.getContentText()}`);
      }
      const statusJson = JSON.parse(statusRes.getContentText());
      status = statusJson.status;
      if (status === "error") {
        throw new Error(`Soniox Transcription failed: ${statusJson.error_message || "Neznámá chyba."}`);
      }
    }

    // 4. Stažení textu
    const transcriptRes = fetchWithRetry(
      `https://api.soniox.com/v1/transcriptions/${transcriptionId}/transcript`, getOptions);
    if (transcriptRes.getResponseCode() !== 200) {
      throw new Error(`Soniox Transcript Fetch Error: ${transcriptRes.getContentText()}`);
    }

    const transcriptJson = JSON.parse(transcriptRes.getContentText());

    if (transcriptJson.text && typeof transcriptJson.text === "string") {
      return transcriptJson.text;
    } else if (Array.isArray(transcriptJson.segments)) {
      return transcriptJson.segments.map(s => {
        if (s.text) return s.text;
        if (s.tokens) return s.tokens.map(t => t.text).join("");
        return "";
      }).join("\n");
    } else if (Array.isArray(transcriptJson.tokens)) {
      return transcriptJson.tokens.map(t => t.text).join("");
    }
    return JSON.stringify(transcriptJson);

  } finally {
    // Úklid nahraného souboru na Sonioxu (best effort)
    try {
      UrlFetchApp.fetch(`https://api.soniox.com/v1/files/${fileId}`, {
        'method': 'delete', 'headers': authHeaders, 'muteHttpExceptions': true
      });
    } catch (e) {
      console.warn('Soniox cleanup selhal: ' + e.toString());
    }
  }
}

// ============================================================
// GEMINI
// ============================================================

/**
 * Zavolá Gemini s daným promptem. Vrací text, nebo null při selhání
 * (rozhodnutí o fallbacku je na volajícím).
 */
function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.gemini.model}:generateContent` +
    `?key=${PROPS.getProperty('GEMINI_API_KEY')}`;

  try {
    const response = fetchWithRetry(url, {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": CONFIG.gemini.generationConfig
      }),
      'muteHttpExceptions': true
    });

    if (response.getResponseCode() !== 200) {
      console.warn("Gemini vrátila " + response.getResponseCode() + ".");
      return null;
    }

    const json = JSON.parse(response.getContentText());
    const candidate = json.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      console.warn("Gemini nevrátila text (finishReason: " +
        (candidate?.finishReason || json.promptFeedback?.blockReason || "?") + ").");
      return null;
    }
    if (candidate.finishReason === "MAX_TOKENS") {
      console.warn("Gemini výstup oříznut (MAX_TOKENS).");
      return null;
    }

    return text;
  } catch (e) {
    console.warn("Gemini selhala: " + e.toString());
    return null;
  }
}
