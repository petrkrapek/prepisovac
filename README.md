
# Automatický přepis nahrávek (Google Apps Script)

Skript automaticky zpracovává audio/video nahrávky ve sledované složce na Google Disku. Každou nahrávku přepíše dvěma nezávislými STT enginy (Soniox a ElevenLabs Scribe), oba přepisy následně předá modelu Gemini, který je porovná, zkombinuje a vytvoří **jeden finální korigovaný text** uložený jako `.txt` do cílové složky.

## Architektura

```
Google Drive (zdrojová složka)
        │
        ▼
processNewRecordings()          ← časový trigger, ochrana zámkem
        │
        ├── Soniox stt-async-v5        (upload → transcription → polling → text)
        ├── ElevenLabs scribe_v2       (synchronní multipart POST)
        │
        ▼
buildFinalTranscript()
        │
        ├── 2 přepisy  → Gemini: fúzní prompt (porovnání a výběr lepších variant)
        ├── 1 přepis   → Gemini: korekturní prompt
        └── selhání Gemini → fallback: nejdelší surový přepis
        │
        ▼
<baseName>_final.txt  →  cílová složka na Disku
zdrojový soubor  →  hvězdička (= zpracováno)
```

## Požadavky

- Google účet s přístupem k Apps Scriptu a Google Disku
- API klíče: **Soniox**, **ElevenLabs**, **Google Gemini** (Generative Language API)
- Nahrávky do ~50 MB (limit `UrlFetchApp` na velikost payloadu)

## Instalace

1. Vytvořte nový projekt na [script.google.com](https://script.google.com) a vložte obsah `prepis_nahravky_v2.gs`.
2. V **Project Settings → Script Properties** přidejte:

   | Klíč | Hodnota |
   |---|---|
   | `SONIOX_API_KEY` | API klíč Soniox |
   | `ELEVENLABS_API_KEY` | API klíč ElevenLabs |
   | `GEMINI_API_KEY` | API klíč Gemini |

3. V objektu `CONFIG.folders` nastavte ID zdrojové a cílové složky (ID je část URL složky za `/folders/`).
4. Spusťte `processNewRecordings()` ručně a potvrďte oprávnění (Drive, externí požadavky).
5. Nastavte časový trigger: **Triggers → Add Trigger → processNewRecordings → Time-driven** (doporučeno každých 10–15 minut).

## Konfigurace (`CONFIG`)

Veškeré chování se řídí objektem `CONFIG` na začátku souboru.

### `folders`
| Parametr | Popis |
|---|---|
| `sourceId` | ID sledované složky s nahrávkami |
| `destinationId` | ID složky pro výstupy (může být stejná) |

### `runtime`
| Parametr | Výchozí | Popis |
|---|---|---|
| `maxRuntimeMs` | 5 min | Bezpečný strop pod 6min limitem Apps Scriptu; nedokončené soubory zpracuje další běh |
| `lockWaitMs` | 5 s | Čekání na zámek proti souběžným běhům |
| `urlFetchMaxBytes` | 50 MB | Soubory nad limit se přeskočí (omezení `UrlFetchApp`) |

### `engines`
Každý engine lze samostatně vypnout (`enabled: false`).

| Engine | Parametry |
|---|---|
| `soniox` | `model`, `languageHints`, `pollTimeoutMs`, `pollIntervalMs` |
| `elevenlabs` | `modelId`, `languageCode` (ISO 639-3, čeština = `ces`), `tagAudioEvents`, `diarize` |

Přidání dalšího enginu: napište funkci `transcribeAudioWithXxx(blob, cfg)`, přidejte záznam do `CONFIG.engines` a do registru v `runEnabledEngines()`.

### `gemini`
| Parametr | Popis |
|---|---|
| `model` | Název modelu (výchozí `gemini-flash-latest`) |
| `generationConfig.temperature` | Výchozí `0.2` – konzervativní, věrná fúze |
| `generationConfig.maxOutputTokens` | Volitelné; odkomentujte u dlouhých nahrávek, aby výstup nebyl oříznut |

### `output`
| Parametr | Výchozí | Popis |
|---|---|---|
| `finalSuffix` | `_final.txt` | Přípona finálního výstupu |
| `saveRawTranscripts` | `false` | `true` = uloží i surové přepisy (`_soniox_raw.txt`, `_elevenlabs_raw.txt`); další běh je znovu použije místo opakování API volání |
| `requireAllEngines` | `false` | `true` = finál vznikne jen když uspějí všechny zapnuté enginy, jinak soubor čeká na další běh |
| `starWhenDone` | `true` | Označení zdrojového souboru hvězdičkou po dokončení |

### `fetch`
Retry logika pro všechna HTTP volání: `maxAttempts` (výchozí 3), `backoffBaseMs` (exponenciální backoff 2 s, 4 s). Opakuje se při HTTP 429, 5xx a síťových výjimkách.

### `prompts`
Oba prompty (`merge`, `refineSingle`) jsou plně editovatelné. Placeholdery: `{transcripts}` (fúze), `{text}` (korektura).

## Chování a idempotence

- Zpracované soubory se označují **hvězdičkou** a další běhy je přeskakují.
- Pokud finální `.txt` už v cílové složce existuje, soubor se pouze doznačí hvězdičkou.
- Se zapnutým `saveRawTranscripts` se úspěšný přepis neztratí ani při pádu Gemini – další běh jej načte z Disku a nespotřebuje znovu kredit STT API.
- Souběžné běhy blokuje `LockService`.

## Řešení problémů

| Příznak | Příčina / řešení |
|---|---|
| `Jiný běh stále pracuje` v logu | Normální při překryvu triggerů; pokud přetrvává dlouho, zkontrolujte zaseknuté spuštění v **Executions** |
| Soubor zůstává bez hvězdičky | Žádný engine nevrátil přepis, nebo `requireAllEngines=true` a jeden engine selhal – viz log |
| `přesahuje limit UrlFetchApp` | Soubor > 50 MB; zkomprimujte audio (např. mono MP3/Opus s nižším bitrate) |
| Gemini vrací oříznutý text (`MAX_TOKENS`) | Odkomentujte a zvyšte `maxOutputTokens` v `CONFIG.gemini.generationConfig` |
| HTTP 401/403 od API | Zkontrolujte klíče ve Script Properties (názvy musí přesně sedět) |

Logy najdete v editoru Apps Scriptu v sekci **Executions**.
